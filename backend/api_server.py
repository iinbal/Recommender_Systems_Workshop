import logging
from pathlib import Path

logger = logging.getLogger(__name__)

import cf_pipeline as cf
import cb_pipeline as cb
import cold_start
import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sklearn.metrics.pairwise import cosine_similarity
from contextlib import asynccontextmanager

from backend.online_store import (
    record_rating, get_excluded_ids, add_score_adjustments, get_score_adjustments,
    record_rating_value, get_user_ratings, rehydrate as _rehydrate_store,
)

import menu_vision
import menu_matcher

NEW_RATINGS_PATH = Path(__file__).resolve().parent.parent / "new_ratings.csv"

STANDARD_CF_WEIGHT = 0.6   # CF weight for users with >= CF_WEIGHT_FULL_RATINGS ratings
CF_WEIGHT_MIN = 0.1        # CF weight for new users with no rating history
CF_WEIGHT_FULL_RATINGS = 5  # rating count at which CF weight reaches STANDARD_CF_WEIGHT
STANDARD_LAMBDA = 0.25
STANDARD_GROUP_PENALTY = 0.5
HYBRID_MULTIPLIER = 3
RERANK_MULTIPLIER = 2
DEFAULT_RECOMMENDATION_NUM = 10
MIN_FOLDIN_RATINGS = 5
ADVENTURE_MIN_POOL_MULTIPLIER = 5  # mid_range must be this many times rec_num for real sampling variety

@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """
    Lifespan for the FastApi app
    Code before the yield executes on startup and code after on shutdown
    """
    # Populate the store from disk
    _rehydrate_online_store()

    # Check the model artifacts
    artifacts_dir = Path(__file__).resolve().parent.parent / "artifacts"
    if not artifacts_dir.exists():
        print("WARNING: artifacts/ directory not found. Pipelines are using on-the-fly computation.")
        print("Run 'python train_models.py' to pre-compute model artifacts for faster startup.")
    else:
        print("artifacts/ directory found. Pipelines loaded pre-computed models.")
    yield

app = FastAPI(lifespan=app_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:5174", "http://127.0.0.1:5174",
                   "http://localhost:5175", "http://127.0.0.1:5175"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _persist_rating(user_id: str, beer_id, rating: float) -> None:
    """Append a rating row to new_ratings.csv for eventual retraining."""
    try:
        write_header = not NEW_RATINGS_PATH.exists()
        row = pd.DataFrame([{
            "username": str(user_id),
            "beer_id": str(beer_id),
            "rating_overall": rating,
        }])
        row.to_csv(NEW_RATINGS_PATH, mode="a", header=write_header, index=False)
    except Exception as exc:
        logging.warning("Failed to persist rating to %s: %s", NEW_RATINGS_PATH, exc)


def _cast_beer_id_for_pipeline(beer_id):
    """Cast beer_id to match the pipeline's type (int for real data, str for demo)."""
    col = cb.item_profiles["beer_id"]
    if col.dtype != object:
        try:
            return col.dtype.type(beer_id)
        except (ValueError, TypeError):
            pass
    return beer_id


def _record_and_persist_rating(user_id: str, beer_id, rating: float) -> None:
    """Record a rating in the online store and durably append it to new_ratings.csv.
    Shared by POST /ratings and the cold-start endpoints that synthesize ratings."""
    beer_id = _cast_beer_id_for_pipeline(beer_id)
    record_rating(user_id, beer_id, rating)
    record_rating_value(user_id, beer_id, rating)
    _persist_rating(user_id, beer_id, rating)


def _rehydrate_online_store() -> None:
    """Repopulate online_store from new_ratings.csv on startup so registered
    users' personalization survives a backend restart."""
    if not NEW_RATINGS_PATH.exists():
        return
    try:
        df = pd.read_csv(NEW_RATINGS_PATH)
        rows = (
            (str(r.username), _cast_beer_id_for_pipeline(r.beer_id), float(r.rating_overall))
            for r in df.itertuples(index=False)
        )
        count = _rehydrate_store(rows)
        print(f"Rehydrated online_store with {count} rating(s) from {NEW_RATINGS_PATH}")
    except Exception as exc:
        print(f"WARNING: Failed to rehydrate online_store from {NEW_RATINGS_PATH}: {exc}")


@app.get("/")
async def root():
    return {"message": "You shouldn't be here ;)"}


@app.get("/users/sample")
async def get_sample_users(n: int = 5):
    """Return user IDs that are valid in both pipelines and have enough ratings."""
    cb_users = set(cb.train_df["username"].unique())
    MIN_RATINGS = 50
    valid = []
    for uid in cf.user_ids:
        if uid not in cb_users:
            continue
        idx = cf.user_id_to_index[uid]
        if cf.R_sparse.getrow(idx).nnz >= MIN_RATINGS:
            valid.append(uid)
        if len(valid) >= n:
            break
    return {"user_ids": valid}


@app.get("/recommendations/group")
async def get_group_recommend(group: str = "", rec_num: int = DEFAULT_RECOMMENDATION_NUM):
    """
    Returns a list of recommended beers for a given group

    Parameters:
    - group: Comma-separated string of user IDs (e.g., "user_1,user_2,user_3")

    Returns:
    - pd.Series: Beer IDs as index, final penalized group scores as values,
                 sorted in descending order.
    """
    # Parse the comma-separated string into a clean list of user IDs
    user_ids = [user_id.strip() for user_id in group.split(",")]

    if user_ids == ['']:
        return "No users provided"

    try:
        # Assuming get_recommendations(user_id) returns a pd.Series
        user_candidates = get_group_candidates(user_ids, RERANK_MULTIPLIER * rec_num)

        # Apply reranking diversity
        final_recommendations = rerank_recommendations(user_candidates, rec_num)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
            "recommended_ids": final_recommendations.index.tolist(),
            "scores": final_recommendations.values.tolist()
        }

