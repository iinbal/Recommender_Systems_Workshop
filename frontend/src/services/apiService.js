// --- API Service ---
// Thin wrapper around the FastAPI backend. Every function uses native fetch,
// throws on non-OK responses, and returns parsed JSON. Swapping the backend
// host is done via the VITE_API_BASE_URL env var.

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const request = async (path, options) => {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

// GET /recommendations/{userId}?rec_num={n}
export async function getRecommendations(userId, recNum = 10) {
  return request(`/recommendations/${encodeURIComponent(userId)}?rec_num=${recNum}`);
}

// GET /beers/{beerId}
export async function getBeerDetails(beerId) {
  return request(`/beers/${encodeURIComponent(beerId)}`);
}

// GET /beers/similar/{beerId}?n={n}
export async function getSimilarBeers(beerId, n = 3) {
  return request(`/beers/similar/${encodeURIComponent(beerId)}?n=${n}`);
}

// GET /recommendations/group?group={commaSeparatedIds}&rec_num={n}
export async function getGroupRecommendations(groupIds, recNum = 10) {
  const group = Array.isArray(groupIds) ? groupIds.join(',') : groupIds;
  return request(`/recommendations/group?group=${encodeURIComponent(group)}&rec_num=${recNum}`);
}

// GET /users/sample?n={n}
export async function getSampleUsers(n = 5) {
  return request(`/users/sample?n=${n}`);
}

// GET /beers/top?n={n}
export async function getTopBeers(n = 50) {
  return request(`/beers/top?n=${n}`);
}

// GET /recommendations/{userId}/adventurous?rec_num={n}
export async function getAdventurousRecommendations(userId, recNum = 10) {
  return request(`/recommendations/${encodeURIComponent(userId)}/adventurous?rec_num=${recNum}`);
}

// GET /recommendations/{userId}/anti?rec_num={n}
export async function getAntiRecommendations(userId, recNum = 10) {
  return request(`/recommendations/${encodeURIComponent(userId)}/anti?rec_num=${recNum}`);
}

// POST /ratings
export async function submitRating(userId, beerId, rating) {
  return request('/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, beer_id: beerId, rating }),
  });
}

// GET /beers/search?q=query&limit=20
// Returns: { results: [{beer_id, beer_name, beer_style, beer_abv, avg_overall_rating}], total_matches, showing }
export async function searchBeers(query) {
  return request(`/beers/search?q=${encodeURIComponent(query)}`);
}

// POST each beer rating individually (parallel) — used for Method 1 cold-start
// ratingsDict: Record<beerId, 1|2|3|4|5>
export async function submitColdStartBeerRatings(userId, ratingsDict) {
  return Promise.all(
    Object.entries(ratingsDict).map(([beerId, rating]) =>
      submitRating(userId, beerId, rating)
    )
  );
}

// POST /onboarding/from-attributes — Method 2 cold-start
// payload: { taste, aroma, appearance, palate, abv_pref, styles, n }
// userId lets the backend persist the resulting top picks as real ratings,
// so this user's later GET /recommendations/{userId} calls succeed.
export async function submitAttributesColdStart(userId, payload) {
  return request('/onboarding/from-attributes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, user_id: userId }),
  });
}

// POST /onboarding/hybrid — M1 + M2 combined cold-start
// payload: { rated_beers, attributes, n }
export async function submitHybridColdStart(payload) {
  return request('/onboarding/hybrid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// POST /recommendations/menu-upload (multipart/form-data)
// Returns: { recommended_ids, scores, matched_count, total_extracted }
export async function uploadMenuImage(userId, imageFile, recNum = 10) {
  const formData = new FormData();
  formData.append('user_id', userId);
  formData.append('image', imageFile);
  formData.append('rec_num', recNum);
  const response = await fetch(`${API_BASE}/recommendations/menu-upload`, {
    method: 'POST',
    body: formData,  // no Content-Type header — let browser set multipart boundary
  });
  if (!response.ok) {
    throw new Error(`Menu upload failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
