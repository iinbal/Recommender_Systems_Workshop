# Modules Description

## User Interface

- **Technology:** React + Vite
- **Responsibilities:** Display the beer recommendation dashboard; collect user interactions (ratings, onboarding inputs, search/filter inputs); manage local state for Favorites and rated beers.
- **Interactions:**
  - Calls backend APIs via `src/services/apiService.js` (e.g. `/recommendations/{user_id}`, `/beers/top`, `/beers/search`, `/onboarding/from-attributes`, `/ratings`, `POST /recommendations/menu-upload`).
  - Receives JSON responses from the backend and renders beer cards, match badges, and swimlanes.
- **More info:** Registered users get their own recommendations tied to their real user ID; users with no rating signal yet (e.g. skipped onboarding) see an honest "Popular Beers" list instead — the app never substitutes another real user's personalized feed. 
- **Source code:** [`/frontend/src/`](./frontend/src/)

## Collaborative Filtering Pipeline

- **Technology:** scipy (sparse SVD), NumPy, joblib
- **Responsibilities:** Factorises the user–item rating matrix via truncated SVD; generates personalised score predictions for existing users; supports real-time fold-in so new ratings are reflected immediately without retraining.
- **Interactions:**
  - Trained offline by `train_models.py`; artifacts saved to `artifacts/`.
  - Loaded at server startup by `backend/api_server.py`.
  - Receives user rating vectors from the online store for fold-in.
  - Returns ranked beer score lists to the API server for hybrid blending.
- **More info:** Operates entirely on sparse matrices to handle tens of thousands of users × beers. Falls back to a small synthetic dataset ([`/dummy_data.py`](./dummy_data.py)) if real CSVs are absent.
- **Source code:** [`/cf_pipeline.py`](./cf_pipeline.py)

## Content-Based Pipeline

- **Technology:** scikit-learn (TF-IDF, cosine similarity), pandas
- **Responsibilities:** Builds a TF-IDF feature matrix over beer style, brewery, and text features; computes cosine similarity to generate item-based recommendations and similar-beer lookups.
- **Interactions:**
  - Trained offline by `train_models.py`; artifacts saved to `artifacts/`.
  - Loaded at server startup by `backend/api_server.py`.
  - Provides embeddings and similarity scores to the API server for hybrid blending and `/beers/similar/{beer_id}`.
- **More info:** Updates recommendations continuously as the user rates beers. Falls back to a 5-beer in-memory mini catalog if real CSVs are absent. `cb_recommend_from_ratings` (used for any registered user without trained CF/CB history) caps candidates to 5 beers per exact `beer_style` before selecting the top-N, since averaging several rated beers into one profile vector can otherwise concentrate results on a single style. Beer names are HTML-entity-decoded once at load time to clean up scrape artifacts (e.g. `&#40;` → `(`).
- **Source code:** [`/cb_pipeline.py`](./cb_pipeline.py)

## Model Training Script

- **Technology:** Python, scipy, scikit-learn
- **Responsibilities:** Offline entry point that trains both the CF (sparse SVD) and CB (TF-IDF) pipelines from the `data/` CSV splits, evaluates per-k RMSE on validation/test sets for k ∈ {5, 10, 20, 50}, and writes all artifacts to `artifacts/`.
- **Interactions:**
  - Reads `data/train_set.csv`, `data/val_set.csv`, `data/test_set.csv`, `data/item_profiles_for_cold_start.csv`.
  - Writes CF/CB artifacts consumed at startup by `backend/api_server.py`.
- **More info:** `py train_models.py --tune-weights` separately sweeps hybrid CF weights `[0.3, 0.4, 0.5, 0.6, 0.7, 0.8]` and reports Hit Rate@10 on the validation set, without repeating the full SVD training.
- **Source code:** [`/train_models.py`](./train_models.py)

## Cold-Start Module

- **Technology:** Item profiles CSV, CB pipeline, CF fold-in (SVD)
- **Responsibilities:** Generates initial recommendations for new users via two methods before any in-app interaction history exists.
- **Interactions:**
  - Reads item profiles from the CB pipeline (`cb.item_profiles`, `cb.beer_feature_matrix`).
  - **Method 1** (`cold_start_from_ratings`): receives a dict of `{beer_id: rating}` collected by the frontend; builds a CB user profile and, if ≥ 3 beers are rated, folds the new user into the CF latent space. CF weight scales linearly from 0 → 0.6 as ratings grow from 3 → 5.
  - **Method 2** (`cold_start_from_attributes`): receives aspect importance scores (taste/aroma/appearance/palate 1–5), ABV preference, and style chips; maps importance levels to quantile targets in the 8-column numeric sub-space of the beer feature matrix and blends 70% numeric similarity + 30% style-cluster prior.
  - Exposes `POST /onboarding/from-attributes` (Method 2) and `POST /onboarding/hybrid` (combined) in the API server; Method 1 ratings are submitted individually via `POST /ratings`.
- **More info:** Both functions return a `pd.Series` (index = beer_id, values = score) compatible with the hybrid pipeline. `cold_start_from_attributes` caps representation to 5 beers per exact `beer_style` before truncating to `n`, so one dominant style (the style-cluster bonus ties several styles together) can't fill the entire candidate pool. `POST /onboarding/from-attributes` persists the top-scored beers as real ratings in the online store when a `user_id` is provided, giving Method 2 users the same durable, restart-proof personalization as Method 1. `GET /beers/search` (declared before `/beers/{beer_id}` to avoid path collision) supports the Method 1 beer search UI.
- **Source code:** [`/cold_start.py`](./cold_start.py)