@app.post("/recommendations/menu-upload")
async def get_menu_recommendations(
    user_id: str = Form(...),
    image: UploadFile = File(...),
    rec_num: int = Form(DEFAULT_RECOMMENDATION_NUM),
):
    """
    Accept a menu image, extract beer names via vision AI, fuzzy-match against
    the catalog, then return recommendations filtered to those beers only.
    """
    image_bytes = await image.read()

    # Step 1: extract beer names from the image
    extracted = menu_vision.extract_beers_from_image(image_bytes)
    logger.warning("Menu scan: Gemini extracted %d beer(s): %s", len(extracted), [e.get("name") for e in extracted])

    # Step 2: fuzzy-match against beers that have CB feature vectors.
    # beer_id_to_index may have str keys even when item_profiles["beer_id"] is int64
    # (train_models.py saves them with astype(str)).  Build a str→index map so the
    # isin() check and later matrix slices work regardless of the key type.
    cb_str_to_index = {str(k): v for k, v in cb.beer_id_to_index.items()}
    recommendable_profiles = cb.item_profiles[
        cb.item_profiles["beer_id"].astype(str).isin(cb_str_to_index)
    ]
    logger.warning(
        "Menu scan: catalog size — item_profiles=%d  beer_id_to_index=%d  recommendable=%d",
        len(cb.item_profiles), len(cb.beer_id_to_index), len(recommendable_profiles),
    )
    matched_ids, total_extracted = menu_matcher.match_menu_beers(
        extracted, recommendable_profiles
    )
    logger.warning("Menu scan: matched %d/%d beers to catalog", len(matched_ids), total_extracted)

    if not matched_ids:
        return {
            "recommended_ids": [],
            "scores": [],
            "matched_count": 0,
            "total_extracted": total_extracted,
        }

    # matched_ids come from item_profiles["beer_id"] (native dtype).
    # Use cb_str_to_index (str keys) for the matrix slice so there is no type mismatch.
    matched_cb_indices = [cb_str_to_index[str(bid)] for bid in matched_ids]
    matched_features = cb.beer_feature_matrix[matched_cb_indices]

    # For pd.Series indices, keep native item_profiles dtype via the existing cast helper.
    col = cb.item_profiles["beer_id"]
    def _cast(bid):
        if col.dtype != object:
            try:
                return col.dtype.type(bid)
            except (ValueError, TypeError):
                return bid
        return bid
    cast_ids = [_cast(bid) for bid in matched_ids]

    cb_scores = None
    try:
        user_profile = cb.build_user_profile(user_id)
        sims = cosine_similarity(user_profile, matched_features).flatten()
        cb_scores = pd.Series(sims, index=cast_ids)
    except ValueError:
        pass

    cf_scores = None
    if user_id in cf.user_id_to_index:
        try:
            user_idx = cf.user_id_to_index[user_id]
            cf_indices = [cf.beer_id_to_index[bid] for bid in cast_ids if bid in cf.beer_id_to_index]
            cf_ids    = [bid                        for bid in cast_ids if bid in cf.beer_id_to_index]
            if cf_indices:
                raw = cf.U[user_idx] @ cf.V[cf_indices].T + cf.user_means[user_idx]
                cf_scores = pd.Series(np.clip(raw, 0.0, 1.0), index=cf_ids)
        except Exception:
            pass

    session_ratings = get_user_ratings(user_id)
    historical_count = (
        cf.R_sparse.getrow(cf.user_id_to_index[user_id]).nnz
        if user_id in cf.user_id_to_index else 0
    )
    cf_weight = get_cf_weight(historical_count + len(session_ratings))

    if cf_scores is not None and cb_scores is not None:
        blended = hybrid_scores(cf_scores, cb_scores, cf_weight)
    elif cf_scores is not None:
        blended = cf_scores
    elif cb_scores is not None:
        blended = cb_scores
    else:
        # Unknown user: rank matched beers by popularity
        pop = recommendable_profiles[recommendable_profiles["beer_id"].isin(cast_ids)].copy()
        pop = pop.set_index("beer_id")["avg_overall_rating"].fillna(0.0)
        pop.index = pop.index.map(_cast)
        blended = pop / pop.max() if pop.max() > 0 else pop

    # Exclude beers already rated this session
    exclude = get_excluded_ids(user_id)
    blended = blended[~blended.index.isin(exclude)]

    if blended.empty:
        return {"recommended_ids": [], "scores": [], "matched_count": len(cast_ids), "total_extracted": total_extracted}

    # Sort by score descending — no MMR here since the pool is already small
    # (only beers from the physical menu) and we want strict best-first ordering.
    final = blended.nlargest(min(rec_num, len(blended)))

    return {
        "recommended_ids": final.index.tolist(),
        "scores": final.values.tolist(),
        "matched_count": len(cast_ids),
        "total_extracted": total_extracted,
    }


