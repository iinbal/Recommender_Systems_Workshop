"""
test_pipelines.py

Tests for data processing, CF (Collaborative Filtering), and CB (Content-Based)
recommendation pipelines.

Run with:  pytest test_pipelines.py -v
"""

import os
import sys

import numpy as np
import pandas as pd
import pytest

# Ensure project root and data_processing are importable
_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "data_processing"))

from dummy_data import make_rating_matrix
from pipeline import (
    MIN_REVIEWS_FOR_SPLIT,
    build_ultimate_cold_start_profile,
    engineer_advanced_features,
    execute_final_split,
)
import cf_pipeline as cf
import cb_pipeline as cb


# ─────────────────────────────────────────────────────────────────────────────
# SHARED FIXTURES
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def small_rating_matrix():
    """Small rating matrix (20×50) for fast, isolated CF tests."""
    return make_rating_matrix(n_users=20, n_beers=50, sparsity=0.80, seed=0)


@pytest.fixture
def raw_reviews_df():
    """
    Synthetic DataFrame that mimics the output of load_all_raw_features().
    5 users × 6 beers = 30 rows, all users have 6 reviews (≥ MIN_REVIEWS_FOR_SPLIT).
    review_time is strictly sequential so temporal ordering is deterministic.
    """
    np.random.seed(42)
    n_users, n_beers = 5, 6
    users = [f"user_{i:03d}" for i in range(n_users)]
    beers = [f"beer_{j:03d}" for j in range(n_beers)]
    n = n_users * n_beers

    return pd.DataFrame({
        "username": np.repeat(users, n_beers),
        "beer_id": beers * n_users,
        "brewer_id": np.random.randint(1, 10, n),
        "beer_name": [f"Beer {j}" for j in range(n)],
        "beer_style": np.random.choice(["IPA", "Stout", "Lager"], n),
        "beer_abv": np.random.uniform(4.0, 10.0, n),
        # Sequential timestamps ensure a clear temporal ordering per user
        "review_time": np.arange(1_000_000_000, 1_000_000_000 + n * 1000, 1000),
        "rating_overall": np.random.uniform(1.0, 5.0, n),
        "rating_taste": np.random.uniform(1.0, 5.0, n),
        "rating_aroma": np.random.uniform(1.0, 5.0, n),
        "rating_appearance": np.random.uniform(1.0, 5.0, n),
        "rating_palate": np.random.uniform(1.0, 5.0, n),
        "review_text": [f"A {'good ' * (j % 5 + 1)}beer" for j in range(n)],
    })


# ─────────────────────────────────────────────────────────────────────────────
# DUMMY DATA TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestMakeRatingMatrix:
    """Validate the synthetic rating matrix used by the CF pipeline."""

    def test_default_shape(self):
        m = make_rating_matrix()
        assert m.shape == (200, 500)

    def test_custom_shape(self, small_rating_matrix):
        assert small_rating_matrix.shape == (20, 50)

    def test_values_in_unit_range(self, small_rating_matrix):
        vals = small_rating_matrix.values
        non_nan = vals[~np.isnan(vals)]
        assert non_nan.min() >= 0.0
        assert non_nan.max() <= 1.0

    def test_sparsity_approximately_correct(self):
        m = make_rating_matrix(n_users=100, n_beers=200, sparsity=0.90, seed=7)
        actual = m.isna().values.mean()
        assert abs(actual - 0.90) < 0.10

    def test_user_index_naming_convention(self, small_rating_matrix):
        assert all(idx.startswith("user_") for idx in small_rating_matrix.index)

    def test_beer_column_naming_convention(self, small_rating_matrix):
        assert all(col.startswith("beer_") for col in small_rating_matrix.columns)

    def test_reproducibility_with_same_seed(self):
        m1 = make_rating_matrix(n_users=10, n_beers=20, seed=99)
        m2 = make_rating_matrix(n_users=10, n_beers=20, seed=99)
        pd.testing.assert_frame_equal(m1, m2)

    def test_different_seeds_produce_different_matrices(self):
        m1 = make_rating_matrix(n_users=10, n_beers=20, seed=1)
        m2 = make_rating_matrix(n_users=10, n_beers=20, seed=2)
        assert not m1.equals(m2)

    def test_every_user_has_at_least_one_rating(self, small_rating_matrix):
        ratings_per_user = small_rating_matrix.notna().sum(axis=1)
        assert (ratings_per_user >= 1).all()

    def test_returns_dataframe(self, small_rating_matrix):
        assert isinstance(small_rating_matrix, pd.DataFrame)


