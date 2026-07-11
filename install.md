# Installation Guide

## Prerequisites

You will need:
* Python (download from https://python.org/downloads — check **"Add Python to PATH"** during installation)
* PostgreSQL (download from https://www.postgresql.org/download/windows — note the password you set for the `postgres` user and leave port as **5432**)
* Node.js LTS (download from https://nodejs.org)
* The raw BeerAdvocate and RateBeer JSON data files

## Installation Steps

1. **Clone the repository** and open a PowerShell terminal in the project root.

2. **Install Python dependencies:**
   ```powershell
   py -m pip install psycopg2-binary pandas scikit-learn scipy numpy pytest "fastapi[standard]" uvicorn joblib httpx google-genai rapidfuzz python-dotenv statsmodels
   ```

3. **Start the PostgreSQL service and create the database:**
   ```powershell
   Start-Service postgresql*
   psql -U postgres -c "CREATE DATABASE recommend_db;"
   ```
   Add PostgreSQL to PATH if `psql` is not recognised (replace `18` with your version):
   ```powershell
   [System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\Program Files\PostgreSQL\18\bin", "User")
   ```
   Then reopen PowerShell.

4. **Configure credentials and file paths** — open `data_processing/process_json.py` and update the paths to your JSON files and your PostgreSQL password. Do the same for the `DB_PARAMS` block in `data_processing/pipeline.py`.

5. **Ingest the raw data** (takes several minutes):
   ```powershell
   py data_processing/process_json.py
   ```

6. **Generate CSV data files** (feature engineering + train/val/test split):
   ```powershell
   py data_processing/pipeline.py
   ```
   This writes `train_set_enriched.csv`, `val_set_enriched.csv`, `test_set_enriched.csv`, and `item_profiles_for_cold_start_enriched.csv` into the current directory. Create a `data/` subdirectory and move/rename these four files into it as `train_set.csv`, `val_set.csv`, `test_set.csv`, and `item_profiles_for_cold_start.csv` — the plain names the pipelines and `train_models.py` expect.

**Alternative to step 7**:
```
If you don't want to train the models yourself you can use our pre trained artifacts:
https://drive.google.com/drive/folders/1YlMvoBZrwN_WCzHYXE3bQ9eQG8hp7fc6?usp=sharing
```

7. **Train the models:**
   ```powershell
   py train_models.py
   ```
   Pre-computed artifacts are saved to `artifacts/` and loaded at server startup.

8. **Set the Gemini API key** (required for menu-scanning; get a free key at aistudio.google.com):
   ```powershell
   Copy-Item .env.example .env
   ```
   Then open `.env` and replace `your-api-key-here` with your real key. `.env` is git-ignored, so it's never committed.

9. **Start the backend:**
   ```powershell
   py -m fastapi dev
   ```

10. **Install frontend dependencies and start the dev server** (in a separate terminal):
    ```powershell
    cd frontend
    npm install
    npm run dev
    ```

11. Open **http://localhost:5173** in your browser.

## Post-install / Verification

* Verify Python: `py --version`
* Verify Node.js: `node --version` and `npm --version`
* Verify the backend is running: open http://localhost:8000 — you should see a health-check response.
* Verify the frontend: open http://localhost:5173 — the beer UI should load.
* Run the unit test suite to confirm the pipelines are working:
  ```powershell
  py -m pytest test_pipelines.py -v
  ```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `python` opens Microsoft Store | Use `py` instead, or disable the alias in *Manage app execution aliases* |
| `ModuleNotFoundError: psycopg2` | Run `py -m pip install psycopg2-binary` |
| `Connection refused` on port 5432 | Run `Start-Service postgresql*` |
| `psql` not recognised | Add `C:\Program Files\PostgreSQL\18\bin` to PATH (see step 3) |
| `database "recommend_db" does not exist` | Run `psql -U postgres -c "CREATE DATABASE recommend_db;"` |
| `authentication failed for user "postgres"` | Update `password` in both `process_json.py` and `pipeline.py` |
| No CSV files after running `pipeline.py` | Check the output of `process_json.py` for errors first |
| `FileNotFoundError: data/train_set.csv` | Create `data/` and rename old `*_enriched.csv` files — see step 6 notes |
| `npm` not recognised | Install Node.js from nodejs.org and reopen PowerShell |
| `npm install` fails with peer dependency errors | Install the LTS version of Node.js |
| `http://localhost:5173` shows blank page | Make sure `npm run dev` is still running |
| `ModuleNotFoundError: fastapi` / `uvicorn` | Run `py -m pip install fastapi uvicorn` |
| `ImportError: cannot import name 'genai' from 'google'` | Run `py -m pip install google-genai` |
| `ModuleNotFoundError: rapidfuzz` | Run `py -m pip install rapidfuzz` |
| Menu upload returns no beers / Gemini auth error | Set the `GOOGLE_API_KEY` environment variable (see step 8) |