@app.get("/recommendations/{user_id}")
async def get_recommendation(user_id: str, rec_num: int = DEFAULT_RECOMMENDATION_NUM):
    """
    Return a list of recommended beers tailored to the given user

    Parameters:
    - user_id: String id of the users we want recommendations for
    - rec_num: Number of wanted recommendations. Optional

    Returns:
    - List of ids of recommended beers for the user
    - List of scores for the beers
    """

    try:
        hybrid_candidates = get_user_rec_candidates(user_id, rec_num * RERANK_MULTIPLIER)

        # Further refine our recommendations while using reranking to introduce diversity
        selected_recommendations = rerank_recommendations(hybrid_candidates, rec_num)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
            "recommended_ids": selected_recommendations.index.tolist(),
            "scores": selected_recommendations.values.tolist()
        }

@app.get("/recommendations/{user_id}/beer/{beer_id}")
async def get_beer_compatability(user_id: str, beer_id:str):
    """
    Return beer compatability score for the user

    Parameters:
    - user_id: String id of the users we want recommendations for
    - beer_id: the id of the beer you want a score for

    Returns:
    - Predicted compatability score
    """
    beer_id = _cast_beer_id_for_pipeline(beer_id)
    session_ratings = get_user_ratings(user_id)

    try:
        cf_score = cf.cf_recommend(user_id, specific = beer_id)
    except ValueError:
        cf_score = None

    try:
        cb_score = cb.cb_recommend(user_id, specific = beer_id)
    except ValueError:
        cb_score = None

    # New-user fallback: score directly from session ratings (mirrors the
    # cold-start path in get_user_rec_candidates/get_user_anti_candidates).
    if cf_score is None and cb_score is None and session_ratings:
        try:
            cb_score = cb.cb_recommend_from_ratings(session_ratings, specific=beer_id)
        except ValueError:
            pass
        if len(session_ratings) >= MIN_FOLDIN_RATINGS:
            try:
                cf_score = cf.cf_recommend_new_user(session_ratings, specific=beer_id)
            except ValueError:
                pass

    if cf_score is not None and cb_score is not None:
        # Compute per-user CF weight: more ratings → more trust in CF signal
        historical_count = cf.R_sparse.getrow(cf.user_id_to_index[user_id]).nnz if user_id in cf.user_id_to_index else 0
        cf_weight = get_cf_weight(historical_count + len(session_ratings))

        beer_score = (cf_weight * cf_score) + ((1 - cf_weight) * cb_score)
    elif cf_score is not None or cb_score is not None:
        beer_score = cf_score if cf_score is not None else cb_score
    else:
        raise HTTPException(status_code=404, detail="Invalid User or Beer ID")

    return {
            str(beer_id): beer_score,
        }

@app.get("/recent/{user_id}")
async def get_recent_ratings(user_id: str):
    recent = get_user_ratings(user_id)

    return {
        "recommended_ids": list(recent.keys),
        "scores": list(recent.values)
    }

@app.get("/recommendations/{user_id}/adventurous")
async def get_adventurous_recommendations(user_id: str, rec_num: int = DEFAULT_RECOMMENDATION_NUM):
    """Return beers from the mid-range of a user's predicted scores — adventurous picks
    that diverge from the user's core taste profile."""
    try:
        large_pool = get_user_rec_candidates(user_id, 500)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Filter to the 0.80–0.95 score band for genuine taste divergence
    mid_range = large_pool[(large_pool >= 0.80) & (large_pool <= 0.95)]

    # If the band is too small relative to rec_num, sampling degenerates into
    # returning the entire (deterministic) band every time — widen the pool instead.
    if len(mid_range) < rec_num * ADVENTURE_MIN_POOL_MULTIPLIER:
        mid_range = large_pool.iloc[50:]

    sample_size = min(rec_num, len(mid_range))
    if sample_size == 0:
        return {"recommended_ids": [], "scores": []}

    sampled = mid_range.sample(n=sample_size)
    sampled = sampled.sort_values(ascending=False)

    return {
        "recommended_ids": sampled.index.tolist(),
        "scores": sampled.values.tolist(),
    }

