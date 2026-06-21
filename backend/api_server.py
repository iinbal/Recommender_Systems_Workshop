import json
from pathlib import Path

import cf_pipeline as cf
import cb_pipeline as cb
import cold_start
import pandas as pd
import numpy as np

from fastapi import Body, FastAPI
from sklearn.metrics.pairwise import cosine_similarity


QUIZ_DATA_PATH = Path(__file__).resolve().parent.parent / "quiz_data.json"
STANDARD_CF_WEIGHT = 0.6
STANDARD_LAMBDA = 0.25
STANDARD_GROUP_PENALTY = 0.5
HYBRID_MULTIPLIER = 3
RERANK_MULTIPLIER = 2
DEFAULT_RECOMMENDATION_NUM = 10

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "You shouldn't be here ;)"}
    
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

    hybrid_candidates = get_user_rec_candidates(user_id, rec_num * RERANK_MULTIPLIER)

    # Further refine our recommendations while using reranking to introduce diversity
    selected_recommendations = rerank_recommendations(hybrid_candidates, rec_num)

    return {
            "recommended_ids:": selected_recommendations.index.tolist(),
            "scores": selected_recommendations.values.tolist()
        }

@app.get("/group")
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
        
    # Assuming get_recommendations(user_id) returns a pd.Series
    user_candidates = get_group_candidates(user_ids, RERANK_MULTIPLIER * rec_num)
    
    # Apply reranking diversity
    final_recommendations = rerank_recommendations(user_candidates, rec_num)

    return {
            "recommended_ids:": final_recommendations.index.tolist(),
            "scores": final_recommendations.values.tolist()
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

    recommendations = cold_start.get_cold_start_recommendations(
        quiz_answers, DEFAULT_RECOMMENDATION_NUM
    )

    return {
        "recommended_ids": recommendations.index.tolist(),
        "scores": recommendations.values.tolist(),
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
    cb_candidates = cb.cb_recommend(user_id, expanded_candidate_num)
    cf_candidates = cf.cf_recommend(user_id, expanded_candidate_num)

    # Narrow down the best candidates based on the hybrid scores
    hybrid_candidates = hybridize_candidates(cf_candidates, cb_candidates, candidate_num)

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