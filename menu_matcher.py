# pip install rapidfuzz

from rapidfuzz import process, fuzz
import pandas as pd
import re

_DROP_WORDS = re.compile(
    r'\b(brewery|brewing|beer|ale|lager|bier|co|company|ltd|inc)\b', re.I
)

# Menu section headers / category labels a vision model can plausibly
# mis-extract as a "beer name". If every token in the extracted name is one
# of these, there's no beer identity to match on, so skip it outright rather
# than let it coincidentally fuzzy-match an unrelated catalog entry (e.g.
# "Imports" -> "Midnight Sun Specialty Imports ... Oak Aged").
_NON_BEER_TOKENS = {
    'on', 'tap', 'taps', 'draft', 'drafts', 'bottle', 'bottles', 'can', 'cans',
    'bottled', 'canned', 'import', 'imports', 'imported', 'domestic', 'craft',
    'other', 'misc', 'miscellaneous', 'seasonal', 'rotating', 'house', 'menu',
    'beverage', 'beverages',
}


def _normalize(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r'[^a-z0-9\s]', ' ', name)   # strip punctuation
    name = _DROP_WORDS.sub(' ', name)
    return re.sub(r'\s+', ' ', name).strip()


def _is_non_beer_noise(name_norm: str) -> bool:
    tokens = name_norm.split()
    return bool(tokens) and all(t in _NON_BEER_TOKENS for t in tokens)


def _name_overlap_fraction(name_norm: str, match_norm: str) -> float:
    """Fraction of the extracted NAME's tokens (brewery excluded) that also
    appear in the matched catalog name. Excluding brewery matters because
    item_profiles has no brewery-name text (only a numeric brewer_id), so
    brewery tokens can never match and would otherwise just dilute the
    score for otherwise-perfect matches."""
    name_tokens = set(name_norm.split())
    if not name_tokens:
        return 0.0
    match_tokens = set(match_norm.split())
    return len(name_tokens & match_tokens) / len(name_tokens)


def match_menu_beers(
    extracted: list[dict],        # [{"name": str, "brewery": str | None}, ...]
    item_profiles_df,             # pd.DataFrame with columns: beer_id, beer_name
    threshold: int = 75,
    min_name_overlap: float = 1.0,
    candidate_pool: int = 1000,
) -> tuple[list, int]:
    """
    Fuzzy-match extracted menu beer names to item_profiles entries.
    Returns: (matched_beer_ids, total_extracted_count)
    - matched_beer_ids: list of beer_id values (native dtype from the DataFrame)
    - total_extracted_count: len(extracted) — how many names were found on the menu

    Matching happens in two stages, both discovered by testing real menu
    photos in menus_for_test/ (see tuning notes):

    1. Exact match: token_set_ratio saturates at 100 for huge numbers of
       unrelated short catalog names (e.g. "Coors Light" ties at 100 with
       "Light", "Light Ale", "Light Lager", ...), so process.extractOne's
       single arbitrary pick very often returns the wrong one even when the
       queried beer exists verbatim in the catalog. An exact normalized-name
       lookup sidesteps that entirely. When duplicate catalog rows share the
       same name, the most-reviewed one is preferred as canonical.
    2. Fuzzy fallback: for non-exact queries, candidate_pool candidates at
       the top token_set_ratio score are pulled (not just one), and the one
       with the highest name-overlap fraction is chosen. candidate_pool
       defaults large (1000) because token_set_ratio saturates at 100 for
       every catalog entry whose name is a token-subset of the query — with
       70k+ beers, generic single-word entries ("IPA", "Stout", "Pilsner")
       can tie at 100 in the hundreds, burying a genuinely correct but more
       specific match (e.g. "Samuel Smith Nut Brown" only finds "Samuel
       Smith's Nut Brown Ale" once the pool is >=200). process.extract
       already scores the full catalog regardless of limit, so a large pool
       costs no extra scoring time — only slightly more heap bookkeeping.

    Two guards beyond the raw token_set_ratio score:
    - min_name_overlap: requires this fraction of the extracted NAME's own
      tokens (brewery excluded) to appear in the matched catalog name.
      Default 1.0 (full containment) favors precision — e.g. rejects
      "Bitburger Pilsner" -> "Pilsner" (brand lost) and "Carlsberg Premium"
      -> "Premium Ale" (brand lost), while still accepting "Corona" ->
      "Corona Extra" and "Moose Drool" -> "Moose Drool Brown Ale".
    - non-beer noise tokens (on tap, imports, domestic, ...): skipped before
      matching, since these are menu section headers, not beer identities,
      and can otherwise coincidentally match as a literal substring of an
      unrelated long catalog name.
    """
    total_extracted_count = len(extracted)

    catalog_names = item_profiles_df['beer_name'].tolist()
    catalog_ids = item_profiles_df['beer_id'].tolist()
    catalog_names_norm = [_normalize(n) for n in catalog_names]
    if 'total_reviews_count' in item_profiles_df.columns:
        catalog_reviews = item_profiles_df['total_reviews_count'].tolist()
    else:
        catalog_reviews = [0] * len(catalog_names)

    exact_lookup = {}
    for idx, n in enumerate(catalog_names_norm):
        exact_lookup.setdefault(n, []).append(idx)

    matched_beer_ids = []
    seen_ids = set()

    for item in extracted:
        name = item.get('name', '')
        # NOTE: brewery is intentionally NOT used for scoring. item_profiles
        # has no brewery-name text (only a numeric brewer_id), so brewery
        # words can never legitimately match — they can only inject false
        # positives, e.g. name="Passion Fruit Sour" + brewery="Red Rock"
        # scoring 100 against a catalog beer literally named "Red" (the
        # brewery word "Red" is a full token-subset match on its own).

        name_norm = _normalize(name)
        if _is_non_beer_noise(name_norm):
            continue

        exact_candidates = exact_lookup.get(name_norm)
        if exact_candidates:
            idx = max(exact_candidates, key=lambda i: catalog_reviews[i])
            beer_id = catalog_ids[idx]
            if beer_id not in seen_ids:
                seen_ids.add(beer_id)
                matched_beer_ids.append(beer_id)
            continue

        candidates = process.extract(
            name_norm,
            catalog_names_norm,
            scorer=fuzz.token_set_ratio,
            limit=candidate_pool,
        )
        candidates = [c for c in candidates if c[1] >= threshold]
        if not candidates:
            continue

        match_norm, score, idx = max(
            candidates,
            key=lambda c: (_name_overlap_fraction(name_norm, c[0]), c[1], catalog_reviews[c[2]]),
        )
        if _name_overlap_fraction(name_norm, match_norm) < min_name_overlap:
            continue

        beer_id = catalog_ids[idx]
        if beer_id not in seen_ids:
            seen_ids.add(beer_id)
            matched_beer_ids.append(beer_id)

    return matched_beer_ids, total_extracted_count