@app.get("/recommendations/{user_id}/anti")
async def get_anti_recommendations(user_id: str, rec_num: int = DEFAULT_RECOMMENDATION_NUM):
    """Return beers the user is predicted to dislike the most — the anti-recommendations."""
    try:
        anti_candidates = get_user_anti_candidates(user_id, rec_num)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "recommended_ids": anti_candidates.index.tolist(),
        "scores": anti_candidates.values.tolist(),
    }

load_dotenv()  # Load environment variables from .env file
_Stav_client = genai.Client() if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") else None

@app.post("/api/chat")
async def chat_with_Stav(payload: dict = Body(...)):
    """
    Endpoint to handle incoming chat messages using RAG (Retrieval-Augmented Generation).
    """
    user_message = payload.get("message", "")
    
    # ---------------------------------------------------------
    # STEP 1: THE RETRIEVAL (Gathering context from your DB)
    # ---------------------------------------------------------
    # For now, let's grab the top 5 highest-rated beers so Stav has something to talk about.
    # Later, you can do a regex search on user_message to find specific styles!
    top_beers_df = cb.item_profiles.nlargest(5, "avg_overall_rating")
    
    # Format the dataframe into a readable string for the AI
    beer_context = ""
    for _, row in top_beers_df.iterrows():
        beer_context += f"- {row['beer_name']} (Style: {row['beer_style']}, ABV: {row['beer_abv']}%, Rating: {row.get('avg_overall_rating', 0):.2f})\n"

    # ---------------------------------------------------------
    # STEP 2: THE SYSTEM PROMPT (Stav's Persona + Knowledge)
    # ---------------------------------------------------------
    system_prompt = f"""
    You are Stav, the friendly, knowledgeable AI assistant for the RuBeer recommendation system.
    
    [BEER KNOWLEDGE]
    Here is the current list of top-rated beers you can recommend:
    {beer_context}
    
    [WEBSITE NAVIGATION GUIDE]
    You also help users navigate the RuBeer platform. If they ask where to find things, use this map of our platform:
    - Dashboard: The home page showing the top recommended beers for the user or the user and his selected peers, including the rating of these beers, the matching rating (in percentages), and when a beer is clicked, a beer modal pops up with the ability to rate it and add a review.
    - Navbar: The top navigation bar where users can access different sections of the platform:
        - Home: The main landing page with general information and top recommendations.
        - Discover: where users can explore beers by style, ABV, and other attributes, build and access beer lists and see the top-rated beers across the platform, and use the "build a 6 pack" feature to create a personalized selection of beers.
        - Favorites: where users can view and edit their favorite beers.
        - Shared with me: where users can see beers that have been shared with them by other users.
        - profile: where users can view and edit their personal information, password, view their rating history, add/remove friends, and see their compatibility with friends based on beer ratings.
    - at any time a user can click the 'heart' icon to add a beer to their favorites, and click the 'share' icon to share a beer with friends.
    - you can log out of the platform by clicking the 'logout' button in the profile section.

    If a user asks about something unrelated to beer or the RuBeer platform, gently steer the conversation back to beer.
    """

    # ---------------------------------------------------------
    # STEP 3: THE GENERATION (Calling the LLM)
    # ---------------------------------------------------------
    try:
        if _Stav_client is None:
            raise RuntimeError("Gemini API key is not configured.")

        # Generate the response asynchronously so we don't block the FastAPI server
        response = await _Stav_client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=user_message,
            config=types.GenerateContentConfig(system_instruction=system_prompt),
        )

        return {"reply": response.text}

    except Exception as e:
        print(f"Gemini Error: {e}")
        return {"reply": f"I heard you say '{user_message}', but my connection to Gemini is currently down! Tell the devs to check my API key."}

@app.post("/ratings")
async def submit_rating(payload: dict = Body(...)):
    """
    Record a user's beer rating for real-time recommendation updates.

    Mandatory: The rated beer is immediately excluded from future recommendations.
    Bonus: If rating >= 4, similar beers get a score boost. If rating <= 2, they get a penalty.

    Expected payload: {"user_id": "user_0001", "beer_id": "3947", "rating": 5}
    """
    user_id = payload.get("user_id")
    beer_id = payload.get("beer_id")
    rating = payload.get("rating")

    if not all([user_id, beer_id, rating is not None]):
        raise HTTPException(status_code=400, detail="user_id, beer_id, and rating are required")

    rating = float(rating)
    beer_id = _cast_beer_id_for_pipeline(beer_id)

    # Mandatory: exclude this beer from future recommendations
    _record_and_persist_rating(user_id, beer_id, rating)

    # Bonus: heuristic score adjustments for similar beers
    if beer_id in cb.beer_id_to_index or str(beer_id) in [str(k) for k in cb.beer_id_to_index]:
        try:
            lookup_id = beer_id
            if beer_id not in cb.beer_id_to_index:
                for key in cb.beer_id_to_index:
                    if str(key) == str(beer_id):
                        lookup_id = key
                        break

            similar = cb.similar_beers(lookup_id, n=5)
            if rating >= 4:
                multiplier = 1.2  # 20% boost
            elif rating <= 2:
                multiplier = 0.8  # 20% penalty
            else:
                multiplier = 1.0  # neutral

            if multiplier != 1.0:
                adjustments = {bid: multiplier for bid in similar.index}
                add_score_adjustments(user_id, adjustments)
        except (ValueError, KeyError):
            pass  # beer not in catalog, skip adjustment

    return {"status": "ok", "excluded": str(beer_id)}


