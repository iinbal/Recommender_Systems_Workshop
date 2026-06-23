"""
online_store.py

Thread-safe in-memory store for real-time feedback.
Tracks which beers each user has rated at runtime (for exclusion from
future recommendations) and optional score multipliers for similar beers
(to heuristically adjust recommendations without recomputing SVD/TF-IDF).

Resets on server restart — that's intentional.
"""

import threading

_lock = threading.Lock()

# {user_id: set(beer_id, ...)}
_excluded: dict[str, set] = {}

# {user_id: {beer_id: float_multiplier, ...}}
_adjustments: dict[str, dict] = {}


def record_rating(user_id: str, beer_id, rating: float) -> None:
    """Mark a beer as rated by a user (adds to exclusion set)."""
    with _lock:
        _excluded.setdefault(user_id, set()).add(beer_id)


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