# ─────────────────────────────────────────────────────────────────────────────
# CF PIPELINE — SCALE DETECTION
# ─────────────────────────────────────────────────────────────────────────────

class TestDetectScale:
    """Test _detect_scale() for every known rating scale and edge cases."""

    @staticmethod
    def _df(values):
        return pd.DataFrame({"col": values})

    def test_already_normalised_returns_one(self):
        assert cf._detect_scale(self._df([0.0, 0.5, 0.9])) == 1.0

    def test_exactly_one_returns_one(self):
        assert cf._detect_scale(self._df([0.0, 1.0])) == 1.0

    def test_scale_five(self):
        assert cf._detect_scale(self._df([1.0, 3.5, 4.8])) == 5.0

    def test_scale_ten(self):
        assert cf._detect_scale(self._df([2.0, 7.5, 9.5])) == 10.0

    def test_scale_twenty(self):
        assert cf._detect_scale(self._df([5.0, 15.0, 18.0])) == 20.0

    def test_fallback_beyond_known_scales(self):
        # max=25 exceeds all known scales → returns observed max
        assert cf._detect_scale(self._df([5.0, 20.0, 25.0])) == 25.0

    def test_nan_values_are_ignored(self):
        df = pd.DataFrame({"col": [np.nan, 0.5, 0.9]})
        assert cf._detect_scale(df) == 1.0

    def test_scale_normalisation_produces_unit_range(self):
        raw = self._df([2.5, 4.0, 5.0])
        scale = cf._detect_scale(raw)
        normalised = raw / scale
        assert normalised["col"].max() <= 1.0


# ─────────────────────────────────────────────────────────────────────────────
# CF PIPELINE — MATRICES (U, V, PREDICTIONS)
# ─────────────────────────────────────────────────────────────────────────────

class TestCFPipelineMatrices:
    """Test structural properties of the matrices produced by the CF pipeline."""

    def test_u_matrix_shape(self):
        assert cf.U_df.shape == (cf.n_users, cf.k)

    def test_v_matrix_shape(self):
        assert cf.V_df.shape == (cf.n_beers, cf.k)

    def test_predicted_df_shape(self):
        assert cf.predicted_df.shape == (cf.n_users, cf.n_beers)

    def test_predicted_values_clipped_to_unit_range(self):
        assert cf.predicted_df.values.min() >= 0.0
        assert cf.predicted_df.values.max() <= 1.0

    def test_predicted_df_has_no_nan(self):
        assert not cf.predicted_df.isna().any().any()

    def test_user_means_length(self):
        assert len(cf.user_means) == cf.n_users

    def test_user_means_in_unit_range(self):
        assert cf.user_means.min() >= 0.0
        assert cf.user_means.max() <= 1.0

    def test_u_index_matches_rating_matrix_index(self):
        assert list(cf.U_df.index) == list(cf.rating_matrix.index)

    def test_v_index_matches_rating_matrix_columns(self):
        assert list(cf.V_df.index) == list(cf.rating_matrix.columns)

    def test_factor_column_names_formatted_correctly(self):
        expected = [f"factor_{i}" for i in range(cf.k)]
        assert list(cf.U_df.columns) == expected
        assert list(cf.V_df.columns) == expected

    def test_user_mean_subtraction_makes_row_means_near_zero(self):
        row_means = cf.rating_matrix_norm.mean(axis=1)
        assert (row_means.abs() < 1e-10).all()


# ─────────────────────────────────────────────────────────────────────────────
# CF PIPELINE — cf_recommend()
# ─────────────────────────────────────────────────────────────────────────────

