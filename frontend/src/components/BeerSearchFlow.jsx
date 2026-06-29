import React, { useState, useEffect, useRef } from 'react';
// BottleIcon is a named export from Dashboard.jsx (confirmed at line 164).
import { BottleIcon } from './Dashboard';
import { getBeerImage } from '../utils/beerImages';
import { searchBeers } from '../services/apiService';

/**
 * BeerSearchFlow — Method 1 cold-start flow.
 * Users search for real beers, add them, and rate each one 1-5 via BottleIcons.
 * At least 3 beers must be rated (rating > 0) before the Continue button enables.
 *
 * Props:
 *   currentUser       { email, userId }
 *   onComplete        (ratedBeers: Record<beerId, rating>) => void
 *   onSwitchToMethod2 () => void  — used for both the Back button and the "no results" escape hatch
 */
const BeerSearchFlow = ({ onComplete, onSwitchToMethod2 }) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [ratedBeers, setRatedBeers] = useState({});   // beerId -> star (0 = added but unrated)
  const [beerMeta, setBeerMeta] = useState({});        // beerId -> beer object from search
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hovered, setHovered] = useState({});          // beerId -> hovered star index

  const inputRef = useRef(null);

  // Debounced search — fires 300 ms after the user stops typing
  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(false);
      try {
        const data = await searchBeers(query);
        setSearchResults(data.results || []);
        setShowDropdown(true);
      } catch {
        setSearchError(true);
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const addBeer = (beer) => {
    const id = String(beer.beer_id);
    if (ratedBeers[id] !== undefined) {
      // Already in the list — just close the dropdown
      setShowDropdown(false);
      setQuery('');
      return;
    }
    setRatedBeers((prev) => ({ ...prev, [id]: 0 }));
    setBeerMeta((prev) => ({ ...prev, [id]: beer }));
    setShowDropdown(false);
    setQuery('');
  };

  const removeBeer = (beerId) => {
    setRatedBeers((prev) => {
      const next = { ...prev };
      delete next[beerId];
      return next;
    });
  };

  const setRating = (beerId, star) => {
    setRatedBeers((prev) => ({ ...prev, [beerId]: star }));
  };

  const ratedCount = Object.values(ratedBeers).filter((r) => r > 0).length;
  const canContinue = ratedCount >= 3;

  return (
    <div
      style={{
        backgroundColor: '#141414',
        minHeight: '100vh',
        padding: '2rem',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Spinner keyframe — injected once, harmlessly repeated across flows */}
      <style>{`@keyframes csf-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ width: '100%', maxWidth: '600px' }}>
        {/* Back button — intentionally calls onSwitchToMethod2 per spec */}
        <button
          onClick={onSwitchToMethod2}
          style={{
            background: 'none',
            border: 'none',
            color: '#E67E22',
            fontSize: '1rem',
            cursor: 'pointer',
            marginBottom: '1.5rem',
            fontWeight: 'bold',
            padding: 0,
          }}
        >
          &larr; Back
        </button>

        <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', marginBottom: '0.4rem' }}>
          Search for beers you&apos;ve tried
        </h1>
        <p style={{ color: '#aaa', marginBottom: '1.5rem', fontSize: '1rem', lineHeight: '1.5' }}>
          Find and rate beers you know — this gives us the best data to personalize
          your recommendations.
        </p>

        {/* ---- Search input ---- */}
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#1e1e1e',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '0 1rem',
            }}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Search beers by name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: '1rem',
                padding: '0.9rem 0',
              }}
            />
            {isSearching ? (
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  border: '2px solid #E67E22',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'csf-spin 0.7s linear infinite',
                  flexShrink: 0,
                }}
              />
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#666"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            )}
          </div>

          {/* Results dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: '#1e1e1e',
                border: '1px solid #333',
                borderRadius: '8px',
                marginTop: '4px',
                maxHeight: '320px',
                overflowY: 'auto',
                zIndex: 100,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}
            >
              {searchResults.slice(0, 8).map((beer) => (
                <div
                  key={beer.beer_id}
                  onMouseDown={() => addBeer(beer)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    borderBottom: '1px solid #2a2a2a',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <img
                    src={getBeerImage(beer.beer_style, beer.beer_id)}
                    alt={beer.beer_name}
                    style={{
                      width: '40px',
                      height: '40px',
                      objectFit: 'cover',
                      borderRadius: '4px',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 'bold',
                        color: '#fff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.95rem',
                      }}
                    >
                      {beer.beer_name}
                    </div>
                    <div style={{ color: '#888', fontSize: '0.8rem' }}>
                      {beer.beer_style}
                      {beer.beer_abv ? ` • ${beer.beer_abv}% ABV` : ''}
                    </div>
                  </div>
                  {typeof beer.avg_overall_rating === 'number' && (
                    <div
                      style={{
                        color: '#E67E22',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        flexShrink: 0,
                      }}
                    >
                      &#9733; {beer.avg_overall_rating.toFixed(1)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Empty results message */}
          {showDropdown &&
            !isSearching &&
            query.trim() &&
            searchResults.length === 0 &&
            !searchError && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  marginTop: '4px',
                  padding: '1rem',
                  zIndex: 100,
                  color: '#aaa',
                  fontSize: '0.9rem',
                }}
              >
                No beers found. Don&apos;t recognize any?{' '}
                <button
                  onClick={onSwitchToMethod2}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#E67E22',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.9rem',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Switch to guided setup
                </button>
              </div>
            )}

          {/* Backend error message */}
          {searchError && query.trim() && !isSearching && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: '#1e1e1e',
                border: '1px solid #c0392b',
                borderRadius: '8px',
                marginTop: '4px',
                padding: '1rem',
                zIndex: 100,
                fontSize: '0.9rem',
              }}
            >
              <span style={{ color: '#e74c3c' }}>
                Could not reach the server.
              </span>{' '}
              <button
                onClick={onSwitchToMethod2}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#E67E22',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Switch to guided setup instead
              </button>
            </div>
          )}
        </div>

        {/* ---- Progress indicator ---- */}
        <div style={{ marginBottom: '1.5rem', minHeight: '1.4rem' }}>
          {canContinue ? (
            <span style={{ color: '#E67E22', fontWeight: 'bold' }}>
              You&apos;re ready! ({ratedCount} rated)
            </span>
          ) : (
            <span style={{ color: '#aaa' }}>
              {ratedCount} of 3 suggested ratings
            </span>
          )}
        </div>

        {/* ---- Rated beers list ---- */}
        {Object.keys(ratedBeers).length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h3
              style={{
                color: '#fff',
                marginBottom: '0.75rem',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Beers you&apos;ve added
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {Object.keys(ratedBeers).map((beerId) => {
                const beer = beerMeta[beerId];
                const rating = ratedBeers[beerId];
                const hoverStar = hovered[beerId] || 0;

                if (!beer) return null;

                return (
                  <div
                    key={beerId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: '#1e1e1e',
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid #2a2a2a',
                    }}
                  >
                    <img
                      src={getBeerImage(beer.beer_style, beer.beer_id)}
                      alt={beer.beer_name}
                      style={{
                        width: '40px',
                        height: '40px',
                        objectFit: 'cover',
                        borderRadius: '4px',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 'bold',
                          color: '#fff',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '0.95rem',
                        }}
                      >
                        {beer.beer_name}
                      </div>
                      <div style={{ color: '#888', fontSize: '0.8rem' }}>
                        {beer.beer_style}
                      </div>
                    </div>

                    {/* Bottle rating */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.15rem',
                        flexShrink: 0,
                      }}
                    >
                      {rating === 0 && (
                        <span
                          style={{
                            color: '#555',
                            fontSize: '0.72rem',
                            marginRight: '0.3rem',
                          }}
                        >
                          Tap a bottle to rate
                        </span>
                      )}
                      {[1, 2, 3, 4, 5].map((star) => (
                        <BottleIcon
                          key={star}
                          filled={star <= (hoverStar || rating)}
                          onMouseEnter={() =>
                            setHovered((prev) => ({ ...prev, [beerId]: star }))
                          }
                          onMouseLeave={() =>
                            setHovered((prev) => ({ ...prev, [beerId]: 0 }))
                          }
                          onClick={() => setRating(beerId, star)}
                        />
                      ))}
                    </div>

                    {/* Remove button */}
                    <button
                      onClick={() => removeBeer(beerId)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#555',
                        fontSize: '1.1rem',
                        cursor: 'pointer',
                        padding: '0 0.2rem',
                        flexShrink: 0,
                        transition: 'color 0.2s',
                        lineHeight: 1,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ff4d4d'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; }}
                      aria-label={`Remove ${beer.beer_name}`}
                    >
                      &#10005;
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- Continue button ---- */}
        <button
          onClick={() => canContinue && onComplete(ratedBeers)}
          disabled={!canContinue}
          style={{
            width: '100%',
            padding: '1rem',
            backgroundColor: canContinue ? '#E67E22' : '#333',
            color: canContinue ? '#fff' : '#666',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            fontSize: '1.05rem',
            cursor: canContinue ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.2s',
          }}
        >
          {canContinue
            ? 'Build my recommendations →'
            : `Rate at least 3 beers to continue (${ratedCount}/3 rated)`}
        </button>
      </div>
    </div>
  );
};

export default BeerSearchFlow;
