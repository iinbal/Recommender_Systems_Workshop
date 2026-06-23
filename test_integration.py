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
_has_csvs = (_ROOT / "train_set_enriched.csv").exists()
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


def test_quiz_endpoint(client):
    response = client.get("/quiz")
    assert response.status_code == 200
    body = response.json()
    assert "questions" in body
    for question in body["questions"]:
        assert "id" in question
        assert "options" in question


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
    assert response.status_code == 500


def test_recommendations_custom_count(client, sample_user):
    response = client.get(f"/recommendations/{sample_user}?rec_num=5")
    assert response.status_code == 200
    body = response.json()
    assert len(body["recommended_ids"]) <= 5
    assert len(body["recommended_ids"]) == len(body["scores"])


def test_cold_start(client):
    response = client.post(
        "/recommendations/cold-start",
        json={"answers": {"hoppy": 5, "dark": 1, "sour": 1, "light": 2}},
    )
    assert response.status_code == 200
    body = response.json()
    assert "recommended_ids" in body
    assert "scores" in body
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