@app.get("/beers/top")
async def get_top_beers(n: int = 50):
    """Return the top-N highest-rated beers from live artifact data."""
    df = cb.item_profiles.nlargest(n, "avg_overall_rating")
    return [
        {
            "beer_id": str(row["beer_id"]),
            "beer_name": str(row["beer_name"]),
            "beer_style": str(row["beer_style"]),
            "beer_abv": float(row["beer_abv"]),
            "avg_overall_rating": float(row.get("avg_overall_rating", 0)),
            "avg_taste_rating": float(row.get("avg_taste_rating", 0)),
            "avg_aroma_rating": float(row.get("avg_aroma_rating", 0)),
            "avg_appearance_rating": float(row.get("avg_appearance_rating", 0)),
            "avg_palate_rating": float(row.get("avg_palate_rating", 0)),
            "total_reviews_count": int(row.get("total_reviews_count", 0)),
        }
        for _, row in df.iterrows()
    ]


@app.get("/beers/search")
async def search_beers(q: str, limit: int = 20):
    """Search beers by name substring."""
    if len(q) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters.")
    limit = min(limit, 50)
    mask = cb.item_profiles["beer_name"].str.contains(q, case=False, na=False, regex=False)
    matches = cb.item_profiles[mask]
    results = matches.head(limit)[["beer_id", "beer_name", "beer_style", "beer_abv", "avg_overall_rating"]].copy()
    results["beer_abv"] = pd.to_numeric(results["beer_abv"], errors="coerce").round(1)
    results["avg_overall_rating"] = pd.to_numeric(results["avg_overall_rating"], errors="coerce").round(2)
    return {
        "results": results.to_dict(orient="records"),
        "total_matches": int(mask.sum()),
        "showing": len(results),
    }


@app.get("/beers/{beer_id}")
async def get_beer(beer_id: str):
    """Return full metadata for a single beer."""
    try:
        col = cb.item_profiles["beer_id"]
        if col.dtype != object:
            try:
                beer_id_cast = col.dtype.type(beer_id)
            except (ValueError, TypeError):
                beer_id_cast = beer_id
        else:
            beer_id_cast = beer_id
        matches = cb.item_profiles[col == beer_id_cast]

        if matches.empty:
            raise HTTPException(status_code=404, detail=f"Beer '{beer_id}' not found")

        beer = matches.iloc[0]
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "beer_id": str(beer["beer_id"]),
        "beer_name": str(beer["beer_name"]),
        "beer_style": str(beer["beer_style"]),
        "beer_abv": float(beer["beer_abv"]),
        "avg_overall_rating": float(beer.get("avg_overall_rating", 0)),
        "avg_taste_rating": float(beer.get("avg_taste_rating", 0)),
        "avg_aroma_rating": float(beer.get("avg_aroma_rating", 0)),
        "avg_appearance_rating": float(beer.get("avg_appearance_rating", 0)),
        "avg_palate_rating": float(beer.get("avg_palate_rating", 0)),
        "total_reviews_count": int(beer.get("total_reviews_count", 0)),
    }


@app.get("/beers/similar/{beer_id}")
async def get_similar_beers(beer_id: str, n: int = DEFAULT_RECOMMENDATION_NUM):
    """Return beers similar to the given beer."""
    try:
        lookup_id = beer_id
        if beer_id not in cb.beer_id_to_index:
            for key in cb.beer_id_to_index:
                if str(key) == beer_id:
                    lookup_id = key
                    break
            else:
                raise HTTPException(status_code=404, detail=f"Beer '{beer_id}' not found")

        similar = cb.similar_beers(lookup_id, n=n)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "beer_id": beer_id,
        "similar": [
            {"beer_id": bid, "score": float(score)}
            for bid, score in similar.items()
        ],
    }


