# Recommender Systems Workshop

A beer recommendation system implementing Collaborative Filtering (CF) and Content-Based (CB) pipelines on the BeerAdvocate and RateBeer datasets.

---

## Quick Start

1. Install Python deps: `py -m pip install psycopg2-binary pandas scikit-learn scipy numpy pytest "fastapi[standard]" uvicorn joblib httpx`
2. Train models: `py train_models.py` (requires the enriched CSV files)
3. Start the backend: `py -m fastapi dev` (from project root)
4. Start the frontend: `cd frontend && npm install && npm run dev`
5. Open http://localhost:5173 — toggle "Demo Data" off to see live recommendations

---

## Project Structure

```
Recommender_Systems_Workshop/
├── dummy_data.py                  # Synthetic rating matrix generator (used by CF pipeline fallback)
├── cf_pipeline.py                 # Collaborative Filtering pipeline (sparse SVD-based)
├── cb_pipeline.py                 # Content-Based pipeline (TF-IDF + cosine similarity)
├── cold_start.py                  # Cold-start recommendations from onboarding quiz answers
├── quiz_data.json                 # Static onboarding quiz config (served to the frontend)
├── train_models.py                # Offline model training → artifacts/
├── artifacts/                     # Pre-computed model matrices (gitignored)
├── test_pipelines.py              # Full unit test suite (102 tests)
├── test_integration.py           # API endpoint integration tests
├── backend/
│   └── api_server.py              # FastAPI server wiring CF/CB/cold-start into endpoints
├── data_processing/
│   ├── process_json.py            # Ingest raw JSON files → PostgreSQL
│   ├── pipeline.py                # Feature engineering + train/val/test split → CSVs
│   └── analyze.py                 # Exploratory data analysis
├── frontend/
│   ├── .env.example               # API base URL config
│   └── src/
│       └── services/
│           └── apiService.js      # Backend API client
```

---

## Setup

### 1. Python

Download and install Python from **https://python.org/downloads**

> During installation, check **"Add Python to PATH"** before clicking Install.

Verify the installation by opening a new terminal and running:
```powershell
py --version
```

> On Windows, use `py` instead of `python` if `python --version` returns nothing or opens the Microsoft Store.

---

### 2. Install Python dependencies

```powershell
py -m pip install psycopg2-binary pandas scikit-learn scipy numpy pytest "fastapi[standard]" uvicorn joblib httpx
```

---

### 3. PostgreSQL

Download and install PostgreSQL from **https://www.postgresql.org/download/windows**

During installation:
- Note the **password** you set for the `postgres` user — you will need it in step 5.
- Leave the port as **5432**.

After installation, start the PostgreSQL service:
```powershell
Start-Service postgresql*
```

Add PostgreSQL to PATH so `psql` works from any terminal (replace `18` with your version):
```powershell
[System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\Program Files\PostgreSQL\18\bin", "User")
```
Then reopen PowerShell.

---

### 4. Create the database

```powershell
psql -U postgres -c "CREATE DATABASE recommend_db;"
```

Enter your PostgreSQL password when prompted.

---

### 5. Configure credentials and file paths

Open **`data_processing/process_json.py`** and update the top of the file:

```python
# Paths to your local JSON data files
file_path_1  = r'C:\path\to\your\beeradvocate.json'
file_path_2  = r'C:\path\to\your\ratebeer.json'
log_file_path = r'C:\path\to\your\bad_rows_log.txt'

# PostgreSQL connection — update password to match your installation
DB_PARAMS = {
    "dbname": "recommend_db",
    "user": "postgres",
    "password": "YOUR_PASSWORD",   # ← change this
    "host": "localhost",
    "port": 5432
}
```

Open **`data_processing/pipeline.py`** and update the same `DB_PARAMS` block at the top:

```python
DB_PARAMS = {
    "dbname": "recommend_db",
    "user": "postgres",
    "password": "YOUR_PASSWORD",   # ← change this
    "host": "localhost",
    "port": 5432
}
```

---

### 6. Ingest the raw data

This reads both JSON files and loads them into PostgreSQL. It takes several minutes depending on file size.

```powershell
py data_processing/process_json.py
```

