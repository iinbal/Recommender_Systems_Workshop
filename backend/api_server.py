import json
from pathlib import Path

import cf_pipeline as cf
import cb_pipeline as cb
import cold_start
import pandas as pd
import numpy as np

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sklearn.metrics.pairwise import cosine_similarity

from backend.online_store import record_rating, get_excluded_ids, add_score_adjustments, get_score_adjustments


QUIZ_DATA_PATH = Path(__file__).resolve().parent.parent / "quiz_data.json"
STANDARD_CF_WEIGHT = 0.6
STANDARD_LAMBDA = 0.25
STANDARD_GROUP_PENALTY = 0.5
HYBRID_MULTIPLIER = 3
RERANK_MULTIPLIER = 2
DEFAULT_RECOMMENDATION_NUM = 10

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def check_artifacts():
    artifacts_dir = Path(__file__).resolve().parent.parent / "artifacts"
    if not artifacts_dir.exists():
        print("WARNING: artifacts/ directory not found. Pipelines are using on-the-fly computation.")
        print("Run 'python train_models.py' to pre-compute model artifacts for faster startup.")
    else:
        print("artifacts/ directory found. Pipelines loaded pre-computed models.")


@app.get("/")
async def root():
    return {"message": "You shouldn't be here ;)"}


@app.get("/users/sample")
async def get_sample_users(n: int = 5):
    """Return user IDs that are valid in both CF and CB pipelines."""
    cb_users = set(cb.train_df["username"].unique())
    valid = [uid for uid in cf.user_ids if uid in cb_users]
    return {"user_ids": valid[:n]}


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

    if not user_ids:
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

@app.get("/quiz")
async def get_quiz():
    """Serve the onboarding quiz configuration to the frontend."""
    with open(QUIZ_DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/recommendations/cold-start")
async def get_cold_start_recommendation(payload: dict = Body(...)):
    """
    Receive onboarding quiz answers and return initial recommendations
    for a brand-new user.

    Expected payload: {"answers": {"hoppy": 5, "dark": 2, "sour": 1, "light": 4}}
    """
    quiz_answers = payload.get("answers", {})

    try:
        recommendations = cold_start.get_cold_start_recommendations(
            quiz_answers, DEFAULT_RECOMMENDATION_NUM
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "recommended_ids": recommendations.index.tolist(),
        "scores": recommendations.values.tolist(),
    }


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

    # Cast beer_id to match the pipeline's type (int for real data, str for demo)
    col = cb.item_profiles["beer_id"]
    if col.dtype != object:
        try:
            beer_id = col.dtype.type(beer_id)
        except (ValueError, TypeError):
            pass

    # Mandatory: exclude this beer from future recommendations
    record_rating(user_id, beer_id, rating)

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


def hybridize_candidates(cf_scores: pd.Series, cb_scores: pd.Series, candidate_num: int = 1) -> pd.Series:
    """
    Selects the top candidate_num recommendation candidates based on a weighted average of the CF and CB 
    score of each beer

    Parameters:
    - cf_scores: Series of CF recommendation scores with beer id as the index.
    - cb_scores: pd.Series of CB recommendation scores with beer id as the index.
    - candidate_num: Number of the top hybrid recommendation candidates to return.
    
    Returns:
    - Series containing the top candidate_num beer IDs and their hybrid scores.
    """
    hybridized = hybrid_scores(cf_scores, cb_scores, STANDARD_CF_WEIGHT)
    # cull bottom candidates after hybridizing scores
    return hybridized.nlargest(candidate_num)



def hybrid_scores(cf_scores: pd.Series, cb_scores: pd.Series, cf_weight: int) -> pd.Series:
    """
    Creates a weighted average of CF and CB scores

    Parameters:
    - cf_scores: Series of recommendation scores in the range (0,1) generated using CF 
      the index is the id and the value is that ids score
    - cb_scores: Series of recommendation scores in the range (0,1) generated using CB
      the index is the id and the value is that ids score
    - cf_weight: The weight to give the CF scores in the average

    Returns:
    - Series of the hybrid scores
    """
    return (cf_weight * cf_scores).add((1 - cf_weight) * cb_scores, fill_value = 0)

def get_user_rec_candidates(user_id: str, candidate_num: int) -> pd.Series:
    """
    Return a series of hybrid recommendation candidates

    Parameters:
    - user_id: string id of the user we want recommendations for
    - candidate_num: The number of candidates we want to return

    Returns:
    - Series of recommendation candidates with hybrid CF/CB scores
    """
    # Get extra recommendation candidates from the 2 pipelines
    expanded_candidate_num = HYBRID_MULTIPLIER * candidate_num

    # Get runtime exclusions from the online store
    exclude = get_excluded_ids(user_id)

    cf_candidates = cb_candidates = None
    try:
        cf_candidates = cf.cf_recommend(user_id, expanded_candidate_num, exclude_ids=exclude)
    except ValueError:
        pass
    try:
        cb_candidates = cb.cb_recommend(user_id, expanded_candidate_num, exclude_ids=exclude)
    except ValueError:
        pass

    if cf_candidates is None and cb_candidates is None:
        raise ValueError(f"User '{user_id}' not found in either recommendation pipeline")

    if cf_candidates is not None and cb_candidates is not None:
        hybrid_candidates = hybridize_candidates(cf_candidates, cb_candidates, candidate_num)
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
        # Re-sort after adjustments
        hybrid_candidates = hybrid_candidates.sort_values(ascending=False)

    return hybrid_candidates

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