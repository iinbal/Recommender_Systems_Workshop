"""
cb_pipeline.py

Content-Based recommendation pipeline for beer recommendations.

Main functions:
- cb_recommend(user_id, n=10)
- similar_beers(beer_id, n=10)

Output format matches cf_pipeline.py:
- pd.Series
- index = beer_id
- values = recommendation score
"""

import html
from pathlib import Path

import numpy as np
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import OneHotEncoder, StandardScaler


BASE_DIR = Path(__file__).resolve().parent

ITEM_PROFILES_PATH = BASE_DIR / "data" / "item_profiles_for_cold_start.csv"
TRAIN_PATH = BASE_DIR / "data" / "train_set.csv"
ARTIFACTS_DIR = BASE_DIR / "artifacts"


def make_demo_data():
    item_profiles_demo = pd.DataFrame({
        "beer_id": ["beer_0001", "beer_0002", "beer_0003", "beer_0004", "beer_0005"],
        "beer_name": ["Hoppy IPA", "Dark Stout", "Light Lager", "Sour Ale", "Citrus IPA"],
        "brewer_id": [1, 2, 3, 4, 5],
        "beer_style": ["IPA", "Stout", "Lager", "Sour", "IPA"],
        "beer_abv": [6.5, 8.0, 4.8, 5.2, 6.8],
        "avg_overall_rating": [4.3, 4.1, 3.5, 3.9, 4.4],
        "avg_taste_rating": [4.4, 4.2, 3.4, 4.0, 4.5],
        "avg_aroma_rating": [4.5, 4.0, 3.2, 4.1, 4.6],
        "avg_appearance_rating": [4.0, 4.3, 3.5, 3.8, 4.1],
        "avg_palate_rating": [4.2, 4.1, 3.3, 3.9, 4.4],
        "avg_review_word_count": [80, 95, 40, 70, 85],
        "total_reviews_count": [120, 100, 60, 75, 130],
        "all_reviews_text": [
            "hoppy bitter citrus tropical grapefruit ipa",
            "dark roasted chocolate coffee stout rich",
            "light crisp clean refreshing lager easy drink",
            "sour tart funky acidic fruity ale",
            "citrus hoppy juicy bitter tropical ipa",
        ],
    })

    train_demo = pd.DataFrame({
        "username": ["user_0001", "user_0001", "user_0002", "user_0002"],
        "beer_id": ["beer_0001", "beer_0003", "beer_0002", "beer_0004"],
        "rating_overall": [5.0, 3.0, 4.5, 3.5],
    })

    return item_profiles_demo, train_demo


text_feature = "all_reviews_text"
categorical_features = ["beer_style"]

numeric_features = [
    "beer_abv",
    "avg_overall_rating",
    "avg_taste_rating",
    "avg_aroma_rating",
    "avg_appearance_rating",
    "avg_palate_rating",
    "avg_review_word_count",
    "total_reviews_count",
]

required_item_columns = ["beer_id", "beer_name", "beer_style", text_feature] + numeric_features
required_train_columns = ["username", "beer_id", "rating_overall"]


_CB_ARTIFACTS_READY = (ARTIFACTS_DIR / "cb_feature_matrix.npz").exists()

if _CB_ARTIFACTS_READY:
    # ── Path 1: load precomputed artifacts ──────────────────────────
    from scipy.sparse import load_npz
    import joblib

    beer_feature_matrix = load_npz(ARTIFACTS_DIR / "cb_feature_matrix.npz")
    item_profiles = pd.read_csv(ARTIFACTS_DIR / "cb_item_profiles.csv")
    train_df = pd.read_csv(ARTIFACTS_DIR / "cb_train_df.csv")
    beer_ids = np.load(ARTIFACTS_DIR / "cb_beer_ids.npy", allow_pickle=True)
    beer_id_to_index = {beer_id: idx for idx, beer_id in enumerate(beer_ids)}
    preprocessor = joblib.load(ARTIFACTS_DIR / "cb_preprocessor.joblib")

    print("CB artifacts loaded from disk.")
    print(f"Item profiles loaded: {item_profiles.shape}")
    print(f"Train data loaded:    {train_df.shape}")
    print(f"Beer feature matrix: {beer_feature_matrix.shape}")