You will see progress output like:
```
Initializing Database Schema...
--- Starting Ingestion & Log Discovery for File 1 (BeerAdvocate) ---
[Progress] Evaluated 250,000 lines...
...
[SUCCESS].
```

---

### 7. Generate the enriched CSV files

This runs feature engineering and splits the data into train / validation / test sets.

```powershell
py data_processing/pipeline.py
```

This writes four files to the project root:
```
train_set_enriched.csv
val_set_enriched.csv
test_set_enriched.csv
item_profiles_for_cold_start_enriched.csv
```

Verify they were created:
```powershell
ls *.csv
```

---

## Running the frontend

The frontend is a React + Vite app located in the `frontend/` directory. It connects to the live FastAPI backend, but ships with a **Demo Data** toggle so it can also be explored standalone without the backend or database.

- **Demo Data on** (default): the UI renders bundled sample beers — useful for previewing the interface with no backend running.
- **Demo Data off**: the UI calls the backend through `src/services/apiService.js` for live recommendations, beer details, and similar beers. Copy `frontend/.env.example` to `frontend/.env` to point at a non-default backend URL.

### Prerequisites — Node.js

Download and install Node.js from **https://nodejs.org** (choose the LTS version).

Verify the installation:
```powershell
node --version
npm --version
```

### Install and start

```powershell
cd frontend
npm install
npm run dev
```

Vite will print a local URL:
```
  VITE ready in Xms
  ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** in your browser.

### What to test

| Flow | Steps |
|---|---|
| Age gate | Page loads → click "I am 18 or older" |
| Age gate reject | Click "I'm an Atudai" → alert appears |
| Login | Click "Log In" or "Create New Account" → goes to dashboard |
| Beer modal | Click any beer card → detail modal opens |
| Favorites | Click ♡ on a card → heart fills; click "Favorites" in navbar |
| Empty favorites | Go to Favorites before hearting anything → empty state message |
| Logo navigation | In dashboard, click the logo → returns to home swimlanes |
| Logout | Hamburger menu → Logout → back to landing page |

---

## Running the pipelines

Run either pipeline directly:

```powershell
py cf_pipeline.py    # Collaborative Filtering — prints sample recommendations
py cb_pipeline.py    # Content-Based — prints sample recommendations
```

Both pipelines automatically use the real CSVs (`train_set_enriched.csv`, `item_profiles_for_cold_start_enriched.csv`) if they are present in the project root, otherwise they fall back to a small synthetic/demo dataset (`dummy_data.py` for CF, an in-memory mini catalog for CB).

The CF pipeline operates on the rating matrix entirely via sparse matrices, so it scales to the full dataset (tens of thousands of users × beers) without the memory blowups a dense matrix would cause.

---

## Model Evaluation

Run `py train_models.py` to train the models and see per-k RMSE on validation and test sets.
The script evaluates k ∈ {5, 10, 20, 50} and selects the k with lowest validation RMSE.

Artifacts are saved to `artifacts/` and loaded at server startup for fast inference.

---

## Real-Time Feedback Loop

When a user rates a beer through the UI, the system updates recommendations in real time:

1. **Immediate exclusion** — the rated beer is removed from all future recommendation responses for that user.
2. **Heuristic score adjustment** — if the rating is high (≥ 4), similar beers get a 20% score boost. If low (≤ 2), similar beers get a 20% penalty. This shifts the recommendation ranking without recomputing the heavy SVD/TF-IDF matrices.

The feedback state is held in memory (`backend/online_store.py`) and resets on server restart. This is by design — the offline `train_models.py` pipeline handles durable model updates.

### API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ratings` | Record a rating: `{"user_id": "...", "beer_id": "...", "rating": 5}` |

Example:
```powershell
Invoke-RestMethod -Uri http://localhost:8000/ratings `
  -Method Post -ContentType "application/json" `
  -Body '{"user_id": "user_0001", "beer_id": "3947", "rating": 5}'
```

---

## Running the API server

The FastAPI backend wires the CF, CB, and cold-start pipelines together into HTTP endpoints for the frontend.

When developing the app use the following command to enable auto reload
```powershell
py -m fastapi dev
```

Use this command for running the app in production environments
```powershell
py -m fastapi run
```

both commands need to be run in the base project directory

