import psycopg2
import pandas as pd
import numpy as np

# ==========================================
# CENTRAL CONFIGURATION BLOCK 
# ==========================================
DB_PARAMS = {
    "dbname": "recommend_db",
    "user": "postgres",
    "password": "Aa321321",
    "host": "localhost",
    "port": 5432
}

MIN_REVIEWS_FOR_SPLIT = 3  # Guardrail for temporal splitting

def load_all_raw_features():
    """Connects to PostgreSQL and loads the filtered data with all new columns."""
    print("Connecting to PostgreSQL and loading filtered_reviews with extended columns...")
    conn = psycopg2.connect(**DB_PARAMS)
    
    query = """
        SELECT 
            fr.username, 
            fr.beer_id, 
            b.brewer_id,
            b.beer_name,
            b.beer_style,
            b.beer_abv,
            fr.review_time, 
            fr.rating_overall, 
            fr.rating_taste, 
            fr.rating_aroma, 
            fr.rating_appearance, 
            fr.rating_palate, 
            fr.review_text 
        FROM filtered_reviews fr
        JOIN beers b ON fr.beer_id = b.beer_id;
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    print(f"Successfully loaded {len(df):,} rows from database.")
    return df

def engineer_advanced_features(df):
    """Performs advanced feature engineering (Seasonality, Word Count) on the dataset."""
    print("\n--- Starting Advanced Feature Engineering ---")
    
    # 1. Convert UNIX timestamp to human-readable datetime
    print("Extracting seasonality features (Month and Year) from timestamp...")
    df['review_datetime'] = pd.to_datetime(df['review_time'], unit='s')
    df['review_month'] = df['review_datetime'].dt.month
    df['review_year'] = df['review_datetime'].dt.year
    
    # 2. Calculate review length / word count
    print("Calculating review text word counts...")
    df['review_text'] = df['review_text'].fillna('').astype(str)
    df['review_word_count'] = df['review_text'].apply(lambda x: len(x.split()))
    
    # Drop temporary datetime column
    df.drop(columns=['review_datetime'], inplace=True)
    print("Feature engineering complete!")
    return df

def execute_final_split(df):
    """Splits the enriched dataset into Train, Val, and Test using Per-User Temporal Leave-Last-1."""
    print("\n--- Executing Per-User Temporal Split ---")
    
    df_sorted = df.sort_values(by=['username', 'review_time']).reset_index(drop=True)
    
    df_sorted['user_total_reviews'] = df_sorted.groupby('username')['username'].transform('count')
    df_sorted['review_rank_from_end'] = df_sorted.groupby('username').cumcount(ascending=False)
    
    is_test = (df_sorted['review_rank_from_end'] == 0) & (df_sorted['user_total_reviews'] >= MIN_REVIEWS_FOR_SPLIT)
    is_val = (df_sorted['review_rank_from_end'] == 1) & (df_sorted['user_total_reviews'] >= MIN_REVIEWS_FOR_SPLIT)
    
    df_test = df_sorted[is_test].copy()
    df_val = df_sorted[is_val].copy()
    df_train = df_sorted[~(is_test | is_val)].copy()
    
    for dataset in [df_train, df_val, df_test]:
        dataset.drop(columns=['user_total_reviews', 'review_rank_from_end'], inplace=True)
        
    print(f"Train Set Size:      {len(df_train):,} rows")
    print(f"Validation Set Size: {len(df_val):,} rows")
    print(f"Test Set Size:       {len(df_test):,} rows")
    
    return df_train, df_val, df_test

def build_ultimate_cold_start_profile(df_train, df_all):
    """Builds an aggregated item profile combining metadata, engineered stats, and mega-text."""
    print("\n--- Building Ultimate Cold Start Item Profiles ---")
    
    print("Extracting static beer metadata...")
    beer_metadata = df_all[['beer_id', 'beer_name', 'brewer_id', 'beer_style', 'beer_abv']].drop_duplicates(subset=['beer_id'])
    
    print("Calculating training-set baseline statistics per beer...")
    beer_stats = df_train.groupby('beer_id').agg(
        avg_overall_rating=('rating_overall', 'mean'),
        avg_taste_rating=('rating_taste', 'mean'),
        avg_aroma_rating=('rating_aroma', 'mean'),
        avg_appearance_rating=('rating_appearance', 'mean'),
        avg_palate_rating=('rating_palate', 'mean'),
        avg_review_word_count=('review_word_count', 'mean'),
        total_reviews_count=('username', 'count')
    ).reset_index()
    
    print("Aggregating review texts into mega-text documents per beer...")
    beer_text = df_train.groupby('beer_id')['review_text'].apply(lambda x: ' | '.join(x)).reset_index()
    beer_text.rename(columns={'review_text': 'all_reviews_text'}, inplace=True)
    
    print("Merging metadata, statistical baselines, and text profiles...")
    item_profiles = pd.merge(beer_metadata, beer_stats, on='beer_id', how='left')
    item_profiles = pd.merge(item_profiles, beer_text, on='beer_id', how='left')
    
    fill_values = {col: 0 for col in beer_stats.columns if col != 'beer_id'}
    fill_values['all_reviews_text'] = ''
    item_profiles.fillna(value=fill_values, inplace=True)
    
    return item_profiles

if __name__ == "__main__":
    df_raw = load_all_raw_features()
    df_enriched = engineer_advanced_features(df_raw)
    train_data, val_data, test_data = execute_final_split(df_enriched)
    cold_start_profile = build_ultimate_cold_start_profile(train_data, df_enriched)
    
    print("\nSaving final enriched artifacts to CSV files...")
    train_data.to_csv("train_set_enriched.csv", index=False)
    val_data.to_csv("val_set_enriched.csv", index=False)
    test_data.to_csv("test_set_enriched.csv", index=False)
    cold_start_profile.to_csv("item_profiles_for_cold_start_enriched.csv", index=False)
    
    print("\n[SUCCESS] All 4 enriched datasets are frozen and ready for model development!")