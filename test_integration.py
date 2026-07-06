"""
test_integration.py

End-to-end integration tests for the FastAPI backend endpoints.
Requires the pipelines to be loaded (either from artifacts or CSVs).

Run with:  py -m pytest test_integration.py -v
"""

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_ROOT))

_has_artifacts = (_ROOT / "artifacts" / "cf_U.npy").exists()
_has_csvs = (_ROOT / "data" / "train_set.csv").exists()
_can_run = _has_artifacts or _has_csvs

pytestmark = pytest.mark.skipif(
    not _can_run,
    reason="No artifacts or training CSVs found; integration tests require a loaded pipeline.",
)


@pytest.fixture(scope="module")
def client():
    from starlette.testclient import TestClient
    from backend.api_server import app

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture(scope="module")
def sample_user():
    import cf_pipeline as cf
    return str(cf.user_ids[0])


@pytest.fixture(scope="module")
def sample_users():
    import cf_pipeline as cf
    ids = [str(u) for u in cf.user_ids[:2]]
    if len(ids) < 2:
        ids = ids * 2
    return ids


@pytest.fixture(scope="module")
def sample_beer():
    import cb_pipeline as cb
    return str(cb.item_profiles["beer_id"].iloc[0])


def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "message" in response.json()


def test_recommendations_valid_user(client, sample_user):
    response = client.get(f"/recommendations/{sample_user}")
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
    assert isinstance(body["recommended_ids"], list)
    assert isinstance(body["scores"], list)
    assert len(body["recommended_ids"]) == len(body["scores"])


def test_recommendations_invalid_user(client):
    response = client.get("/recommendations/unknown_user_99999")
    assert response.status_code == 404


def test_recommendations_custom_count(client, sample_user):
    response = client.get(f"/recommendations/{sample_user}?rec_num=5")
    assert response.status_code == 200
    body = response.json()
    assert len(body["recommended_ids"]) <= 5
    assert len(body["recommended_ids"]) == len(body["scores"])


def test_beer_details_valid(client, sample_beer):
    response = client.get(f"/beers/{sample_beer}")
    assert response.status_code == 200
    body = response.json()
    expected = {
        "beer_id", "beer_name", "beer_style", "beer_abv",
        "avg_overall_rating", "avg_taste_rating", "avg_aroma_rating",
        "avg_appearance_rating", "avg_palate_rating", "total_reviews_count",
    }
    assert expected.issubset(body.keys())


def test_beer_details_not_found(client):
    response = client.get("/beers/nonexistent_beer")
    assert response.status_code == 404


def test_similar_beers_valid(client, sample_beer):
    response = client.get(f"/beers/similar/{sample_beer}?n=5")
    assert response.status_code == 200
    body = response.json()
    assert "beer_id" in body
    assert "similar" in body
    assert isinstance(body["similar"], list)


def test_similar_beers_not_found(client):
    response = client.get("/beers/similar/nonexistent_beer")
    assert response.status_code == 404


def test_group_recommendations(client, sample_users):
    group = ",".join(sample_users)
    response = client.get(f"/recommendations/group?group={group}")
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
    assert len(body["recommended_ids"]) == len(body["scores"])


# ─────────────────────────────────────────────────────────────────────────────
# ADVENTUROUS / ANTI-RECOMMENDER LISTS
# ─────────────────────────────────────────────────────────────────────────────

def test_adventurous_recommendations(client, sample_user):
    response = client.get(f"/recommendations/{sample_user}/adventurous?rec_num=5")
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
    assert len(body["recommended_ids"]) == len(body["scores"])
    assert len(body["recommended_ids"]) <= 5


def test_adventurous_recommendations_invalid_user(client):
    response = client.get("/recommendations/unknown_user_99999/adventurous")
    assert response.status_code == 404


def test_anti_recommendations(client, sample_user):
    response = client.get(f"/recommendations/{sample_user}/anti?rec_num=5")
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
    assert len(body["recommended_ids"]) == len(body["scores"])
    assert len(body["recommended_ids"]) <= 5


def test_anti_recommendations_invalid_user(client):
    response = client.get("/recommendations/unknown_user_99999/anti")
    assert response.status_code == 404


def test_anti_recommendations_disjoint_from_top_recommendations(client, sample_user):
    """Anti-recs (the model's worst predictions) should never overlap with its
    best (top recommendations) for the same user."""
    top = client.get(f"/recommendations/{sample_user}?rec_num=10").json()
    anti = client.get(f"/recommendations/{sample_user}/anti?rec_num=10").json()
    assert set(top["recommended_ids"]).isdisjoint(set(anti["recommended_ids"]))


# ─────────────────────────────────────────────────────────────────────────────
# SINGLE-BEER COMPATIBILITY SCORE
# ─────────────────────────────────────────────────────────────────────────────

def test_beer_compatibility_valid(client, sample_user, sample_beer):
    response = client.get(f"/recommendations/{sample_user}/beer/{sample_beer}")
    assert response.status_code == 200
    body = response.json()
    assert sample_beer in body
    assert isinstance(body[sample_beer], (int, float))