On startup it loads the CF and CB pipelines (real CSVs if present, otherwise demo data) — this can take a little while with the full dataset.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/recommendations/{user_id}?rec_num={int}` | Hybrid CF + CB recommendations for an existing user by id<br>rec_num - optional parameter specifying the number of desired recommendations |
| `GET` | `/recommendations/group?group={group_ids}&rec_num={int}` | Hybrid CF + CB recommendations for a group of users<br>group_ids - string containing comma separated user ids<br>rec_num - optional parameter specifying the number of desired recommendations |
| `GET` | `/quiz` | Serves the onboarding quiz config (`quiz_data.json`) |
| `POST` | `/recommendations/cold-start` | Returns initial recommendations for a new user based on quiz answers |
| `GET` | `/beers/{beer_id}` | Full metadata for a single beer |
| `GET` | `/beers/similar/{beer_id}?n=10` | Similar beers by content similarity |
| `POST` | `/ratings` | Record a beer rating for real-time recommendation updates |

### Cold-start flow (new users)

1. Frontend calls `GET /quiz` to fetch and render the onboarding questions (taste clusters: hoppy, dark, sour, light).
2. User answers each question on a 1–5 scale.
3. Frontend posts the answers:
   ```powershell
   Invoke-RestMethod -Uri http://localhost:8000/recommendations/cold-start `
     -Method Post -ContentType "application/json" `
     -Body '{"answers": {"hoppy": 5, "dark": 1, "sour": 1, "light": 2}}'
   ```
4. The response contains `recommended_ids` and matching `scores`, computed by `cold_start.get_cold_start_recommendations()` from a blend of quiz-based style matching and overall beer popularity — in the same format as `cb_recommend`/`cf_recommend`.

---

## Running the tests

Unit tests (102 tests):
```powershell
py -m pytest test_pipelines.py -v
```

Integration tests (requires trained models or CSV data):
```powershell
py -m pytest test_integration.py -v
```

The unit suite has 102 tests covering:
- Dummy data generation (shape, value range, sparsity, reproducibility)
- CF pipeline: scale detection, U/V matrix shapes, prediction range, `cf_recommend` no-overlap guarantee
- CB pipeline: feature matrix, `similar_beers`, `cb_recommend` no-overlap guarantee, recommendation details
- Data processing: feature engineering, word count accuracy, temporal train/val/test split, cold-start item profiles

When the real CSVs are present, the CB pipeline tests run against the full beer catalog instead of the 5-beer demo dataset.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `python` opens Microsoft Store | Windows Store stub intercepts `python` | Use `py` instead, or disable the alias in *Manage app execution aliases* |
| `ModuleNotFoundError: psycopg2` | Dependencies not installed | Run `py -m pip install psycopg2-binary` |
| `Connection refused` on port 5432 | PostgreSQL not running | Run `Start-Service postgresql*` |
| `psql` not recognised | PostgreSQL bin not in PATH | Add `C:\Program Files\PostgreSQL\18\bin` to PATH (see step 3) |
| `database "recommend_db" does not exist` | Database not created | Run `psql -U postgres -c "CREATE DATABASE recommend_db;"` |
| `authentication failed for user "postgres"` | Wrong password in `DB_PARAMS` | Update `password` in both `process_json.py` and `pipeline.py` |
| No CSV files after running `pipeline.py` | `process_json.py` failed first | Check the output of `process_json.py` for errors before running `pipeline.py` |
| `npm` not recognised | Node.js not installed or not in PATH | Install from nodejs.org, then reopen PowerShell |
| `npm install` fails with peer dependency errors | Node.js version too old | Install the LTS version from nodejs.org |
| `http://localhost:5173` shows blank page | Dev server not running | Make sure `npm run dev` is still running in the terminal |
| `ModuleNotFoundError: fastapi` / `uvicorn` | Dependencies not installed | Run `py -m pip install fastapi uvicorn` |
| `Invoke-WebRequest : Cannot bind parameter 'Headers'` | PowerShell's `curl` is aliased to `Invoke-WebRequest`, which doesn't accept curl-style flags | Use `Invoke-RestMethod -Uri ... -Method Post -ContentType "application/json" -Body '...'` instead |
| `uvicorn` prints startup output twice | `--reload` runs a reloader process + a worker process | Normal — only the second "Application startup complete" matters |
