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
STANDARD_LAMBDA = 0.25
CANDIDATE_NUM = 50
HYBRID_CANDIDATE_NUM = 25
FINAL_RECOMMENDATION_NUM = 10

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "You shouldn't be here ;)"}
    
@app.get("/recommendations/{user_id}")
async def get_recommendation(user_id):
    cb_candidates = cb.cb_recommend(user_id, CANDIDATE_NUM)
    cf_candidates = cf.cf_recommend(user_id, CANDIDATE_NUM)

    hybrid_candidates = create_hybrid_scores(user_id, cf_candidates, cb_candidates)
    # TODO: use cross-validation to select lambda
    selected_recommendations = rerank_recommendations(hybrid_candidates, FINAL_RECOMMENDATION_NUM)

    return {
            "recommended_ids:": selected_recommendations.index.tolist()
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
        quiz_answers, FINAL_RECOMMENDATION_NUM
    )

    return {
        "recommended_ids": recommendations.index.tolist(),
        "scores": recommendations.values.tolist(),
    }


def create_hybrid_scores(user_id: str, cf_scores: pd.Series, cb_scores: pd.Series) -> pd.Series:
    # TODO: adjust alpha based on how much data is available for user
    hybridized = hybrid_scores(cf_scores, cb_scores, 0.5)
    # reduce candidates after hybridizing scores
    return hybridized.nlargest(HYBRID_CANDIDATE_NUM)

def hybrid_scores(cf_scores: pd.Series, cb_scores: pd.Series, alpha: int) -> pd.Series:
    return alpha * cf_scores + (1 - alpha) * cb_scores


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