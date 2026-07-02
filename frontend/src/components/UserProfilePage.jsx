import { useState, useMemo, useEffect } from 'react';
import { getUserRecord, updateDisplayName, updatePassword } from '../services/authService';
import { getBeerImage } from '../utils/beerImages';
import { getBeerDetails } from '../services/apiService';

// ─── Shared UI primitives ────────────────────────────────────────────────────

const Section = ({ title, children }) => (
  <div style={{
    backgroundColor: '#1e1e1e',
    border: '1px solid #2a2a2a',
    borderRadius: '10px',
    padding: '1.5rem',
    marginBottom: '1.25rem',
  }}>
    <h3 style={{ margin: '0 0 1rem', color: '#E67E22', fontSize: '1rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {title}
    </h3>
    {children}
  </div>
);

const Feedback = ({ msg, isError }) =>
  msg ? (
    <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: isError ? '#e74c3c' : '#2ecc71' }}>
      {msg}
    </p>
  ) : null;

const inputStyle = {
  width: '100%',
  backgroundColor: '#141414',
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#fff',
  padding: '0.65rem 0.8rem',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  outline: 'none',
};

const btnStyle = (disabled) => ({
  marginTop: '0.75rem',
  padding: '0.6rem 1.5rem',
  backgroundColor: disabled ? '#333' : '#E67E22',
  color: disabled ? '#666' : '#fff',
  border: 'none',
  borderRadius: '6px',
  fontWeight: 'bold',
  fontSize: '0.95rem',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background-color 0.2s',
});

// ─── Friend compatibility helpers ────────────────────────────────────────────

const FRIENDS = ['Alex (Lager Lover)', 'Sarah (Hops Fanatic)', 'David (Stout Guy)'];

const djb2 = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  return h;
};

const buildFriendRatings = (friendName, beers) =>
  beers.reduce((acc, beer) => {
    const key = `${friendName}|${beer.id}`;
    if (djb2(key) % 10 < 9) acc[String(beer.id)] = 1 + (djb2(key + '_r') % 5);
    return acc;
  }, {});

const compatibilityColor = (pct) => {
  if (pct >= 80) return '#2ecc71';
  if (pct >= 60) return '#f39c12';
  return '#e74c3c';
};

// ─── Main component ──────────────────────────────────────────────────────────