@app.post("/onboarding/from-attributes")
async def onboarding_from_attributes(payload: dict = Body(...)):
    """
    Return cold-start recommendations for a new user based on taste attribute
    preferences and preferred beer styles.

    Expected payload:
    {
        "user_id": "user@example.com",
        "taste": 4, "aroma": 3, "appearance": 2, "palate": 5,
        "abv_pref": "medium",
        "styles": ["IPA", "Pale Ale"],
        "n": 10
    }

    If user_id is provided, the top scored beers are persisted as synthetic
    ratings in the online store (same durable path as POST /ratings), so this
    user's subsequent GET /recommendations/{user_id} calls succeed instead of
    falling through to an unrelated fallback.
    """
    user_id = payload.get("user_id")
    taste = float(payload.get("taste", 3))
    aroma = float(payload.get("aroma", 3))
    appearance = float(payload.get("appearance", 3))
    palate = float(payload.get("palate", 3))
    abv_pref = payload.get("abv_pref", "any")
    styles = payload.get("styles", [])
    n = int(payload.get("n", DEFAULT_RECOMMENDATION_NUM))

    for val, name in [(taste, "taste"), (aroma, "aroma"), (appearance, "appearance"), (palate, "palate")]:
        if not (1 <= val <= 5):
            raise HTTPException(status_code=422, detail=f"{name} must be between 1 and 5.")
    if abv_pref not in ("low", "medium", "high", "any"):
        raise HTTPException(status_code=422, detail="abv_pref must be 'low', 'medium', 'high', or 'any'.")
    if not styles:
        raise HTTPException(status_code=422, detail="At least one style must be provided.")

    try:
        scores = cold_start.cold_start_from_attributes(
            taste, aroma, appearance, palate, abv_pref, styles, n * HYBRID_MULTIPLIER
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if user_id:
        for beer_id, score in scores.nlargest(10).items():
            synthetic_rating = 1 + round(float(np.clip(score, 0.0, 1.0)) * 4)
            _record_and_persist_rating(user_id, beer_id, synthetic_rating)

    reranked = rerank_recommendations(scores, n)
    return {
        "recommended_ids": reranked.index.tolist(),
        "scores": reranked.values.tolist(),
    }


@app.post("/onboarding/hybrid")
async def onboarding_hybrid(payload: dict = Body(...)):
    """
    Return cold-start recommendations by blending rated-beers signals (M1)
    and taste attribute signals (M2).

    Expected payload:
    {
        "rated_beers": {"beer_id_1": 5, "beer_id_2": 3},
        "attributes": {
            "taste": 4, "aroma": 3, "appearance": 2, "palate": 5,
            "abv_pref": "medium", "styles": ["IPA"]
        },
        "n": 10
    }
    At least one of rated_beers or attributes must be provided.
    """
    rated_beers = payload.get("rated_beers", {})
    attributes = payload.get("attributes", None)
    n = int(payload.get("n", DEFAULT_RECOMMENDATION_NUM))

    if not rated_beers and not attributes:
        raise HTTPException(
            status_code=400,
            detail="At least one of rated_beers or attributes must be provided.",
        )

    # M1 scores from rated beers
    m1_scores = None
    if rated_beers:
        try:
            m1_scores = cold_start.cold_start_from_ratings(
                rated_beers, n * HYBRID_MULTIPLIER
            )
        except ValueError:
            m1_scores = None

    # M2 scores from attribute preferences
    m2_scores = None
    if attributes:
        try:
            m2_scores = cold_start.cold_start_from_attributes(
                float(attributes.get("taste", 3)),
                float(attributes.get("aroma", 3)),
                float(attributes.get("appearance", 3)),
                float(attributes.get("palate", 3)),
                attributes.get("abv_pref", "any"),
                attributes.get("styles", []),
                n * HYBRID_MULTIPLIER,
            )
        except Exception:
            m2_scores = None

    # Blend M1 and M2
    if m1_scores is not None and m2_scores is not None:
        alpha = cf.cf_trust_ramp(len(rated_beers), MIN_FOLDIN_RATINGS)
        all_ids = m1_scores.index.union(m2_scores.index)
        m1_aligned = m1_scores.reindex(all_ids, fill_value=0.0)
        m2_aligned = m2_scores.reindex(all_ids, fill_value=0.0)
        blended = alpha * m1_aligned + (1 - alpha) * m2_aligned
        scores = blended.nlargest(n * HYBRID_MULTIPLIER)
    elif m1_scores is not None:
        scores = m1_scores
    elif m2_scores is not None:
        scores = m2_scores
    else:
        raise HTTPException(status_code=500, detail="Could not generate recommendations.")

    reranked = rerank_recommendations(scores, n)
    return {
        "recommended_ids": reranked.index.tolist(),
        "scores": reranked.values.tolist(),
    }


def get_cf_weight(rating_count: int) -> float:
    """Return CF blend weight scaled linearly by the user's total rating count.
    Ramps from CF_WEIGHT_MIN (0 ratings) to STANDARD_CF_WEIGHT (CF_WEIGHT_FULL_RATINGS+)."""
    return cf.cf_trust_ramp(rating_count, CF_WEIGHT_FULL_RATINGS, CF_WEIGHT_MIN, STANDARD_CF_WEIGHT)


def hybridize_candidates(cf_scores: pd.Series, cb_scores: pd.Series, candidate_num: int = 1, cf_weight: float = STANDARD_CF_WEIGHT) -> pd.Series:
    """
    Selects the top candidate_num recommendation candidates based on a weighted average of the CF and CB
    score of each beer

    Parameters:
    - cf_scores: Series of CF recommendation scores with beer id as the index.
    - cb_scores: pd.Series of CB recommendation scores with beer id as the index.
    - candidate_num: Number of the top hybrid recommendation candidates to return.
    - cf_weight: Weight given to CF scores (CB weight = 1 - cf_weight).

    Returns:
    - Series containing the top candidate_num beer IDs and their hybrid scores.
    """
    hybridized = hybrid_scores(cf_scores, cb_scores, cf_weight)
    # cull bottom candidates after hybridizing scores
    return hybridized.nlargest(candidate_num)



def hybrid_scores(cf_scores: pd.Series, cb_scores: pd.Series, cf_weight: int) -> pd.Series:
    """
    Creates a weighted average of CF and CB scores. A beer scored by only one
    source keeps that source's own score un-multiplied, instead of being
    silently discounted by the other source's implicit zero contribution
    (mirrors the both/cf_only/cb_only blending in cold_start.cold_start_from_ratings).

    Parameters:
    - cf_scores: Series of recommendation scores in the range (0,1) generated using CF
      the index is the id and the value is that ids score
    - cb_scores: Series of recommendation scores in the range (0,1) generated using CB
      the index is the id and the value is that ids score
    - cf_weight: The weight to give the CF scores in the average

    Returns:
    - Series of the hybrid scores
    """
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
    return blended

def get_user_rec_candidates(user_id: str, candidate_num: int) -> pd.Series:
    """
    Return a series of hybrid recommendation candidates

    Parameters:
    - user_id: string id of the user we want recommendations for
    - candidate_num: The number of candidates we want to return

    Returns:
    - Series of recommendation candidates with hybrid CF/CB scores
    """
    expanded_candidate_num = HYBRID_MULTIPLIER * candidate_num
    exclude = get_excluded_ids(user_id)
    session_ratings = get_user_ratings(user_id)

    # Compute per-user CF weight: more ratings → more trust in CF signal
    historical_count = cf.R_sparse.getrow(cf.user_id_to_index[user_id]).nnz if user_id in cf.user_id_to_index else 0
    cf_weight = get_cf_weight(historical_count + len(session_ratings))

    cf_candidates = cb_candidates = None

    # CF: fold-in updated predictions for existing users with session ratings;
    # standard frozen-U predictions otherwise.
    try:
        if session_ratings and user_id in cf.user_id_to_index:
            cf_candidates = cf.cf_recommend_updated(
                user_id, session_ratings, expanded_candidate_num, exclude_ids=exclude
            )
        else:
            cf_candidates = cf.cf_recommend(user_id, expanded_candidate_num, exclude_ids=exclude)
    except ValueError:
        pass

    try:
        cb_candidates = cb.cb_recommend(user_id, expanded_candidate_num, exclude_ids=exclude)
    except ValueError:
        pass

    # New-user fallback: build recommendations directly from session ratings.
    if cf_candidates is None and cb_candidates is None:
        if session_ratings:
            try:
                cb_candidates = cb.cb_recommend_from_ratings(
                    session_ratings, expanded_candidate_num, exclude_ids=exclude
                )
            except ValueError:
                pass
        if cf_candidates is None and len(session_ratings) >= MIN_FOLDIN_RATINGS:
            try:
                cf_candidates = cf.cf_recommend_new_user(
                    session_ratings, expanded_candidate_num, exclude_ids=exclude
                )
            except ValueError:
                pass

    if cf_candidates is None and cb_candidates is None:
        raise ValueError(f"User '{user_id}' not found in either recommendation pipeline")

    if cf_candidates is not None and cb_candidates is not None:
        hybrid_candidates = hybridize_candidates(cf_candidates, cb_candidates, candidate_num, cf_weight)
    elif cf_candidates is not None:
        hybrid_candidates = cf_candidates.nlargest(candidate_num)
    else:
        hybrid_candidates = cb_candidates.nlargest(candidate_num)

    # Apply heuristic score adjustments from the online store
    adjustments = get_score_adjustments(user_id)
    if adjustments:
        for beer_id, multiplier in adjustments.items():
            if beer_id in hybrid_candidates.index:
                hybrid_candidates.loc[beer_id] *= multiplier
        hybrid_candidates = hybrid_candidates.sort_values(ascending=False)

    return hybrid_candidates

def get_user_anti_candidates(user_id: str, candidate_num: int) -> pd.Series:
    expanded_candidate_num = HYBRID_MULTIPLIER * candidate_num

    exclude = get_excluded_ids(user_id)
    session_ratings = get_user_ratings(user_id)
    historical_count = cf.R_sparse.getrow(cf.user_id_to_index[user_id]).nnz if user_id in cf.user_id_to_index else 0
    cf_weight = get_cf_weight(historical_count + len(session_ratings))

    cf_candidates = cb_candidates = None
    try:
        cf_candidates = cf.cf_recommend(user_id, expanded_candidate_num, exclude_ids=exclude, ascending=True)
    except ValueError:
        pass
    try:
        cb_candidates = cb.cb_recommend(user_id, expanded_candidate_num, exclude_ids=exclude, ascending=True)
    except ValueError:
        pass

    # New-user fallback: build anti-candidates directly from session ratings.
    if cf_candidates is None and cb_candidates is None and session_ratings:
        try:
            cb_candidates = cb.cb_recommend_from_ratings(
                session_ratings, expanded_candidate_num, exclude_ids=exclude, ascending=True
            )
        except ValueError:
            pass
        if len(session_ratings) >= MIN_FOLDIN_RATINGS:
            try:
                cf_candidates = cf.cf_recommend_new_user(
                    session_ratings, expanded_candidate_num, exclude_ids=exclude, ascending=True
                )
            except ValueError:
                pass

    if cf_candidates is None and cb_candidates is None:
        raise ValueError(f"User '{user_id}' not found in either recommendation pipeline")

    if cf_candidates is not None and cb_candidates is not None:
        hybridized = hybrid_scores(cf_candidates, cb_candidates, cf_weight)
        anti_candidates = hybridized.nsmallest(candidate_num)
    elif cf_candidates is not None:
        anti_candidates = cf_candidates.nsmallest(candidate_num)
    else:
        anti_candidates = cb_candidates.nsmallest(candidate_num)

    return anti_candidates

def get_group_candidates(group_ids: list, candidate_num: int, penalty_weight: float = STANDARD_GROUP_PENALTY) -> pd.Series:
    """
    Returns refined series of recommended beer ids and adjusted recommendation scores for the given group

    Parameters:
    - group_ids: List of user id strings we want recommendation candidates for
    - candidate_num: Desired number of candidates
    - penalty_weight: Number in range (0,1), decides how heavily we want to penalize user disagrements

    Returns:
    - Series of recommendation candidates with adjusted group scores
    """

    # Get candidates for each user in the group
    user_candidates = {user_id: get_user_rec_candidates(user_id, RERANK_MULTIPLIER * candidate_num) for user_id in group_ids}

    # Convert dictionary to matrix of candidate scores
    # Columns will be user IDs, Rows (Index) will be beer IDs.
    candidate_mat = pd.DataFrame(user_candidates)
    
    # Fill missing scores for canditates with 0
    # Under the assumption that if a beer wasn't recommended to a user they won't like it
    candidate_mat = candidate_mat.fillna(0.0)
    
    # Calculate row-wise (per-beer) average and variance across the users
    beer_means = candidate_mat.mean(axis=1)
    # Scores are in (0,1) range so the variance will also be in that range
    beer_variances = candidate_mat.var(axis=1, ddof=0)

    # Penalize beers with high differences in compatability
    group_scores = beer_means - (penalty_weight * beer_variances)

    # Return only the best candidates
    return group_scores.nlargest(candidate_num)



def rerank_recommendations(candidates: pd.Series, rec_num: int, diversity_weight: float = STANDARD_LAMBDA):
    """
    Selects top rec_num beers using Maximal Marginal Relevance (MMR) for reranking.

    Parameters:
    - candidates: pd.Series where index is the beer id and value is the recommendation score [0, 1].
    - rec_num: int, the number of final recommendations desired.
    - diversity_weight: float [0, 1], the lambda parameter balancing relevance (1) and diversity (0).

    Returns:
    - series of selected beer ids and their scores.
    """

    # This shouldn't happen but, if we request more recommendations than available candidates cap it.
    rec_num = min(rec_num, len(candidates))
    if rec_num == 0:
        return []

    # Unselected beers - list of beer IDs
    unselected = list(candidates.index)
    # Selected beers - list of beer IDs
    selected = []

    # Initialize the selection with the best recommendation
    first_choice = candidates.idxmax()
    selected.append(first_choice)
    unselected.remove(first_choice)

    # Select the remaining beers using MMR
    while len(selected) < rec_num:
        best_mmr_score = -float('inf')
        best_candidate = None

        # Extract features for all currently selected items
        selected_indices = [cb.beer_id_to_index[b] for b in selected]
        selected_feats = cb.beer_feature_matrix[selected_indices]  # Shape: (len(selected), num_features)

        # Extract features for all remaining unselected items
        unselected_indices = [cb.beer_id_to_index[b] for b in unselected]
        unselected_feats = cb.beer_feature_matrix[unselected_indices]  # Shape: (len(unselected), num_features)
        
        # Calculate pairwise cosine similarities between all unselected and selected items
        # Matrix shape: (len(unselected), len(selected))
        sim_matrix = cosine_similarity(unselected_feats, selected_feats)
        
        # For each unselected item, find its maximum similarity to ANY already selected item
        max_sim_per_unselected = np.max(sim_matrix, axis=1)
        
        # Evaluate MMR score for each unselected candidate
        for i, beer_id in enumerate(unselected):
            relevance = candidates.loc[beer_id]
            similarity_penalty = max_sim_per_unselected[i]
            
            # MMR formula
            mmr_score = diversity_weight * relevance - (1 - diversity_weight) * similarity_penalty
            
            if mmr_score > best_mmr_score:
                best_mmr_score = mmr_score
                best_candidate = beer_id
                
        # Append the winning candidate to the selected list
        selected.append(best_candidate)
        unselected.remove(best_candidate)

    return candidates.loc[selected]