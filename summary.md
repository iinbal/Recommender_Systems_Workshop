# Project Summary

## Datasets Used

- **BeerAdvocate** — user beer reviews, [Stanford SNAP / BeerAdvocate dataset](https://cseweb.ucsd.edu//~jmcauley/datasets.html#multi_aspect).
- **RateBeer** — user beer reviews, [Stanford SNAP / RateBeer dataset](https://cseweb.ucsd.edu//~jmcauley/datasets.html#multi_aspect).

Contain 4,241,024 interactions from 26,774 Users with 70,243 beers
Both JSON files are ingested via `data_processing/process_json.py` into PostgreSQL, then passed through a feature-engineering and train/val/test split pipeline (`data_processing/pipeline.py`) to produce enriched CSV files used by the recommendation pipelines.

&nbsp;<br>

## Technologies and Frameworks

### Frontend

- **React + Vite** — single-page application with tab-based dashboard, beer card rendering.

### Backend

- **FastAPI** — HTTP server wiring the CF, CB, and cold-start pipelines into REST endpoints; supports both development (`fastapi dev`) and production (`fastapi run`) modes.
- **Uvicorn** — ASGI server running the FastAPI application.

### Algorithmic

- **scikit-learn** — TF-IDF vectorisation and cosine similarity for the content-based pipeline.
- **scipy** — sparse matrix operations and truncated SVD for the collaborative filtering pipeline.
- **NumPy / pandas** — data manipulation, feature engineering, and train/val/test splits.

### Data Platforms

- **PostgreSQL** — stores the ingested BeerAdvocate and RateBeer review data.
- **In-memory online store** (`backend/online_store.py`) — holds real-time session ratings and score adjustments; ratings and exclusions are rehydrated from `new_ratings.csv` on startup, so a registered user's personalization survives a server restart (heuristic score adjustments are not persisted).
- **`new_ratings.csv`** — append-only flat file persisting session ratings across restarts for eventual offline retraining.

### AI

- **Sparse SVD (scipy)** — matrix factorisation for collaborative filtering; operates entirely on sparse matrices to handle tens of thousands of users × beers without memory issues.
- **TF-IDF + cosine similarity (scikit-learn)** — content-based similarity across beer style, brewery, and textual features.
- **Google Gemini Vision API (`google-genai` SDK)** — extracts beer names and brewery names from uploaded menu photos; uses `gemini-2.5-flash-lite` (primary, 500 req/day free tier) with `gemini-2.5-flash` as fallback.
- **Google Gemini text API** - Allows users to ask for help with navigating and using the RuBeer website.
- **rapidfuzz** — fuzzy string matching used to map Gemini-extracted beer names to catalog entries; tolerant of OCR noise, formatting variants, and volume descriptors (e.g. "e 33cl").

&nbsp;<br>

## Main Algorithms

- **Collaborative Filtering (sparse SVD)** — factorises the user–item rating matrix into latent factors; used for personalised recommendations for existing users. Supports real-time fold-in so new ratings are reflected immediately without retraining.
- **Content-Based (TF-IDF + cosine similarity)** — represents each beer as a feature vector and finds similar beers based on style, brewery, and text. Updates continuously as the user rates beers.
- **Hybrid blending** — CF and CB scores are linearly blended for the main recommendation feed. The CF weight is adapted per-user based on rating count: new users get more CB weight (content signal is more reliable with sparse history), while experienced users get more CF weight (collaborative signal improves with more data). Weight ramps linearly from 0.1 (0 ratings) to 0.6 (≥ 50 ratings).
- **MMR re-ranking** — Maximal Marginal Relevance applied to the hybrid scores to promote diversity in the recommendations.
- **Menu-scan scoring** — when a user uploads a menu photo, beer names are extracted via Gemini vision and fuzzy-matched to the catalog; only the matched subset (~8–12 beers) is scored by slicing the CB feature matrix and CF latent factors directly, bypassing full 70k-beer scoring entirely. Results are ranked by the user's personal hybrid score.
- **Cold-start (two-method onboarding)** — new users choose between Method 1 (search for known beers and rate them 1–5; minimum 3 ratings required) or Method 2 (rate the importance of taste/aroma/appearance/palate, pick an ABV preference, and select beer styles). Method 1 uses CB always and adds CF fold-in once ≥ 3 ratings are collected; Method 2 maps aspect importance levels to quantile targets in the numeric feature sub-space and blends with a style-cluster prior. Both produce a `pd.Series` of beer scores compatible with the hybrid pipeline downstream. Candidate generation for Method 2 and for any new user's ongoing CB-based recommendations caps representation to 5 beers per exact style, preventing one dominant style from filling the entire result set.

&nbsp;<br>

## System Architecture

The system has three main layers: a React frontend, a FastAPI backend, and a pair of offline-trained recommendation pipelines.

1. A user enters the website and is either a guest or logged in to a user
2. Depending on user state(guest, new user, old user) in the database A user request (generic recommendation, quiz submission, tailored recommendation) is sent from the React frontend to the FastAPI backend via the `apiService.js` API client.
3. The backend routes the request to the appropriate pipeline — generic recommendations, cold-start, or hybrid scoring — and consults the in-memory online store for any pending session ratings.
4. Recommendations are generated: the CF pipeline projects the user's rating vector into the SVD latent space; the CB pipeline computes cosine similarities against pre-built item feature vectors. Scores are blended and MMR-reranked.
5. The backend returns a JSON list of beer recommendations (with metadata and match scores) to the frontend, which renders them as beer cards in the relevant tab.
6. When a user rates a beer, the rating is posted to `POST /ratings`, immediately excluded from future feeds, and used to apply heuristic score adjustments. It is also appended to `new_ratings.csv` for future offline retraining.

## Development Environment

- **VS Code + Claude** — used for both backend and frontend development.
- **PowerShell / terminal** — used for running scripts, managing services, and testing API endpoints.
- **pytest** — 138 unit tests (`test_pipelines.py`) and integration tests (`test_integration.py`).

&nbsp;<br>

## Development Evolution

- **Milestone 1:** Set up data ingestion from BeerAdvocate and RateBeer JSON files into PostgreSQL; basic feature engineering pipeline.
- **Milestone 2:** Implemented sparse SVD-based collaborative filtering pipeline with train/val/test evaluation across k ∈ {5, 10, 20, 50}.
- **Milestone 3:** Added TF-IDF content-based pipeline 
- **Milestone 4:** Created React based frontend for app using dummy data
- **Milestone 5:** Built FastAPI backend with hybrid recommendation endpoint; 
- **Milestone 6:** Created cold-start onboarding with two methods: beer-search-and-rate (Method 1, primary) and aspect-importance sliders with style chips (Method 2, fallback). New backend endpoints: `GET /beers/search`, `POST /onboarding/from-attributes`, `POST /onboarding/hybrid`.
- **Milestone 7:** Improved React + Vite frontend Favorites, Discover, Top 50, and Adventurous tabs; added support for using real data and Demo Data toggle for standalone exploration.
- **Milestone 8:** Added MMR re-ranking for diversity, group recommendations endpoint, and CF weight tuning sweep.
- **Milestone 9:** Added real-time feedback loop: immediate exclusion of rated beers, heuristic score adjustments, and SVD fold-in for live recommendation updates without retraining.
- **Milestone 10:** Added Scan Menu feature — Gemini vision API extracts beer names from uploaded menu photos; rapidfuzz maps them to the catalog; a dedicated endpoint scores only the matched beers by slicing CB/CF matrices directly.
- **Milestone 11:** Added Rubi's Daily Recommendation — a hero card on the Home tab highlighting a single standout beer pick, guaranteed not to overlap the swimlanes shown below it.
- **Milestone 12:** Fixed cold-start reliability — registered users now durably get real personalized recommendations for both onboarding methods (previously fell back to an unrelated real user's feed on any 404); Method 2 picks are persisted as ratings; the online store rehydrates from `new_ratings.csv` on startup so personalization survives a backend restart; zero-signal/guest users see an honest "Popular Beers" list instead of a substituted feed.
- **Milestone 13:** Fixed recommendation diversity — added a per-style candidate cap to cold-start Method 2 and to new-user CB recommendations, preventing a single beer style from dominating the results; extended the anti-recommendations endpoint with the same new-user fallback used by the main recommendation endpoint, fixing a 404 for registered users without trained CF/CB history.
- **Milestone 14:** Fixed Friend Compatibility — the taste-match comparison now uses the user's full rating history instead of the live (and volatile) recommendation feed, fixing false "not enough shared ratings" results that occurred as soon as the feed refreshed.

&nbsp;<br>

## Evaluation

Model quality is evaluated by running `py train_models.py`, which trains the SVD model and reports per-k RMSE on the validation and test sets for k ∈ {5, 10, 20, 50}. The k with the lowest validation RMSE is selected automatically.

Hybrid CF/CB blending weights are evaluated separately via `py train_models.py --tune-weights`, which sweeps CF weights `[0.3, 0.4, 0.5, 0.6, 0.7, 0.8]` and reports Hit Rate@10 on the validation set for each blend.

## Main Features

- **Personalised recommendation feed** — hybrid CF + CB swimlanes ("Top Matches", "You Might Also Like") on the Home tab, MMR-reranked for diversity. Users with no rating signal yet see a clearly-labeled "Popular Beers" list instead — the app never substitutes another user's personalized feed.
- **Cold-start onboarding** — new users choose between two methods: search for beers they know and rate them (Method 1, recommended, minimum 3 ratings), or rate the importance of taste/aroma/appearance/palate and select preferred styles (Method 2, guided fallback). Recommendations are available immediately after onboarding, before any further in-app interactions. Both methods persist the resulting ratings to the online store, so recommendations stay personalized (and diversified across beer styles) after a page refresh or backend restart.
- **Real-time feedback loop** — rating a beer instantly removes it from feeds, applies score adjustments to similar beers, and triggers SVD fold-in so recommendations update live without retraining.
- **Adventurous tab** — surfaces mid-range picks (positions 50–200 of the user's predicted ranking) that diverge from core taste, with a "Surprise Me Again" re-roll button.
- **Top 50 tab** — community leaderboard sorted by average overall rating across all users.
- **Group recommendations** — `GET /recommendations/group` generates hybrid recommendations for a set of users simultaneously.
- **% Match badges** — every beer card displays a personalised hybrid score, a community average rating, or a rank badge depending on the tab.
- **Scan Menu** — upload a photo of a bar menu; Gemini vision extracts beer names, fuzzy matching maps them to the catalog, and the system returns only those beers ranked by the user's personal taste score. Appears as a "Scan Menu" button on the Home tab.
- **Rubi's Daily Recommendation** — a highlighted hero card on the Home tab surfacing one standout beer pick, distinct from the "Top Matches" and "You Might Also Like" swimlanes below it. Reuses the existing hybrid recommendation feed (requests one extra beer beyond what's shown in the swimlanes) so the pick never duplicates a beer already visible on the page; clicking it opens the same beer detail modal used elsewhere in the app.
- **Friend Compatibility** — on the Profile tab, compares a user's ratings against a set of demo friend personas and shows a taste-match percentage plus "Top Shared Favorites". The comparison is based on the user's full rating history rather than whatever's currently in their live recommendation feed, so the result stays stable as recommendations refresh.
- **Build a 6 pack** - If the user or group don't want to choose beers themselves, The system can build a ready to order six pack of beers tailored to them.
- **AI assistant** - Allows users to ask free text questions about Rubeer to help them navigate and utilize the website

## Open Issues, Limitations, and Future Work

- Convert website into app for use on phones for easier use on the go
- Refine and improve LLM based features to achieve higher accuracy
- Additional social features like inviting friends to a drink or finding users with similar tastes

&nbsp;<br>

## Additional Comments

The decision to use sparse SVD (via scipy) rather than a dense matrix was critical for scaling to the full BeerAdvocate + RateBeer dataset (tens of thousands of users × beers). The Demo Data toggle proved very useful during frontend development, allowing UI work to proceed independently of backend availability. The `--tune-weights` flag in `train_models.py` provides a lightweight way to re-verify the optimal CF/CB blend after new data is added, without running a full grid search.
