# Recommender Systems Workshop

A beer recommendation system implementing Collaborative Filtering (CF) and Content-Based (CB) pipelines on the BeerAdvocate and RateBeer datasets.

---

## Project Structure

```
Recommender_Systems_Workshop/
├── dummy_data.py                  # Synthetic rating matrix generator (used by CF pipeline)
├── cf_pipeline.py                 # Collaborative Filtering pipeline (SVD-based)
├── cb_pipeline.py                 # Content-Based pipeline (TF-IDF + cosine similarity)
├── test_pipelines.py              # Full test suite (102 tests)
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
py -m pip install psycopg2-binary pandas scikit-learn scipy numpy pytest
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

## Running the pipelines

Once the CSVs exist, run either pipeline directly:

```powershell
py cf_pipeline.py    # Collaborative Filtering — prints sample recommendations
py cb_pipeline.py    # Content-Based — prints sample recommendations
```

The CF pipeline uses a synthetic rating matrix by default (`dummy_data.py`). The CB pipeline automatically uses the real CSVs if they are present in the project root, otherwise it falls back to a small demo dataset.

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
