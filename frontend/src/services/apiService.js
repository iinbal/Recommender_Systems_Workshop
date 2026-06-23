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

// GET /quiz
export async function getQuiz() {
  return request('/quiz');
}

// POST /recommendations/cold-start
export async function getColdStartRecommendations(answers) {
  return request('/recommendations/cold-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
}

// GET /users/sample?n={n}
export async function getSampleUsers(n = 5) {
  return request(`/users/sample?n=${n}`);
}

// POST /ratings
export async function submitRating(userId, beerId, rating) {
  return request('/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, beer_id: beerId, rating }),
  });
}