class TestCFRecommend:
    """Test cf_recommend() return type, ranking, and no-overlap guarantees."""

    @pytest.fixture(autouse=True)
    def _active_user(self):
        rated_counts = cf.rating_matrix.notna().sum(axis=1)
        self.user = rated_counts[rated_counts >= 5].index[0]

    def test_returns_series(self):
        result = cf.cf_recommend(self.user, n=10)
        assert isinstance(result, pd.Series)

    def test_returns_at_most_n_items(self):
        result = cf.cf_recommend(self.user, n=5)
        assert len(result) <= 5

    def test_no_overlap_with_already_rated_beers(self):
        already_rated = set(cf.rating_matrix.loc[self.user].dropna().index)
        result = cf.cf_recommend(self.user, n=20)
        assert len(set(result.index) & already_rated) == 0

    def test_scores_sorted_descending(self):
        result = cf.cf_recommend(self.user, n=10)
        assert list(result.values) == sorted(result.values, reverse=True)

    def test_scores_within_unit_range(self):
        result = cf.cf_recommend(self.user, n=20)
        assert result.min() >= 0.0
        assert result.max() <= 1.0

    def test_raises_value_error_for_unknown_user(self):
        with pytest.raises(ValueError, match="not found"):
            cf.cf_recommend("nonexistent_user_99999")

    def test_requesting_zero_returns_empty(self):
        result = cf.cf_recommend(self.user, n=0)
        assert len(result) == 0


# ─────────────────────────────────────────────────────────────────────────────
# CF PIPELINE — compute_rmse_for_k()
# ─────────────────────────────────────────────────────────────────────────────

class TestComputeRMSE:
    """Test compute_rmse_for_k() validity."""

    def test_returns_float(self):
        rmse = cf.compute_rmse_for_k(cf.rating_matrix, cf.user_means, k_value=5)
        assert isinstance(rmse, float)

    def test_rmse_is_positive(self):
        rmse = cf.compute_rmse_for_k(cf.rating_matrix, cf.user_means, k_value=5)
        assert rmse > 0.0

    def test_rmse_is_in_plausible_range(self):
        rmse = cf.compute_rmse_for_k(cf.rating_matrix, cf.user_means, k_value=10)
        assert 0.0 < rmse < 1.0

    def test_larger_k_does_not_increase_rmse(self):
        rmse_small = cf.compute_rmse_for_k(cf.rating_matrix, cf.user_means, k_value=5)
        rmse_large = cf.compute_rmse_for_k(cf.rating_matrix, cf.user_means, k_value=50)
        # More factors should fit training data at least as well
        assert rmse_large <= rmse_small + 0.05  # allow small tolerance


# ─────────────────────────────────────────────────────────────────────────────
# CB PIPELINE — make_demo_data()
# ─────────────────────────────────────────────────────────────────────────────

class TestMakeDemoData:
    """Validate the structure and content of the CB pipeline demo dataset."""

    def test_item_profiles_has_five_beers(self):
        profiles, _ = cb.make_demo_data()
        assert len(profiles) == 5

    def test_train_df_has_four_ratings(self):
        _, train = cb.make_demo_data()
        assert len(train) == 4

    def test_item_profiles_contains_all_required_columns(self):
        profiles, _ = cb.make_demo_data()
        for col in cb.required_item_columns:
            assert col in profiles.columns, f"Missing column: {col}"

    def test_train_df_contains_all_required_columns(self):
        _, train = cb.make_demo_data()
        for col in cb.required_train_columns:
            assert col in train.columns, f"Missing column: {col}"

    def test_beer_ids_are_unique(self):
        profiles, _ = cb.make_demo_data()
        assert profiles["beer_id"].nunique() == len(profiles)

    def test_ratings_in_zero_to_five_range(self):
        _, train = cb.make_demo_data()
        assert train["rating_overall"].between(0, 5).all()

    def test_abv_values_are_positive(self):
        profiles, _ = cb.make_demo_data()
        assert (profiles["beer_abv"] > 0).all()


# ─────────────────────────────────────────────────────────────────────────────
# CB PIPELINE — feature matrix
# ─────────────────────────────────────────────────────────────────────────────

class TestCBFeatureMatrix:
    """Test the CB beer feature matrix built from demo data."""

    def test_feature_matrix_row_count_matches_item_profiles(self):
        assert cb.beer_feature_matrix.shape[0] == len(cb.item_profiles)

    def test_beer_id_index_covers_all_beers(self):
        assert len(cb.beer_id_to_index) == len(cb.item_profiles)

    def test_beer_ids_array_length_matches_profiles(self):
        assert len(cb.beer_ids) == len(cb.item_profiles)

    def test_all_beer_ids_in_index(self):
        for beer_id in cb.item_profiles["beer_id"]:
            assert beer_id in cb.beer_id_to_index

    def test_feature_matrix_has_no_all_zero_row(self):
        # Every beer should have at least one non-zero feature
        dense = (
            cb.beer_feature_matrix.toarray()
            if hasattr(cb.beer_feature_matrix, "toarray")
            else np.asarray(cb.beer_feature_matrix)
        )
        row_norms = np.linalg.norm(dense, axis=1)
        assert (row_norms > 0).all()


