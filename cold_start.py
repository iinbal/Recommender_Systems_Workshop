"""
cold_start.py

Cold-start recommendation logic for brand-new users who have no rating
history yet.

Two entry points:
- cold_start_from_attributes: for users who completed the taste-preference
  onboarding form (attribute sliders + style picks).
- cold_start_from_ratings:    for users who rated a few beers during onboarding.

Output format matches cb_pipeline.cb_recommend / cf_pipeline.cf_recommend:
- pd.Series
- index = beer_id
- values = recommendation score
"""

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

import cb_pipeline as cb
from cb_pipeline import item_profiles, beer_feature_matrix, preprocessor, beer_ids
from cf_pipeline import cf_recommend_new_user


# cluster id -> set of beer_style values for that cluster
CLUSTER_STYLES = {
    "hoppy": {"IPA", "India Pale Ale", "Double IPA", "Pale Ale", "American Pale Ale"},
    "dark":  {"Stout", "Porter", "Imperial Stout", "Brown Ale"},
    "sour":  {"Sour", "Sour Ale", "Wild Ale", "Lambic", "Fruit Beer"},
    "light": {"Lager", "Pilsner", "Light Lager", "Pale Lager", "Wheat Beer"},
}


# ─────────────────────────────────────────────
# MODULE-LEVEL PRECOMPUTES
# ─────────────────────────────────────────────

# Extract the 8-column numeric sub-space from beer_feature_matrix.
# ColumnTransformer output order: OHE (style) | StandardScaler (8 numeric) | TF-IDF (2000 text)
# Using numeric subspace avoids zero-padding bias from OHE/TF-IDF.
_n_style_cols = len(preprocessor.named_transformers_["style"].categories_[0])
_numeric_slice = slice(_n_style_cols, _n_style_cols + 8)

# Dense (n_beers x 8) matrix — small enough to keep in memory
if hasattr(beer_feature_matrix, "toarray"):
    beer_numeric_matrix = beer_feature_matrix[:, _numeric_slice].toarray()
else:
    beer_numeric_matrix = np.asarray(beer_feature_matrix[:, _numeric_slice])

# Numeric column order must exactly match numeric_features in cb_pipeline.py:
#   beer_abv, avg_overall_rating, avg_taste_rating, avg_aroma_rating,
#   avg_appearance_rating, avg_palate_rating, avg_review_word_count, total_reviews_count
_NUMERIC_COLS = [
    "beer_abv",
    "avg_overall_rating",
    "avg_taste_rating",
    "avg_aroma_rating",
    "avg_appearance_rating",
    "avg_palate_rating",
    "avg_review_word_count",
    "total_reviews_count",
]

# quantile lookup: col -> array of 101 values (percentiles 0..100)
_COL_QUANTILES = {
    col: np.nanpercentile(item_profiles[col].astype(float).values, np.arange(0, 101))
    for col in _NUMERIC_COLS
    if col in item_profiles.columns
}


