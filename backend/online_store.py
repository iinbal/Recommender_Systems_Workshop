"""
online_store.py

Thread-safe in-memory store for real-time feedback.
Tracks which beers each user has rated at runtime (for exclusion from
future recommendations) and optional score multipliers for similar beers
(to heuristically adjust recommendations without recomputing SVD/TF-IDF).

In-memory only; api_server.py rehydrates it from new_ratings.csv on startup
via rehydrate() so registered users' ratings survive a server restart.
"""

import threading

_lock = threading.Lock()

# {user_id: set(beer_id, ...)}
_excluded: dict[str, set] = {}

# {user_id: {beer_id: float_multiplier, ...}}
_adjustments: dict[str, dict] = {}

# {user_id: {beer_id: float_rating}} — actual rating values for fold-in / CB profile
_ratings: dict[str, dict] = {}


def record_rating(user_id: str, beer_id, rating: float) -> None:
    """Mark a beer as rated by a user (adds to exclusion set)."""
    with _lock:
        _excluded.setdefault(user_id, set()).add(beer_id)


def record_rating_value(user_id: str, beer_id, rating: float) -> None:
    """Store the numeric rating value for a beer (used for fold-in and CB profile building)."""
    with _lock:
        _ratings.setdefault(user_id, {})[beer_id] = float(rating)


def get_user_ratings(user_id: str) -> dict:
    """Return {beer_id: rating} for all beers the user has rated this session."""
    with _lock:
        return dict(_ratings.get(user_id, {}))


def get_excluded_ids(user_id: str) -> set:
    """Return the set of beer IDs the user has rated at runtime."""
    with _lock:
        return set(_excluded.get(user_id, ()))


def add_score_adjustments(user_id: str, adjustments: dict) -> None:
    """Merge score multipliers into the user's adjustment map.
    adjustments: {beer_id: multiplier} where multiplier > 1 = boost, < 1 = penalty."""
    with _lock:
        existing = _adjustments.setdefault(user_id, {})
        existing.update(adjustments)


def get_score_adjustments(user_id: str) -> dict:
    """Return {beer_id: multiplier} for heuristic score tweaks."""
    with _lock:
        return dict(_adjustments.get(user_id, {}))


def clear_user(user_id: str) -> None:
    """Remove all runtime state for a user (useful for testing)."""
    with _lock:
        _excluded.pop(user_id, None)
        _adjustments.pop(user_id, None)
        _ratings.pop(user_id, None)


def rehydrate(rows) -> int:
    """
    Repopulate _ratings/_excluded from previously-persisted (user_id, beer_id, rating)
    tuples (e.g. read back from new_ratings.csv on server startup), so a registered
    user's personalization survives a backend restart. Returns the number of rows applied.
    """
    count = 0
    for user_id, beer_id, rating in rows:
        record_rating(user_id, beer_id, rating)
        record_rating_value(user_id, beer_id, rating)
        count += 1
    return count