# ─────────────────────────────────────────────────────────────────────────────
# CB PIPELINE — similar_beers()
# ─────────────────────────────────────────────────────────────────────────────

class TestSimilarBeers:
    """Test similar_beers() return type, ranking, and self-exclusion."""

    @pytest.fixture(autouse=True)
    def _sample_beer(self):
        self.beer = cb.item_profiles["beer_id"].iloc[0]

    def test_returns_series(self):
        assert isinstance(cb.similar_beers(self.beer, n=3), pd.Series)

    def test_query_beer_not_in_results(self):
        result = cb.similar_beers(self.beer, n=10)
        assert self.beer not in result.index

    def test_scores_sorted_descending(self):
        result = cb.similar_beers(self.beer, n=4)
        assert list(result.values) == sorted(result.values, reverse=True)

    def test_returns_at_most_n_items(self):
        result = cb.similar_beers(self.beer, n=3)
        assert len(result) <= 3

    def test_cosine_scores_in_valid_range(self):
        # StandardScaler produces signed vectors, so cosine similarity spans [-1, 1]
        result = cb.similar_beers(self.beer, n=4)
        assert result.min() >= -1.0
        assert result.max() <= 1.0

    def test_raises_value_error_for_unknown_beer(self):
        with pytest.raises(ValueError, match="not found"):
            cb.similar_beers("nonexistent_beer_99999")

    def test_different_beers_yield_different_rankings(self):
        beer_a = cb.item_profiles["beer_id"].iloc[0]
        beer_b = cb.item_profiles["beer_id"].iloc[1]
        result_a = cb.similar_beers(beer_a, n=3)
        result_b = cb.similar_beers(beer_b, n=3)
        # Two different beers should not produce identical similarity rankings
        assert not result_a.equals(result_b)


# ─────────────────────────────────────────────────────────────────────────────
# CB PIPELINE — build_user_profile()
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildUserProfile:
    """Test build_user_profile() output shape and error handling."""

    @pytest.fixture(autouse=True)
    def _sample_user(self):
        self.user = cb.train_df["username"].iloc[0]

    def test_returns_2d_array(self):
        profile = cb.build_user_profile(self.user)
        assert profile.ndim == 2

    def test_profile_width_matches_feature_matrix(self):
        profile = cb.build_user_profile(self.user)
        assert profile.shape[1] == cb.beer_feature_matrix.shape[1]

    def test_profile_has_single_row(self):
        profile = cb.build_user_profile(self.user)
        assert profile.shape[0] == 1

    def test_raises_value_error_for_unknown_user(self):
        with pytest.raises(ValueError, match="not found"):
            cb.build_user_profile("nonexistent_user_99999")


# ─────────────────────────────────────────────────────────────────────────────
# CB PIPELINE — cb_recommend()
# ─────────────────────────────────────────────────────────────────────────────

class TestCBRecommend:
    """Test cb_recommend() return type, ranking, and no-overlap guarantee."""

    @pytest.fixture(autouse=True)
    def _sample_user(self):
        self.user = cb.train_df["username"].iloc[0]

    def test_returns_series(self):
        result = cb.cb_recommend(self.user, n=3)
        assert isinstance(result, pd.Series)

    def test_no_overlap_with_already_rated_beers(self):
        already_rated = set(cb.train_df[cb.train_df["username"] == self.user]["beer_id"])
        result = cb.cb_recommend(self.user, n=10)
        assert len(set(result.index) & already_rated) == 0

    def test_scores_sorted_descending(self):
        result = cb.cb_recommend(self.user, n=3)
        assert list(result.values) == sorted(result.values, reverse=True)

    def test_returns_at_most_n_items(self):
        result = cb.cb_recommend(self.user, n=2)
        assert len(result) <= 2

    def test_raises_value_error_for_unknown_user(self):
        with pytest.raises(ValueError, match="not found"):
            cb.cb_recommend("nonexistent_user_99999")


