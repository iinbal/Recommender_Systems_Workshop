"""
train_models.py

One-shot offline training script for the beer recommender system.

Trains both pipelines and persists their artifacts to artifacts/ so the API
server can load precomputed matrices instead of training at request time:

  * CF (sparse truncated SVD)  -> U, V, user means, ids, sparse R, meta
  * CB (content-based)         -> fitted ColumnTransformer + feature matrix

Replicates the preprocessing of cf_pipeline.py and cb_pipeline.py exactly.
Reads flat CSVs from the project root only; no database access. Safe to re-run.

Usage:
    python train_models.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix, csr_matrix, save_npz
from scipy.sparse.linalg import svds

from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
import joblib


BASE_DIR = Path(__file__).resolve().parent
ARTIFACTS_DIR = BASE_DIR / "artifacts"

TRAIN_PATH = BASE_DIR / "train_set_enriched.csv"
VAL_PATH = BASE_DIR / "val_set_enriched.csv"
TEST_PATH = BASE_DIR / "test_set_enriched.csv"
ITEM_PROFILES_PATH = BASE_DIR / "item_profiles_for_cold_start_enriched.csv"

K_CANDIDATES = [5, 10, 20, 50]
KNOWN_SCALES = [1.0, 5.0, 10.0, 20.0]

RATING_COLS = ["username", "beer_id", "rating_overall"]

TEXT_FEATURE = "all_reviews_text"
CATEGORICAL_FEATURES = ["beer_style"]
NUMERIC_FEATURES = [
    "beer_abv",
    "avg_overall_rating",
    "avg_taste_rating",
    "avg_aroma_rating",
    "avg_appearance_rating",
    "avg_palate_rating",
    "avg_review_word_count",
    "total_reviews_count",
]


def log(message: str) -> None:
    print(message, flush=True)


def require_files() -> None:
    missing = [
        str(p)
        for p in (TRAIN_PATH, VAL_PATH, TEST_PATH, ITEM_PROFILES_PATH)
        if not p.exists()
    ]
    if missing:
        log("ERROR: required input CSV(s) not found:")
        for path in missing:
            log(f"  - {path}")
        sys.exit(1)


# ─────────────────────────────────────────────
# CF preprocessing (mirrors cf_pipeline.py)
# ─────────────────────────────────────────────
def detect_scale(sparse_matrix: csr_matrix) -> float:
    """Return the factor to divide by so all stored values land in [0, 1]."""
    if sparse_matrix.nnz == 0:
        return 1.0
    observed_max = float(sparse_matrix.data.max())
    if observed_max <= 1.0:
        return 1.0
    for scale in sorted(KNOWN_SCALES):
        if observed_max <= scale:
            return scale
    return observed_max


def build_rating_matrix(ratings_df: pd.DataFrame):
    """Build a sparse CSR rating matrix + category indexes from a ratings df."""
    ratings_df = ratings_df.dropna(subset=RATING_COLS)
    ratings_df = (
        ratings_df.groupby(["username", "beer_id"], as_index=False)["rating_overall"]
        .mean()
    )

    user_cat = ratings_df["username"].astype("category")
    beer_cat = ratings_df["beer_id"].astype("category")

    user_ids = user_cat.cat.categories
    beer_ids = beer_cat.cat.categories

    R = coo_matrix(
        (
            ratings_df["rating_overall"].astype(float).values,
            (user_cat.cat.codes.values, beer_cat.cat.codes.values),
        ),
        shape=(len(user_ids), len(beer_ids)),
    ).tocsr()

    return R, user_ids, beer_ids


def center_ratings(R_sparse: csr_matrix):
    """Subtract per-user means from rated entries. Returns (R_centered, means)."""
    row_sums = np.asarray(R_sparse.sum(axis=1)).flatten()
    row_counts = np.diff(R_sparse.indptr)
    row_counts_safe = np.where(row_counts == 0, 1, row_counts)
    user_means = row_sums / row_counts_safe

    R_coo = R_sparse.tocoo()
    centered_data = R_coo.data - user_means[R_coo.row]
    R_centered = coo_matrix(
        (centered_data, (R_coo.row, R_coo.col)), shape=R_sparse.shape
    ).tocsr()
    return R_centered, user_means


def factorize(R_centered: csr_matrix, k: int):
    """Truncated SVD with sigma split evenly into U and V (sqrt). Returns U, V."""
    U_raw, sigma, Vt_raw = svds(R_centered, k=k)

    # svds returns ascending singular values; reverse to strongest-first.
    U_raw = U_raw[:, ::-1]
    sigma = sigma[::-1]
    Vt_raw = Vt_raw[::-1, :]

    sigma_sqrt = np.sqrt(np.diag(sigma))
    U = U_raw @ sigma_sqrt
    V = Vt_raw.T @ sigma_sqrt
    return U, V


def eval_rmse(eval_df, U, V, user_means, user_id_to_index, beer_id_to_index) -> float:
    """RMSE over (user, beer) pairs present in both eval set and training set."""
    eval_df = eval_df.dropna(subset=RATING_COLS)

    user_idx = eval_df["username"].map(user_id_to_index)
    beer_idx = eval_df["beer_id"].map(beer_id_to_index)
    valid = user_idx.notna() & beer_idx.notna()

    if not valid.any():
        return float("nan")

    rows = user_idx[valid].astype(int).to_numpy()
    cols = beer_idx[valid].astype(int).to_numpy()
    truth = eval_df.loc[valid, "rating_overall"].astype(float).to_numpy()

    preds = np.einsum("ij,ij->i", U[rows], V[cols]) + user_means[rows]
    preds = np.clip(preds, 0.0, 1.0)
    return float(np.sqrt(np.mean((truth - preds) ** 2)))


# ─────────────────────────────────────────────
# CB preprocessing (mirrors cb_pipeline.py)
# ─────────────────────────────────────────────
def build_cb_artifacts(item_profiles: pd.DataFrame):
    """Preprocess item profiles and fit the ColumnTransformer."""
    required = (
        ["beer_id", "beer_name", "beer_style", TEXT_FEATURE] + NUMERIC_FEATURES
    )
    missing = [c for c in required if c not in item_profiles.columns]
    if missing:
        log(f"ERROR: item_profiles missing required columns: {missing}")
        sys.exit(1)

    item_profiles = item_profiles.copy()
    item_profiles[TEXT_FEATURE] = item_profiles[TEXT_FEATURE].fillna("")
    item_profiles["beer_style"] = item_profiles["beer_style"].fillna("unknown")

    for col in NUMERIC_FEATURES:
        item_profiles[col] = pd.to_numeric(item_profiles[col], errors="coerce")

    if item_profiles["beer_abv"].notna().any():
        item_profiles["beer_abv"] = item_profiles["beer_abv"].fillna(
            item_profiles["beer_abv"].median()
        )
    else:
        item_profiles["beer_abv"] = item_profiles["beer_abv"].fillna(0)

    for col in NUMERIC_FEATURES:
        item_profiles[col] = item_profiles[col].fillna(0)

    preprocessor = ColumnTransformer(
        transformers=[
            ("style", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
            ("numeric", StandardScaler(), NUMERIC_FEATURES),
            (
                "text",
                TfidfVectorizer(max_features=2000, stop_words="english", min_df=1),
                TEXT_FEATURE,
            ),
        ],
        remainder="drop",
    )

    feature_matrix = preprocessor.fit_transform(item_profiles)
    beer_ids = item_profiles["beer_id"].astype(str).values
    return item_profiles, preprocessor, feature_matrix, beer_ids


# ─────────────────────────────────────────────
# Persistence helpers
# ─────────────────────────────────────────────
def ensure_csr(matrix):
    return matrix.tocsr() if hasattr(matrix, "tocsr") else csr_matrix(matrix)


def report_artifacts() -> None:
    log("\nArtifacts written to artifacts/:")
    total = 0
    for path in sorted(ARTIFACTS_DIR.iterdir()):
        if path.is_file():
            size = path.stat().st_size
            total += size
            log(f"  {path.name:<28} {size / 1024:>12,.1f} KB")
    log(f"  {'TOTAL':<28} {total / (1024 * 1024):>12,.2f} MB")


def append_gitignore() -> None:
    gitignore = BASE_DIR / ".gitignore"
    entry = "artifacts/"
    lines = []
    if gitignore.exists():
        lines = gitignore.read_text(encoding="utf-8").splitlines()
        if any(line.strip().rstrip("/") == "artifacts" for line in lines):
            return
    with gitignore.open("a", encoding="utf-8") as fh:
        if lines and lines[-1].strip() != "":
            fh.write("\n")
        fh.write(entry + "\n")
    log("Added 'artifacts/' to .gitignore")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
def main() -> None:
    start = time.time()
    require_files()
    ARTIFACTS_DIR.mkdir(exist_ok=True)

    # ── CF: load + build rating matrix ──────────────────────────────
    log("Loading train ratings ...")
    train_ratings = pd.read_csv(TRAIN_PATH, usecols=RATING_COLS)
    log(f"  train rows: {len(train_ratings):,}")

    log("Building sparse rating matrix ...")
    R_sparse, user_ids, beer_ids = build_rating_matrix(train_ratings)
    n_users, n_beers = R_sparse.shape
    log(f"  rating matrix: {n_users:,} users x {n_beers:,} beers, nnz={R_sparse.nnz:,}")

    scale = detect_scale(R_sparse)
    if scale != 1.0:
        log(f"  scale detected: raw ratings on [0, {scale:.0f}] -> dividing to [0, 1]")
        R_sparse = R_sparse / scale
    else:
        log("  scale detected: ratings already in [0, 1]")

    R_centered, user_means = center_ratings(R_sparse)

    user_ids_str = np.asarray(user_ids.astype(str))
    beer_ids_str = np.asarray(beer_ids.astype(str))
    user_id_to_index = {uid: i for i, uid in enumerate(user_ids)}
    beer_id_to_index = {bid: i for i, bid in enumerate(beer_ids)}

    # ── CF: load eval sets ──────────────────────────────────────────
    log("Loading validation and test ratings ...")
    val_df = pd.read_csv(VAL_PATH, usecols=RATING_COLS)
    test_df = pd.read_csv(TEST_PATH, usecols=RATING_COLS)
    if scale != 1.0:
        val_df["rating_overall"] = val_df["rating_overall"] / scale
        test_df["rating_overall"] = test_df["rating_overall"] / scale

    # ── CF: tune k ──────────────────────────────────────────────────
    max_k = min(n_users, n_beers) - 1
    candidates = [k for k in K_CANDIDATES if k <= max_k]
    if not candidates:
        candidates = [max(1, max_k)]

    log("\nTuning k (val/test RMSE):")
    results = []
    best = None
    for k in candidates:
        log(f"  factorizing k={k} ...")
        U_k, V_k = factorize(R_centered, k)
        val_rmse = eval_rmse(val_df, U_k, V_k, user_means, user_id_to_index, beer_id_to_index)
        test_rmse = eval_rmse(test_df, U_k, V_k, user_means, user_id_to_index, beer_id_to_index)
        results.append((k, val_rmse, test_rmse))
        if best is None or val_rmse < best[1]:
            best = (k, val_rmse, U_k, V_k)

    log("\n  {:>4}  {:>10}  {:>10}".format("k", "val_RMSE", "test_RMSE"))
    log("  " + "-" * 28)
    for k, val_rmse, test_rmse in results:
        marker = "  <- best" if k == best[0] else ""
        log("  {:>4}  {:>10.4f}  {:>10.4f}{}".format(k, val_rmse, test_rmse, marker))

    best_k, _, U, V = best
    log(f"\nSelected k={best_k}")

    # ── CF: persist ─────────────────────────────────────────────────
    log("\nSaving CF artifacts ...")
    np.save(ARTIFACTS_DIR / "cf_U.npy", U.astype(np.float64))
    np.save(ARTIFACTS_DIR / "cf_V.npy", V.astype(np.float64))
    np.save(ARTIFACTS_DIR / "cf_user_means.npy", user_means.astype(np.float64))
    np.save(ARTIFACTS_DIR / "cf_user_ids.npy", user_ids_str)
    np.save(ARTIFACTS_DIR / "cf_beer_ids.npy", beer_ids_str)
    save_npz(ARTIFACTS_DIR / "cf_R_sparse.npz", ensure_csr(R_sparse))
    cf_meta = {
        "k": int(best_k),
        "scale": float(scale),
        "n_users": int(n_users),
        "n_beers": int(n_beers),
    }
    (ARTIFACTS_DIR / "cf_meta.json").write_text(json.dumps(cf_meta, indent=2))

    # Free CF eval frames before CB load (item profiles is large).
    del val_df, test_df, train_ratings, R_centered

    # ── CB: load + build ────────────────────────────────────────────
    log("\nLoading item profiles ...")
    item_profiles_raw = pd.read_csv(ITEM_PROFILES_PATH)
    log(f"  item profiles: {item_profiles_raw.shape}")

    log("Fitting CB preprocessor ...")
    item_profiles, preprocessor, feature_matrix, cb_beer_ids = build_cb_artifacts(
        item_profiles_raw
    )
    log(f"  feature matrix: {feature_matrix.shape}")

    log("Building cb_train_df ...")
    cb_train_df = pd.read_csv(TRAIN_PATH, usecols=RATING_COLS)
    cb_train_df = cb_train_df.dropna(subset=RATING_COLS)

    # ── CB: persist ─────────────────────────────────────────────────
    log("Saving CB artifacts ...")
    save_npz(ARTIFACTS_DIR / "cb_feature_matrix.npz", ensure_csr(feature_matrix))
    item_profiles.to_csv(ARTIFACTS_DIR / "cb_item_profiles.csv", index=False)
    cb_train_df.to_csv(ARTIFACTS_DIR / "cb_train_df.csv", index=False)
    np.save(ARTIFACTS_DIR / "cb_beer_ids.npy", cb_beer_ids)
    joblib.dump(preprocessor, ARTIFACTS_DIR / "cb_preprocessor.joblib")

    # ── gitignore + report ──────────────────────────────────────────
    append_gitignore()
    report_artifacts()

    log("\nRMSE summary:")
    log("  {:>4}  {:>10}  {:>10}".format("k", "val_RMSE", "test_RMSE"))
    for k, val_rmse, test_rmse in results:
        log("  {:>4}  {:>10.4f}  {:>10.4f}".format(k, val_rmse, test_rmse))

    elapsed = time.time() - start
    log(f"\nDone in {elapsed:.1f}s (selected k={best_k}, scale={scale:g})")


if __name__ == "__main__":
    main()
