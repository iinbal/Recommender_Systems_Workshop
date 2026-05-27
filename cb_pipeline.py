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

from pathlib import Path

import numpy as np
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import OneHotEncoder, StandardScaler


BASE_DIR = Path(__file__).resolve().parent

ITEM_PROFILES_PATH = BASE_DIR / "item_profiles_for_cold_start_enriched.csv"
TRAIN_PATH = BASE_DIR / "train_set_enriched.csv"


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


if ITEM_PROFILES_PATH.exists() and TRAIN_PATH.exists():
    item_profiles = pd.read_csv(ITEM_PROFILES_PATH)
    train_df = pd.read_csv(TRAIN_PATH)
    print("Loaded real CSV files.")
else:
    item_profiles, train_df = make_demo_data()
    print("WARNING: Real CSV files not found. Running with demo data.")

print(f"Item profiles loaded: {item_profiles.shape}")
print(f"Train data loaded:    {train_df.shape}")


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


def cb_recommend(user_id: str, n: int = 10) -> pd.Series:
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

    if not candidate_indices:
        return pd.Series(dtype=float, name="cb_score")

    candidate_scores = similarities[candidate_indices]
    top_order = np.argsort(candidate_scores)[::-1][:n]
    top_indices = [candidate_indices[i] for i in top_order]

    return pd.Series(
        similarities[top_indices],
        index=item_profiles.iloc[top_indices]["beer_id"].values,
        name="cb_score",
    ).sort_values(ascending=False)


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


def popularity_recommend(n: int = 10, style: str = None) -> pd.Series:
    """
    Return top-N beers by popularity score — used for cold-start (new) users.

    Popularity score = avg_overall_rating × log(1 + total_reviews_count).
    This rewards quality while dampening the outsized effect of review volume.

    Parameters
    ----------
    n     : number of beers to return
    style : optional beer style filter (case-insensitive, e.g. "IPA", "Stout").
            Falls back to the full catalog if no beers match the style.

    Returns
    -------
    pd.Series  index = beer_id, values = popularity score, sorted desc
    """
    profiles = item_profiles.copy()

    if style:
        filtered = profiles[profiles["beer_style"].str.lower() == style.lower()]
        if not filtered.empty:
            profiles = filtered

    profiles["_pop_score"] = (
        profiles["avg_overall_rating"] * np.log1p(profiles["total_reviews_count"])
    )

    top = profiles.nlargest(n, "_pop_score")
    return pd.Series(
        top["_pop_score"].values,
        index=top["beer_id"].values,
        name="popularity_score",
    ).sort_values(ascending=False)


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