# ─────────────────────────────────────────────────────────────────────────────
# CB PIPELINE — get_recommendation_details()
# ─────────────────────────────────────────────────────────────────────────────

class TestGetRecommendationDetails:
    """Test get_recommendation_details() output format."""

    @pytest.fixture(autouse=True)
    def _sample_scores(self):
        user = cb.train_df["username"].iloc[0]
        self.scores = cb.cb_recommend(user, n=3)

    def test_returns_dataframe(self):
        assert isinstance(cb.get_recommendation_details(self.scores), pd.DataFrame)

    def test_empty_input_returns_empty_dataframe(self):
        result = cb.get_recommendation_details(pd.Series(dtype=float))
        assert isinstance(result, pd.DataFrame) and result.empty

    def test_output_contains_required_metadata_columns(self):
        result = cb.get_recommendation_details(self.scores)
        for col in ["beer_id", "beer_name", "beer_style", "cb_score"]:
            assert col in result.columns

    def test_rows_sorted_by_score_descending(self):
        result = cb.get_recommendation_details(self.scores)
        scores = result["cb_score"].values
        assert list(scores) == sorted(scores, reverse=True)

    def test_scores_match_input_series(self):
        result = cb.get_recommendation_details(self.scores)
        for _, row in result.iterrows():
            assert abs(row["cb_score"] - self.scores[row["beer_id"]]) < 1e-9


# ─────────────────────────────────────────────────────────────────────────────
# DATA PROCESSING — engineer_advanced_features()
# ─────────────────────────────────────────────────────────────────────────────