else:
    # ── Path 2/3: load CSV or demo data, then fit on the fly ────────
    print("No CB artifacts found. Computing on the fly...")

    if ITEM_PROFILES_PATH.exists() and TRAIN_PATH.exists():
        item_profiles = pd.read_csv(ITEM_PROFILES_PATH)
        train_df = pd.read_csv(TRAIN_PATH)
        print("Loaded real CSV files.")
    else:
        item_profiles, train_df = make_demo_data()
        print("WARNING: Real CSV files not found. Running with demo data.")

    print(f"Item profiles loaded: {item_profiles.shape}")
    print(f"Train data loaded:    {train_df.shape}")

    missing_item_cols = [col for col in required_item_columns if col not in item_profiles.columns]
    missing_train_cols = [col for col in required_train_columns if col not in train_df.columns]

    if missing_item_cols:
        raise ValueError(f"Missing required columns in item_profiles: {missing_item_cols}")

    if missing_train_cols:
        raise ValueError(f"Missing required columns in train_df: {missing_train_cols}")

    item_profiles[text_feature] = item_profiles[text_feature].fillna("")
    item_profiles["beer_style"] = item_profiles["beer_style"].fillna("unknown")

    for col in numeric_features:
        item_profiles[col] = pd.to_numeric(item_profiles[col], errors="coerce")

    if item_profiles["beer_abv"].notna().any():
        item_profiles["beer_abv"] = item_profiles["beer_abv"].fillna(
            item_profiles["beer_abv"].median()
        )
    else:
        item_profiles["beer_abv"] = item_profiles["beer_abv"].fillna(0)

    for col in numeric_features:
        item_profiles[col] = item_profiles[col].fillna(0)

    train_df["rating_overall"] = pd.to_numeric(
        train_df["rating_overall"],
        errors="coerce",
    ).fillna(0)

    preprocessor = ColumnTransformer(
        transformers=[
            ("style", OneHotEncoder(handle_unknown="ignore"), categorical_features),
            ("numeric", StandardScaler(), numeric_features),
            (
                "text",
                TfidfVectorizer(
                    max_features=2000,
                    stop_words="english",
                    min_df=1,
                ),
                text_feature,
            ),
        ],
        remainder="drop",
    )

    beer_feature_matrix = preprocessor.fit_transform(item_profiles)

    beer_ids = item_profiles["beer_id"].values
    beer_id_to_index = {beer_id: idx for idx, beer_id in enumerate(beer_ids)}

    print(f"Beer feature matrix: {beer_feature_matrix.shape}")

# Source data (BeerAdvocate/RateBeer scrapes) has some beer names stored with
# un-decoded HTML entities (e.g. "&#40;18%&#41;" instead of "(18%)").
item_profiles["beer_name"] = item_profiles["beer_name"].apply(
    lambda name: html.unescape(name) if isinstance(name, str) else name
)


def to_dense_array(matrix):
    if hasattr(matrix, "toarray"):
        return matrix.toarray()
    return np.asarray(matrix)


def ensure_2d(matrix):
    matrix = to_dense_array(matrix)
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)
    return matrix


def similar_beers(beer_id, n: int = 10) -> pd.Series:
    """
    Return top-N beers most similar to a given beer.
    """

    if beer_id not in beer_id_to_index:
        raise ValueError(f"Beer id '{beer_id}' not found.")

    beer_idx = beer_id_to_index[beer_id]
    beer_vector = ensure_2d(beer_feature_matrix[beer_idx])

    similarities = cosine_similarity(
        beer_vector,
        beer_feature_matrix,
    ).flatten()

    ranked_indices = np.argsort(similarities)[::-1]
    ranked_indices = [idx for idx in ranked_indices if idx != beer_idx]
    top_indices = ranked_indices[:n]

    return pd.Series(
        similarities[top_indices],
        index=item_profiles.iloc[top_indices]["beer_id"].values,
        name="cb_score",
    ).sort_values(ascending=False)


def build_user_profile(user_id: str):
    """
    Build a user profile vector from beers the user rated.
    """

    user_reviews = train_df[train_df["username"] == user_id].copy()

    if user_reviews.empty:
        raise ValueError(f"User '{user_id}' not found in train data.")

    user_reviews = user_reviews[user_reviews["beer_id"].isin(beer_id_to_index)]

    if user_reviews.empty:
        raise ValueError(
            f"User '{user_id}' has no rated beers available in item profiles."
        )

    beer_indices = user_reviews["beer_id"].map(beer_id_to_index).values

    ratings = user_reviews["rating_overall"].astype(float).values
    ratings = np.clip(ratings / 5.0, 0.0, 1.0)

    user_beer_vectors = ensure_2d(beer_feature_matrix[beer_indices])

    user_profile = np.average(
        user_beer_vectors,
        axis=0,
        weights=ratings,
    ).reshape(1, -1)

    return user_profile