def cold_start_from_attributes(
    taste: float,
    aroma: float,
    appearance: float,
    palate: float,
    abv_pref: str,          # "low" | "medium" | "high" | "any"
    styles: list,           # list of beer_style strings (at least 1 required by UI)
    n: int = 10,
) -> pd.Series:
    """
    Return top-N cold-start recommendations for a new user based on
    taste attribute preferences and preferred beer styles.

    Parameters
    ----------
    taste      : importance of taste rating (1-5)
    aroma      : importance of aroma rating (1-5)
    appearance : importance of appearance rating (1-5)
    palate     : importance of palate rating (1-5)
    abv_pref   : preferred alcohol level ("low" | "medium" | "high" | "any")
    styles     : list of preferred beer_style strings
    n          : number of recommendations to return

    Returns
    -------
    pd.Series  index = beer_id, values = cold-start score, sorted desc
    """

    # 1. Map importance scores (1-5) to target raw values using quantile lookup
    abv_pct = {"low": 25, "medium": 50, "high": 75, "any": 50}.get(abv_pref, 50)

    targets = {
        "beer_abv":              _COL_QUANTILES["beer_abv"][abv_pct],
        "avg_overall_rating":    _COL_QUANTILES["avg_overall_rating"][70],
        "avg_taste_rating":      _COL_QUANTILES["avg_taste_rating"][int(taste / 5.0 * 100)],
        "avg_aroma_rating":      _COL_QUANTILES["avg_aroma_rating"][int(aroma / 5.0 * 100)],
        "avg_appearance_rating": _COL_QUANTILES["avg_appearance_rating"][int(appearance / 5.0 * 100)],
        "avg_palate_rating":     _COL_QUANTILES["avg_palate_rating"][int(palate / 5.0 * 100)],
        "avg_review_word_count": _COL_QUANTILES["avg_review_word_count"][50],
        "total_reviews_count":   _COL_QUANTILES["total_reviews_count"][40],
    }

    # 2. Build raw_vector in the same column order as _NUMERIC_COLS
    raw_vector = np.array([targets[col] for col in _NUMERIC_COLS], dtype=float)

    # 3. Scale using the fitted StandardScaler
    numeric_scaler = preprocessor.named_transformers_["numeric"]
    scaled_vector = numeric_scaler.transform(raw_vector.reshape(1, -1))

    # 4. Compute cosine similarity against beer_numeric_matrix
    numeric_scores = cosine_similarity(scaled_vector, beer_numeric_matrix).flatten()
    numeric_series = pd.Series(numeric_scores, index=item_profiles["beer_id"].values)
    rng = numeric_series.max() - numeric_series.min()
    if rng > 0:
        numeric_series = (numeric_series - numeric_series.min()) / rng

    # 5. Compute style-cluster score
    taste_scores = pd.Series(0.0, index=item_profiles.index)
    answered = 0
    for style_val in styles:
        for cluster_id, style_set in CLUSTER_STYLES.items():
            if style_val in style_set:
                taste_scores.loc[item_profiles["beer_style"].isin(style_set)] += 1.0
                answered += 1
                break
    if answered > 0:
        taste_scores = taste_scores / answered
    style_series = pd.Series(
        taste_scores.values,
        index=item_profiles["beer_id"].values,
    )
    rng = style_series.max() - style_series.min()
    if rng > 0:
        style_series = (style_series - style_series.min()) / rng

    # 6. Blend: 70% numeric profile match, 30% style cluster match
    final = 0.7 * numeric_series + 0.3 * style_series

    # 7. Cap representation per exact beer_style before truncating to n. The style-cluster
    # bonus above is flat across an entire cluster (e.g. IPA/Double IPA/American Pale Ale all
    # score identically), so without this cap the numeric term alone can let one style sweep
    # every slot, starving the downstream MMR reranker of any real variety to choose from.
    STYLE_CAP = 5
    style_by_id = item_profiles.set_index("beer_id")["beer_style"]
    ranked = final.sort_values(ascending=False)
    capped = (
        pd.DataFrame({"score": ranked, "beer_style": style_by_id.reindex(ranked.index)})
        .groupby("beer_style", sort=False)
        .head(STYLE_CAP)["score"]
    )

    # 8. Return top-n
    return capped.nlargest(n).rename("cold_start_score")


def cold_start_from_ratings(
    rated_beers: dict,      # {beer_id: rating (1-5)}
    n: int = 10,
    exclude_ids=None,
) -> pd.Series:
    """
    Return top-N cold-start recommendations for a new user who has already
    rated some beers during the onboarding session.

    Blends CB (always) and CF fold-in (when >= 3 ratings) scores.  CF weight
    scales up linearly from 0 -> 0.6 as the user accumulates 0 -> 5 ratings,
    so early recommendations are CB-dominated and become more CF-informed as
    the user rates more beers.

    Parameters
    ----------
    rated_beers : {beer_id: rating (1-5)}
    n           : number of recommendations to return
    exclude_ids : optional collection of beer_ids to exclude from results

    Returns
    -------
    pd.Series  index = beer_id, values = cold-start score, sorted desc

    Raises
    ------
    ValueError  if neither CB nor CF can produce candidates
    """

    cb_scores = pd.Series(dtype=float)
    cf_scores = pd.Series(dtype=float)

    # CB scores (always attempted)
    try:
        cb_scores = cb.cb_recommend_from_ratings(
            rated_beers, n * 3, exclude_ids=exclude_ids, ascending=False
        )
    except ValueError:
        cb_scores = pd.Series(dtype=float)

    # CF fold-in (only when enough ratings)
    if len(rated_beers) >= 3:
        try:
            cf_scores = cf_recommend_new_user(
                rated_beers, n * 3, exclude_ids=exclude_ids
            )
        except ValueError:
            cf_scores = pd.Series(dtype=float)

    cf_weight = 0.6 * min(len(rated_beers) / 5.0, 1.0)

    if not cb_scores.empty and not cf_scores.empty:
        all_ids = cf_scores.index.union(cb_scores.index)
        cf_aligned = cf_scores.reindex(all_ids)
        cb_aligned = cb_scores.reindex(all_ids)

        both    = cf_aligned.notna() & cb_aligned.notna()
        cf_only = cf_aligned.notna() & cb_aligned.isna()
        cb_only = cb_aligned.notna() & cf_aligned.isna()

        blended = pd.Series(0.0, index=all_ids)
        blended[both]    = cf_weight * cf_aligned[both] + (1 - cf_weight) * cb_aligned[both]
        blended[cf_only] = cf_aligned[cf_only]
        blended[cb_only] = cb_aligned[cb_only]

        scores = blended.nlargest(n)
    elif not cb_scores.empty:
        scores = cb_scores.nlargest(n)
    elif not cf_scores.empty:
        scores = cf_scores.nlargest(n)
    else:
        raise ValueError("No recommendations could be generated.")

    return scores.rename("cold_start_score")
