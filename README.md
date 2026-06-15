# Recommender Systems Workshop

A beer recommendation system implementing Collaborative Filtering (CF) and Content-Based (CB) pipelines on the BeerAdvocate and RateBeer datasets.

---

## Project Structure

```
Recommender_Systems_Workshop/
├── dummy_data.py                  # Synthetic rating matrix generator (used by CF pipeline fallback)
├── cf_pipeline.py                 # Collaborative Filtering pipeline (sparse SVD-based)
├── cb_pipeline.py                 # Content-Based pipeline (TF-IDF + cosine similarity)
├── cold_start.py                  # Cold-start recommendations from onboarding quiz answers
├── quiz_data.json                 # Static onboarding quiz config (served to the frontend)
├── test_pipelines.py              # Full test suite (102 tests)
├── backend/
│   └── api_server.py              # FastAPI server wiring CF/CB/cold-start into endpoints
├── data_processing/
│   ├── process_json.py            # Ingest raw JSON files → PostgreSQL
│   ├── pipeline.py                # Feature engineering + train/val/test split → CSVs
│   └── analyze.py                 # Exploratory data analysis
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
py -m pip install psycopg2-binary pandas scikit-learn scipy numpy pytest fastapi uvicorn
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

The frontend is a React + Vite app located in the `frontend/` directory. It currently runs on mock data and does not require the backend or database to be set up.

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

## Running the API server

The FastAPI backend wires the CF, CB, and cold-start pipelines together into HTTP endpoints for the frontend.

```powershell
py -m uvicorn backend.api_server:app --reload --port 8000
```

On startup it loads the CF and CB pipelines (real CSVs if present, otherwise demo data) — this can take a little while with the full dataset.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/recommendations/{user_id}` | Hybrid CF + CB recommendations for an existing user |
| `GET` | `/quiz` | Serves the onboarding quiz config (`quiz_data.json`) |
| `POST` | `/recommendations/cold-start` | Returns initial recommendations for a new user based on quiz answers |

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

```powershell
py -m pytest test_pipelines.py -v
```

The test suite has 102 tests covering:
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
