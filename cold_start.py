"""
cold_start.py

Cold-start recommendation logic for brand-new users who have no rating
history yet.

This file is intentionally kept separate from quiz_data.json: the quiz
file is a static description of the onboarding questions (served as-is
to the frontend), while this module contains the logic that maps a
user's answers onto the beer catalogue.

Output format matches cb_pipeline.cb_recommend / cf_pipeline.cf_recommend:
- pd.Series
- index = beer_id
- values = recommendation score
"""

import json
from pathlib import Path

import pandas as pd

from cb_pipeline import item_profiles


BASE_DIR = Path(__file__).resolve().parent
QUIZ_PATH = BASE_DIR / "quiz_data.json"

with open(QUIZ_PATH, "r", encoding="utf-8") as f:
    QUIZ_CONFIG = json.load(f)

# cluster id (quiz question id) -> set of beer_style values for that cluster
CLUSTER_STYLES = {
    question["id"]: set(question["styles"])
    for question in QUIZ_CONFIG["questions"]
}

# How much weight to give the quiz-derived taste match vs. overall beer
# quality/popularity (a safe bet for users we know nothing about yet).
TASTE_WEIGHT = 0.7
POPULARITY_WEIGHT = 0.3


def get_cold_start_recommendations(quiz_answers: dict, n: int = 10) -> pd.Series:
    """
    Return top-N beer recommendations for a brand-new user based on their
    onboarding quiz answers.

    Parameters
    ----------
    quiz_answers : dict mapping question id (e.g. "hoppy") -> answer value (1-5)
    n            : number of recommendations to return

    Returns
    -------
    pd.Series  index = beer_id, values = cold-start score, sorted desc
    """

    if not quiz_answers:
        raise ValueError("quiz_answers must contain at least one answer.")

    taste_scores = pd.Series(0.0, index=item_profiles.index)
    answered_clusters = 0

    for cluster_id, answer_value in quiz_answers.items():
        styles = CLUSTER_STYLES.get(cluster_id)
        if not styles:
            continue

        answered_clusters += 1
        normalized_answer = max(0.0, min(float(answer_value), 5.0)) / 5.0
        matches = item_profiles["beer_style"].isin(styles)
        taste_scores.loc[matches] += normalized_answer

    if answered_clusters:
        taste_scores = taste_scores / answered_clusters

    # Popularity prior, normalised to [0, 1]
    popularity = item_profiles["avg_overall_rating"].astype(float)
    popularity_range = popularity.max() - popularity.min()
    if popularity_range > 0:
        popularity_norm = (popularity - popularity.min()) / popularity_range
    else:
        popularity_norm = pd.Series(0.0, index=item_profiles.index)

    final_scores = TASTE_WEIGHT * taste_scores + POPULARITY_WEIGHT * popularity_norm

    result = pd.Series(
        final_scores.values,
        index=item_profiles["beer_id"].values,
        name="cold_start_score",
    )

    return result.nlargest(n)