def cb_recommend(user_id: str, n: int = 10, exclude_ids=None, ascending: bool = False) -> pd.Series:
    """
    Return top-N content-based beer recommendations for a user.
    """

    user_profile = build_user_profile(user_id)

    similarities = cosine_similarity(
        user_profile,
        beer_feature_matrix,
    ).flatten()

    already_rated = set(train_df[train_df["username"] == user_id]["beer_id"])

    candidate_indices = [
        idx
        for idx, beer_id in enumerate(beer_ids)
        if beer_id not in already_rated
    ]

    if exclude_ids:
        exclude_set = set(exclude_ids)
        candidate_indices = [
            idx for idx in candidate_indices
            if beer_ids[idx] not in exclude_set
        ]

    if not candidate_indices:
        return pd.Series(dtype=float, name="cb_score")

    candidate_scores = similarities[candidate_indices]
    if ascending:
        order = np.argsort(candidate_scores)[:n]
    else:
        order = np.argsort(candidate_scores)[::-1][:n]
    top_indices = [candidate_indices[i] for i in order]

    return pd.Series(
        similarities[top_indices],
        index=item_profiles.iloc[top_indices]["beer_id"].values,
        name="cb_score",
    ).sort_values(ascending=ascending)


def cb_recommend_from_ratings(rated_beers: dict, n: int = 10, exclude_ids=None,
                               ascending: bool = False) -> pd.Series:
    """
    CB recommendations for a user not in the training data, built directly
    from their session ratings.

    Parameters
    ----------
    rated_beers : {beer_id: rating (1-5 scale)} from online_store
    """
    # Type-flexible lookup — handle int/str mismatches between demo and real data
    valid = {}
    for bid, rating in rated_beers.items():
        if bid in beer_id_to_index:
            valid[bid] = rating
        elif len(beer_ids) > 0:
            target_type = type(beer_ids[0])
            try:
                native_bid = target_type(bid)
                if native_bid in beer_id_to_index:
                    valid[native_bid] = rating
            except (ValueError, TypeError):
                pass

    if not valid:
        raise ValueError("No rated beers found in CB catalog.")

    beer_indices = np.array([beer_id_to_index[bid] for bid in valid])
    ratings = np.clip(np.array(list(valid.values()), dtype=float) / 5.0, 0.0, 1.0)

    user_profile = np.average(
        ensure_2d(beer_feature_matrix[beer_indices]),
        axis=0,
        weights=ratings,
    ).reshape(1, -1)

    similarities = cosine_similarity(user_profile, beer_feature_matrix).flatten()

    exclude_str = {str(b) for b in valid} | {str(b) for b in (exclude_ids or [])}
    candidate_indices = [
        idx for idx, bid in enumerate(beer_ids)
        if str(bid) not in exclude_str
    ]

    if not candidate_indices:
        return pd.Series(dtype=float, name="cb_score")

    candidate_scores = similarities[candidate_indices]
    order = np.argsort(candidate_scores) if ascending else np.argsort(candidate_scores)[::-1]
    ranked_indices = [candidate_indices[i] for i in order]

    # Cap representation per exact beer_style. Averaging several rated beers into one
    # profile vector tends to land closest to whichever style is most internally
    # cohesive/numerous among the ratings, so an uncapped nearest-neighbor search can
    # return one style for almost every slot. This mirrors the same cap used in
    # cold_start.cold_start_from_attributes.
    STYLE_CAP = 5
    style_by_id = item_profiles.set_index("beer_id")["beer_style"]
    style_counts = {}
    top_indices = []
    for idx in ranked_indices:
        style = style_by_id.get(beer_ids[idx])
        if style_counts.get(style, 0) >= STYLE_CAP:
            continue
        style_counts[style] = style_counts.get(style, 0) + 1
        top_indices.append(idx)
        if len(top_indices) >= n:
            break

    return pd.Series(
        similarities[top_indices],
        index=[beer_ids[i] for i in top_indices],
        name="cb_score",
    ).sort_values(ascending=ascending)


def get_recommendation_details(scores: pd.Series) -> pd.DataFrame:
    """
    Convert recommendation scores into a readable table with beer metadata.
    """

    if scores.empty:
        return pd.DataFrame()

    details = item_profiles[
        item_profiles["beer_id"].isin(scores.index)
    ][
        [
            "beer_id",
            "beer_name",
            "beer_style",
            "beer_abv",
            "avg_overall_rating",
            "total_reviews_count",
        ]
    ].copy()

    details["cb_score"] = details["beer_id"].map(scores)

    return details.sort_values("cb_score", ascending=False)


if __name__ == "__main__":
    sample_user = train_df["username"].iloc[0]

    print(f"\nTop-10 CB recommendations for user: {sample_user}")
    rec_scores = cb_recommend(sample_user, n=10)
    print(rec_scores.round(3))

    print("\nReadable recommendation table:")
    print(get_recommendation_details(rec_scores).round(3))

    sample_beer = item_profiles["beer_id"].iloc[0]

    print(f"\nTop-10 beers similar to beer_id={sample_beer}")
    similar_scores = similar_beers(sample_beer, n=10)
    print(similar_scores.round(3))

    print("\nReadable similar beers table:")
    print(get_recommendation_details(similar_scores).round(3))