const UserProfilePage = ({ userId, userRatings = {}, allUniqueBeers = [] }) => {
  // ── All hooks unconditionally at the top ──────────────────────────────────
  const [record, setRecord] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [nameMsg, setNameMsg] = useState({ text: '', error: false });
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState({ text: '', error: false });
  const [selectedFriend, setSelectedFriend] = useState('');

  useEffect(() => {
    const r = getUserRecord(userId);
    setRecord(r);
    if (r) setNameInput(r.username || '');
  }, [userId]);

  // Merge persisted ratings (plain numbers) with current-session prop ({ rating, review }).
  const normalizedUserRatings = useMemo(() => {
    if (!record) return {};
    const merged = { ...(record.ratings || {}) };
    Object.entries(userRatings).forEach(([id, val]) => {
      merged[id] = typeof val === 'object' ? val.rating : val;
    });
    return merged;
  }, [record, userRatings]);

  // Friend compatibility must compare against beers the user has actually rated, not
  // whatever happens to be in the current (volatile) recommendation feed — a rated beer
  // is excluded from the user's own future feeds, so allUniqueBeers would almost never
  // overlap with normalizedUserRatings. Beer-card details for rated IDs not already
  // present in allUniqueBeers are fetched here so this list stays stable across refreshes.
  const [ratedBeerCards, setRatedBeerCards] = useState([]);
  const [ratedBeersLoading, setRatedBeersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ratedIds = Object.keys(normalizedUserRatings);

    if (ratedIds.length === 0) {
      setRatedBeerCards([]);
      setRatedBeersLoading(false);
      return;
    }

    setRatedBeersLoading(true);
    const knownById = new Map(allUniqueBeers.map((b) => [String(b.id), b]));
    const missingIds = ratedIds.filter((id) => !knownById.has(String(id)));

    Promise.all(
      missingIds.map((id) =>
        getBeerDetails(id)
          .then((beer) => ({
            id: beer.beer_id,
            name: beer.beer_name,
            style: beer.beer_style,
            abv: beer.beer_abv,
            rating: beer.avg_overall_rating,
          }))
          .catch(() => null)
      )
    ).then((fetched) => {
      if (cancelled) return;
      const known = ratedIds
        .filter((id) => knownById.has(String(id)))
        .map((id) => knownById.get(String(id)));
      setRatedBeerCards([...known, ...fetched.filter(Boolean)]);
      setRatedBeersLoading(false);
    });

    return () => { cancelled = true; };
  }, [normalizedUserRatings, allUniqueBeers]);

  const friendRatings = useMemo(
    () => selectedFriend ? buildFriendRatings(selectedFriend, ratedBeerCards) : {},
    [selectedFriend, ratedBeerCards]
  );

  const { sharedBeers, compatibility, sharedFavorites } = useMemo(() => {
    if (!selectedFriend || ratedBeersLoading || !ratedBeerCards.length) {
      return { sharedBeers: [], compatibility: null, sharedFavorites: [] };
    }

    const shared = ratedBeerCards.filter((beer) => {
      const id = String(beer.id);
      return normalizedUserRatings[id] != null && friendRatings[id] != null;
    });

    if (shared.length === 0) {
      return { sharedBeers: [], compatibility: null, sharedFavorites: [] };
    }

    const avgDiff =
      shared.reduce((sum, beer) => {
        const id = String(beer.id);
        return sum + Math.abs(normalizedUserRatings[id] - friendRatings[id]);
      }, 0) / shared.length;

    const pct = Math.max(0, Math.round(100 * (1 - avgDiff / 4)));

    const favorites = shared.filter((beer) => {
      const id = String(beer.id);
      return normalizedUserRatings[id] >= 4 && friendRatings[id] >= 4;
    });

    return { sharedBeers: shared, compatibility: pct, sharedFavorites: favorites };
  }, [selectedFriend, ratedBeerCards, ratedBeersLoading, normalizedUserRatings, friendRatings]);

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!record) {
    return (
      <div style={{ padding: '3rem', color: '#aaa', textAlign: 'center' }}>
        Profile not found.
      </div>
    );
  }

  // ── Derived display values ────────────────────────────────────────────────
  const initials = (record.username || userId)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const ratingCount = Object.keys(normalizedUserRatings).length;

  const handleSaveName = () => {
    const result = updateDisplayName(userId, nameInput);
    if (result.success) {
      setRecord((prev) => ({ ...prev, username: nameInput.trim() }));
      setNameMsg({ text: 'Display name updated.', error: false });
    } else {
      setNameMsg({ text: result.error, error: true });
    }
  };

  const handleSavePassword = () => {
    if (newPw !== confirmPw) {
      setPwMsg({ text: 'New passwords do not match.', error: true });
      return;
    }
    const result = updatePassword(userId, currentPw, newPw);
    if (result.success) {
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg({ text: 'Password changed successfully.', error: false });
    } else {
      setPwMsg({ text: result.error, error: true });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', padding: '2rem 1rem' }}>

      {/* Avatar + identity header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '2rem' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          backgroundColor: '#E67E22',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.6rem', fontWeight: 'bold', color: '#fff', flexShrink: 0,
        }}>
          {initials || '?'}
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#fff' }}>
            {record.username || userId}
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.9rem', color: '#888' }}>
            {userId}
          </p>
        </div>
      </div>

      {/* Stats */}
      <Section title="Stats">
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div>
            <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', color: '#E67E22' }}>
              {ratingCount}
            </p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#aaa' }}>
              beers rated
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', color: record.coldStartCompleted ? '#2ecc71' : '#e74c3c' }}>
              {record.coldStartCompleted ? '✓' : '✗'}
            </p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#aaa' }}>
              taste profile
            </p>
          </div>
        </div>
      </Section>

      {/* Friend Compatibility */}
      <Section title="Friend Compatibility">
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '0.5rem' }}>
          Compare your taste with a friend
        </label>
        <select
          value={selectedFriend}
          onChange={(e) => setSelectedFriend(e.target.value)}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.75rem center',
            paddingRight: '2rem',
          }}
        >
          <option value="">— Select a friend —</option>
          {FRIENDS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>

        {selectedFriend && (
          <div style={{ marginTop: '1.25rem' }}>
            {ratedBeersLoading ? (
              <p style={{ color: '#888', fontSize: '0.9rem', margin: 0 }}>
                Loading your ratings&hellip;
              </p>
            ) : compatibility === null ? (
              <p style={{ color: '#888', fontSize: '0.9rem', margin: 0 }}>
                Not enough shared ratings to calculate compatibility. Rate more beers to see your match with {selectedFriend.split(' ')[0]}!
              </p>
            ) : (
              <>
                {/* Score */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '3.2rem', fontWeight: 'bold', color: compatibilityColor(compatibility), lineHeight: 1 }}>
                    {compatibility}%
                  </span>
                  <span style={{ color: '#888', fontSize: '0.9rem' }}>
                    taste match with {selectedFriend.split(' ')[0]}
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ height: '6px', backgroundColor: '#2a2a2a', borderRadius: '99px', marginBottom: '1rem', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${compatibility}%`,
                    backgroundColor: compatibilityColor(compatibility),
                    borderRadius: '99px',
                    transition: 'width 0.4s ease',
                  }} />
                </div>

                <p style={{ color: '#666', fontSize: '0.78rem', margin: '0 0 1.25rem' }}>
                  Based on {sharedBeers.length} beer{sharedBeers.length !== 1 ? 's' : ''} you both rated
                </p>

                {/* Shared favorites */}
                {sharedFavorites.length > 0 ? (
                  <>
                    <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: '#aaa', fontWeight: 'bold' }}>
                      Top Shared Favorites
                    </p>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                      {sharedFavorites.map((beer) => {
                        const uid = String(beer.id);
                        const avgStars = Math.round((normalizedUserRatings[uid] + friendRatings[uid]) / 2);
                        return (
                          <div
                            key={beer.id}
                            title={`${beer.name} · You: ${normalizedUserRatings[uid]}★ · ${selectedFriend.split(' ')[0]}: ${friendRatings[uid]}★`}
                            style={{
                              width: '72px',
                              backgroundColor: '#141414',
                              border: '1px solid #2a2a2a',
                              borderRadius: '8px',
                              overflow: 'hidden',
                            }}
                          >
                            <img
                              src={getBeerImage(beer.style, beer.id)}
                              alt={beer.name}
                              style={{ width: '100%', height: '60px', objectFit: 'cover', display: 'block' }}
                            />
                            <div style={{ padding: '0.3rem 0.4rem' }}>
                              <p style={{ margin: 0, fontSize: '0.65rem', color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {beer.name}
                              </p>
                              <p style={{ margin: '0.1rem 0 0', fontSize: '0.6rem', color: '#E67E22' }}>
                                {'★'.repeat(avgStars)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p style={{ color: '#666', fontSize: '0.85rem', margin: 0 }}>
                    No shared favorites yet — rate more beers 4★ or higher to find common ground!
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Section>

      {/* Edit display name */}
      <Section title="Display Name">
        <input
          style={inputStyle}
          value={nameInput}
          onChange={(e) => { setNameInput(e.target.value); setNameMsg({ text: '', error: false }); }}
          maxLength={40}
          placeholder="Your display name"
        />
        <Feedback msg={nameMsg.text} isError={nameMsg.error} />
        <button
          style={btnStyle(!nameInput.trim() || nameInput.trim() === record.username)}
          disabled={!nameInput.trim() || nameInput.trim() === record.username}
          onClick={handleSaveName}
        >
          Save
        </button>
      </Section>

      {/* Change password */}
      <Section title="Change Password">
        {[
          { label: 'Current password',     value: currentPw,  setter: setCurrentPw },
          { label: 'New password',          value: newPw,      setter: setNewPw },
          { label: 'Confirm new password',  value: confirmPw,  setter: setConfirmPw },
        ].map(({ label, value, setter }) => (
          <div key={label} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '0.3rem' }}>
              {label}
            </label>
            <input
              type="password"
              style={inputStyle}
              value={value}
              onChange={(e) => { setter(e.target.value); setPwMsg({ text: '', error: false }); }}
            />
          </div>
        ))}
        <Feedback msg={pwMsg.text} isError={pwMsg.error} />
        <button
          style={btnStyle(!currentPw || !newPw || !confirmPw)}
          disabled={!currentPw || !newPw || !confirmPw}
          onClick={handleSavePassword}
        >
          Change Password
        </button>
      </Section>

    </div>
  );
};

export default UserProfilePage;