## Real-Time Online Store

- **Technology:** In-memory Python module
- **Responsibilities:** Tracks session ratings, applies heuristic score adjustments (±20% for similar beers based on rating polarity), and records which beers have been rated so they can be excluded from future feeds.
- **Interactions:**
  - Updated by `POST /ratings` in the API server.
  - Consulted by the CF and CB pipelines when generating recommendations.
  - Appends ratings to `new_ratings.csv` for future offline retraining (best-effort, non-blocking).
- **More info:** Session ratings and exclusions are rehydrated from `new_ratings.csv` on server startup, so a registered user's personalization survives a restart; heuristic score adjustments (similar-beer boosts/penalties) are not persisted and still reset. `new_ratings.csv` can also be merged into training data before the next `train_models.py` run.
- **Source code:** [`/backend/online_store.py`](./backend/online_store.py)

## Data Ingestion Pipeline

- **Technology:** Python, psycopg2, pandas
- **Responsibilities:** Reads raw BeerAdvocate and RateBeer JSON files, validates rows, and loads them into PostgreSQL; then performs feature engineering and produces train/val/test CSV splits.
- **Interactions:**
  - Reads local JSON files (paths configured by the user).
  - Writes to the `recommend_db` PostgreSQL database.
  - `data_processing/pipeline.py` writes `train_set_enriched.csv`, `val_set_enriched.csv`, `test_set_enriched.csv`, and `item_profiles_for_cold_start_enriched.csv` to the current working directory. These must be manually moved into a `data/` subdirectory and renamed to `train_set.csv`, `val_set.csv`, `test_set.csv`, and `item_profiles_for_cold_start.csv` — the plain names `cf_pipeline.py`, `cb_pipeline.py`, and `train_models.py` actually load.
- **More info:** `data_processing/analyze.py` is a third script in this module — it connects to `recommend_db` (via its own separately hardcoded credentials) and runs EDA/VIF diagnostics with `statsmodels`, a dependency not currently listed in `install.md`.
- **Source code:** [`/data_processing/`](./data_processing/)

## API Gateway / Backend Server

- **Technology:** FastAPI, Uvicorn
- **Responsibilities:** Exposes all HTTP endpoints; orchestrates requests between the CF pipeline, CB pipeline, cold-start module, and online store; handles hybrid score blending and MMR re-ranking.
- **Interactions:**
  - Handles all requests from the React frontend.
  - Loads CF and CB pipeline artifacts from `artifacts/` at startup.
  - Dispatches to the appropriate pipeline based on the endpoint called.
  - Returns JSON recommendation lists with beer metadata and match scores.
- **More info:** Hybrid blending uses a per-user adaptive CF weight that ramps linearly from 0.1 (new users, no rating history) to 0.6 (experienced users, ≥ 5 ratings), computed at request time from the user's historical + session rating count. The upper bound `STANDARD_CF_WEIGHT = 0.6` is tunable via `py train_models.py --tune-weights`. Supports development (`fastapi dev`, auto-reload) and production (`fastapi run`) modes. `POST /recommendations/menu-upload` accepts a multipart menu image, orchestrates the vision and matcher modules, and scores only the matched beers without invoking the full recommendation pipeline. The main and anti-recommendation endpoints share the same new-user fallback: a registered user without trained CF/CB history is scored directly from their session ratings instead of 404ing.
- **Source code:** [`/backend/api_server.py`](./backend/api_server.py)

## AI Assistant (Stav)

- **Technology:** Google Gemini text API (`google-genai` SDK, model `gemini-2.5-flash`)
- **Responsibilities:** Answers free-text user questions about navigating and using the RuBeer site, grounded with a short RAG-style context built from the user's top-5 rated beers.
- **Interactions:**
  - Exposed via `POST /api/chat` in `backend/api_server.py`, called by `frontend/src/components/StavAssistant.jsx`.
  - Falls back to a canned error string if the Gemini call fails.
- **Source code:** [`/backend/api_server.py`](./backend/api_server.py) (`chat_with_Stav`), [`/frontend/src/components/StavAssistant.jsx`](./frontend/src/components/StavAssistant.jsx)

## Menu Vision Module

- **Technology:** Google Gemini Vision API (`google-genai` SDK)
- **Responsibilities:** Sends a menu image to Gemini and parses the response into a list of `{name, brewery}` dicts.
- **Interactions:**
  - Called by the `POST /recommendations/menu-upload` endpoint in `backend/api_server.py`.
  - Returns `[]` on any error so the endpoint degrades gracefully without affecting other flows.
- **More info:** Uses a singleton `genai.Client` initialised from the `GOOGLE_API_KEY` environment variable, loaded from a `.env` file (see `.env.example`) via `python-dotenv`. Tries `gemini-2.5-flash-lite` first; falls back to `gemini-2.5-flash` on 503.
- **Source code:** [`/menu_vision.py`](./menu_vision.py)

## Menu Matcher Module

- **Technology:** rapidfuzz, pandas
- **Responsibilities:** Fuzzy-matches extracted beer names against the item profiles catalog and returns the matched beer IDs.
- **Interactions:**
  - Called by `POST /recommendations/menu-upload` with the extracted names from the vision module.
  - Only matches against beers that have CB feature vectors, ensuring all matches are scorable.
- **More info:** Normalises both sides by stripping noise words (`brewery`, `brewing`, `co`, `lager`, etc.) before comparing with `fuzz.token_set_ratio` (threshold 75). Deduplicates matches automatically.
- **Source code:** [`/menu_matcher.py`](./menu_matcher.py)