def test_beer_compatibility_invalid_beer(client, sample_user):
    """An unknown beer_id must 404, not 500 (regression: specific= mode used to
    raise an uncaught KeyError for garbage input)."""
    response = client.get(f"/recommendations/{sample_user}/beer/nonexistent_beer_99999")
    assert response.status_code == 404


def test_beer_compatibility_invalid_user(client, sample_beer):
    response = client.get(f"/recommendations/unknown_user_99999/beer/{sample_beer}")
    assert response.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# ONBOARDING (COLD-START) ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

def test_onboarding_from_attributes(client):
    response = client.post("/onboarding/from-attributes", json={
        "taste": 4, "aroma": 3, "appearance": 3, "palate": 4,
        "abv_pref": "medium", "styles": ["IPA"], "n": 5,
    })
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
    assert len(body["recommended_ids"]) == len(body["scores"])
    assert len(body["recommended_ids"]) <= 5


def test_onboarding_from_attributes_requires_a_style(client):
    response = client.post("/onboarding/from-attributes", json={
        "taste": 4, "aroma": 3, "appearance": 3, "palate": 4,
        "abv_pref": "medium", "styles": [],
    })
    assert response.status_code == 422


def test_onboarding_from_attributes_rejects_out_of_range_score(client):
    response = client.post("/onboarding/from-attributes", json={
        "taste": 10, "aroma": 3, "appearance": 3, "palate": 4,
        "abv_pref": "medium", "styles": ["IPA"],
    })
    assert response.status_code == 422


def test_onboarding_from_attributes_persists_synthetic_ratings(client, sample_user):
    """Passing a user_id should persist the top-10 picks as real (1-5 star)
    ratings in the online store, so this user's later /recommendations calls
    have fold-in signal instead of falling back to a cold-start path."""
    from backend.online_store import clear_user, get_user_ratings
    clear_user(sample_user)

    response = client.post("/onboarding/from-attributes", json={
        "user_id": sample_user,
        "taste": 4, "aroma": 3, "appearance": 3, "palate": 4,
        "abv_pref": "medium", "styles": ["IPA"], "n": 5,
    })
    assert response.status_code == 200

    ratings = get_user_ratings(sample_user)
    assert len(ratings) == 10
    assert all(1 <= r <= 5 for r in ratings.values())

    clear_user(sample_user)


def test_onboarding_hybrid_blends_rated_beers_and_attributes(client, sample_beer):
    response = client.post("/onboarding/hybrid", json={
        "rated_beers": {sample_beer: 5},
        "attributes": {
            "taste": 4, "aroma": 3, "appearance": 3, "palate": 4,
            "abv_pref": "medium", "styles": ["IPA"],
        },
        "n": 5,
    })
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
    assert len(body["recommended_ids"]) == len(body["scores"])


def test_onboarding_hybrid_requires_at_least_one_signal(client):
    response = client.post("/onboarding/hybrid", json={"n": 5})
    assert response.status_code == 400


# ─────────────────────────────────────────────────────────────────────────────
# ONLINE FEEDBACK LOOP TESTS
# ─────────────────────────────────────────────────────────────────────────────

def test_submit_rating_success(client, sample_user, sample_beer):
    """POST /ratings records a rating and returns ok."""
    from backend.online_store import clear_user
    clear_user(sample_user)

    response = client.post("/ratings", json={
        "user_id": sample_user,
        "beer_id": sample_beer,
        "rating": 5,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "excluded" in body

    clear_user(sample_user)


def test_submit_rating_missing_fields(client):
    """POST /ratings with missing fields returns 400."""
    response = client.post("/ratings", json={"user_id": "test"})
    assert response.status_code == 400


def test_rated_beer_excluded_from_recommendations(client, sample_user, sample_beer):
    """After rating a beer, it must not appear in subsequent recommendations."""
    from backend.online_store import clear_user
    clear_user(sample_user)

    # Get recommendations BEFORE rating
    before = client.get(f"/recommendations/{sample_user}?rec_num=20")
    assert before.status_code == 200
    ids_before = before.json()["recommended_ids"]

    # Pick a beer that IS in the current recommendations to rate
    if ids_before:
        target_beer = ids_before[0]

        # Rate it
        client.post("/ratings", json={
            "user_id": sample_user,
            "beer_id": str(target_beer),
            "rating": 4,
        })

        # Get recommendations AFTER rating
        after = client.get(f"/recommendations/{sample_user}?rec_num=20")
        assert after.status_code == 200
        ids_after = after.json()["recommended_ids"]

        # The rated beer must be gone
        assert target_beer not in ids_after

    clear_user(sample_user)


def test_online_store_clear_resets_exclusions(client, sample_user, sample_beer):
    """After clearing a user's online state, excluded beers can reappear."""
    from backend.online_store import clear_user, get_excluded_ids, record_rating

    clear_user(sample_user)
    record_rating(sample_user, sample_beer, 5.0)
    assert sample_beer in get_excluded_ids(sample_user)

    clear_user(sample_user)
    assert len(get_excluded_ids(sample_user)) == 0
