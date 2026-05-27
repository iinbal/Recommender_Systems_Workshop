"""
recommender.py

Three-tier recommendation router that handles cold-start gracefully.

  Tier 1  (≥ 10 ratings)  →  CF + CB hybrid
  Tier 2  (1 – 9 ratings) →  CB only
  Tier 3  (0 ratings)     →  Popularity fallback

Usage
-----
    from recommender import recommend
    recs = recommend("user_0042", n=10)
    recs = recommend("brand_new_user", n=10, preferred_style="IPA")
"""

import pandas as pd
import cb_pipeline as cb
import cf_pipeline as cf

CF_THRESHOLD = 10  # minimum rated beers needed to activate the CF tier


def recommend(user_id: str, n: int = 10, preferred_style: str = None) -> pd.Series:
    """
    Return top-N beer recommendations for any user, including cold-start.

    Parameters
    ----------
    user_id         : user identifier
    n               : number of recommendations to return
    preferred_style : beer style preference string for brand-new users
                      (e.g. "IPA", "Stout") — ignored once the user has ratings

    Returns
    -------
    pd.Series  index = beer_id, values = score, sorted desc
    """
    rating_count = len(cb.train_df[cb.train_df["username"] == user_id])

    if rating_count >= CF_THRESHOLD:
        # ── Tier 1: hybrid CF + CB ────────────────────────────────────────
        # Average the two score vectors, falling back to CB if CF fails
        # (e.g. user exists in train data but not yet in the CF rating matrix).
        try:
            cf_scores = cf.cf_recommend(user_id, n=n * 2)
            cb_scores = cb.cb_recommend(user_id, n=n * 2)
            combined = cf_scores.add(cb_scores, fill_value=0) / 2
            return combined.nlargest(n).rename("hybrid_score")
        except Exception:
            pass  # fall through to CB-only

    if rating_count >= 1:
        # ── Tier 2: CB only ───────────────────────────────────────────────
        return cb.cb_recommend(user_id, n=n)

    # ── Tier 3: popularity fallback ───────────────────────────────────────
    return cb.popularity_recommend(n=n, style=preferred_style)