class TestEngineerAdvancedFeatures:
    """Test that engineer_advanced_features() adds and fills the correct columns."""

    def test_adds_review_month_column(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert "review_month" in result.columns

    def test_adds_review_year_column(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert "review_year" in result.columns

    def test_adds_review_word_count_column(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert "review_word_count" in result.columns

    def test_drops_intermediate_datetime_column(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert "review_datetime" not in result.columns

    def test_review_month_is_valid_calendar_month(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert result["review_month"].between(1, 12).all()

    def test_review_year_is_in_plausible_range(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert result["review_year"].between(1970, 2030).all()

    def test_word_count_is_non_negative(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert (result["review_word_count"] >= 0).all()

    def test_word_count_accuracy_for_known_text(self):
        df = pd.DataFrame({
            "review_time": [1_000_000_000],
            "review_text": ["this is a five word review"],
        })
        result = engineer_advanced_features(df)
        assert result["review_word_count"].iloc[0] == 6

    def test_nan_review_text_yields_zero_word_count(self):
        df = pd.DataFrame({
            "review_time": [1_000_000_000],
            "review_text": [np.nan],
        })
        result = engineer_advanced_features(df)
        assert result["review_word_count"].iloc[0] == 0

    def test_row_count_is_unchanged(self, raw_reviews_df):
        result = engineer_advanced_features(raw_reviews_df.copy())
        assert len(result) == len(raw_reviews_df)


# ─────────────────────────────────────────────────────────────────────────────
# DATA PROCESSING — execute_final_split()
# ─────────────────────────────────────────────────────────────────────────────

class TestExecuteFinalSplit:
    """Test temporal train/val/test splitting logic and data integrity."""

    @pytest.fixture
    def enriched_df(self, raw_reviews_df):
        return engineer_advanced_features(raw_reviews_df.copy())

    def test_returns_three_dataframes(self, enriched_df):
        result = execute_final_split(enriched_df)
        assert len(result) == 3

    def test_split_sizes_sum_to_total(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        assert len(train) + len(val) + len(test) == len(enriched_df)

    def test_train_is_the_largest_split(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        assert len(train) >= len(val)
        assert len(train) >= len(test)

    def test_no_user_beer_overlap_between_train_and_test(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        train_keys = set(zip(train["username"], train["beer_id"]))
        test_keys = set(zip(test["username"], test["beer_id"]))
        assert len(train_keys & test_keys) == 0

    def test_no_user_beer_overlap_between_val_and_test(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        val_keys = set(zip(val["username"], val["beer_id"]))
        test_keys = set(zip(test["username"], test["beer_id"]))
        assert len(val_keys & test_keys) == 0

    def test_no_user_beer_overlap_between_train_and_val(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        train_keys = set(zip(train["username"], train["beer_id"]))
        val_keys = set(zip(val["username"], val["beer_id"]))
        assert len(train_keys & val_keys) == 0

    def test_users_below_min_reviews_stay_in_train_only(self):
        # user_a has only 2 reviews — below MIN_REVIEWS_FOR_SPLIT (3)
        df = pd.DataFrame({
            "username": ["user_a", "user_a"],
            "beer_id": ["beer_1", "beer_2"],
            "review_time": [1000, 2000],
            "rating_overall": [4.0, 3.0],
            "review_text": ["good beer", "decent"],
        })
        df = engineer_advanced_features(df)
        train, val, test = execute_final_split(df)
        assert len(test[test["username"] == "user_a"]) == 0
        assert len(val[val["username"] == "user_a"]) == 0
        assert len(train[train["username"] == "user_a"]) == 2

    def test_test_review_is_more_recent_than_val_review(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        common_users = set(val["username"]) & set(test["username"])
        for user in common_users:
            val_time = val[val["username"] == user]["review_time"].values[0]
            test_time = test[test["username"] == user]["review_time"].values[0]
            assert test_time >= val_time

    def test_helper_columns_removed_from_all_splits(self, enriched_df):
        train, val, test = execute_final_split(enriched_df)
        for split in [train, val, test]:
            assert "user_total_reviews" not in split.columns
            assert "review_rank_from_end" not in split.columns

    def test_users_with_enough_reviews_appear_in_val_and_test(self, enriched_df):
        # All 5 fixture users have 6 reviews — each should have 1 val and 1 test row
        train, val, test = execute_final_split(enriched_df)
        for user in enriched_df["username"].unique():
            assert len(val[val["username"] == user]) == 1
            assert len(test[test["username"] == user]) == 1


# ─────────────────────────────────────────────────────────────────────────────
# DATA PROCESSING — build_ultimate_cold_start_profile()
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildUltimateColdStartProfile:
    """Test item profile construction for the CB pipeline."""

    @pytest.fixture
    def split_data(self, raw_reviews_df):
        enriched = engineer_advanced_features(raw_reviews_df.copy())
        train, _, _ = execute_final_split(enriched)
        return train, enriched

    def test_returns_dataframe(self, split_data):
        train, all_df = split_data
        assert isinstance(build_ultimate_cold_start_profile(train, all_df), pd.DataFrame)

    def test_contains_all_required_cb_pipeline_columns(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        required = [
            "beer_id", "beer_name", "beer_style", "beer_abv",
            "avg_overall_rating", "avg_taste_rating", "avg_aroma_rating",
            "avg_appearance_rating", "avg_palate_rating",
            "avg_review_word_count", "total_reviews_count", "all_reviews_text",
        ]
        for col in required:
            assert col in result.columns, f"Missing column: {col}"

    def test_one_row_per_unique_beer(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        assert result["beer_id"].nunique() == len(result)

    def test_profiles_cover_all_beers_in_dataset(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        assert set(all_df["beer_id"].unique()) == set(result["beer_id"].unique())

    def test_avg_ratings_are_in_plausible_range(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        rated = result[result["total_reviews_count"] > 0]
        assert rated["avg_overall_rating"].between(0, 5).all()

    def test_cold_start_beers_receive_zero_stats(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        train_beers = set(train["beer_id"].unique())
        cold_start = result[~result["beer_id"].isin(train_beers)]
        if not cold_start.empty:
            assert (cold_start["total_reviews_count"] == 0).all()
            assert (cold_start["avg_overall_rating"] == 0).all()

    def test_trained_beers_have_non_empty_review_text(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        train_beers = set(train["beer_id"].unique())
        rated = result[result["beer_id"].isin(train_beers)]
        assert (rated["all_reviews_text"] != "").all()

    def test_all_reviews_text_column_has_no_nulls(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        assert result["all_reviews_text"].notna().all()

    def test_total_reviews_count_matches_train_group_sizes(self, split_data):
        train, all_df = split_data
        result = build_ultimate_cold_start_profile(train, all_df)
        expected_counts = train.groupby("beer_id").size().to_dict()
        for beer_id, expected_count in expected_counts.items():
            row = result[result["beer_id"] == beer_id]
            assert row["total_reviews_count"].values[0] == expected_count
