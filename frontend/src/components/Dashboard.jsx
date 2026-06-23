import React, { useState, useMemo, useEffect } from 'react';
import './Dashboard.css';
import logo from '../assets/logo.png';
import { getRecommendations, getBeerDetails, getSimilarBeers, submitRating, getSampleUsers } from '../services/apiService';

const fallbackImage = (name) =>
  `https://placehold.co/200x300/1a1a2e/e67e22?text=${encodeURIComponent(name || 'Beer')}`;

// Maps a /beers/{id} response (plus an optional match score) into the shape
// the existing card/modal UI expects.
const mapBeerToCard = (beer, score) => ({
  id: beer.beer_id,
  name: beer.beer_name,
  style: beer.beer_style,
  abv: beer.beer_abv,
  match_score: typeof score === 'number' ? score : 0,
  rating: beer.avg_overall_rating,
  image_url: fallbackImage(beer.beer_name),
});

// 1. Updated Navbar with toggle
const Navbar = ({ onLogout, activeTab, setActiveTab, isDemoMode, setIsDemoMode }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <img 
          src={logo} 
          alt="RuBeer Logo" 
          className="nav-logo" 
          onClick={() => setActiveTab('home')}
        />
      </div>
      
      <div className="navbar-right">
        <button className={`nav-link ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setActiveTab('favorites')}>Favorites</button>
        <button className={`nav-link ${activeTab === 'discover' ? 'active' : ''}`} onClick={() => setActiveTab('discover')}>Discover</button>
        <button className="nav-link">Shared With Me</button>
        
        {/* NEW: Demo Toggle Switch */}
        <div className="demo-toggle-container">
          <span className={`demo-label ${isDemoMode ? 'active' : ''}`}>Demo Data</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={isDemoMode} 
              onChange={() => setIsDemoMode(!isDemoMode)} 
            />
            <span className="slider"></span>
          </label>
        </div>

        <div className="profile-menu-container">
          <button className="hamburger-menu" onClick={() => setDropdownOpen(!dropdownOpen)}>
            <span></span>
            <span></span>
            <span></span>
          </button>
          
          {dropdownOpen && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={() => { setActiveTab('home'); setDropdownOpen(false); }}>Home</button>
              <button className="dropdown-item" onClick={() => setDropdownOpen(false)}>Profile</button>
              <div className="dropdown-divider"></div>
              <button className="dropdown-item" style={{ color: '#ff4d4d' }} onClick={onLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export const BottleIcon = ({ filled, onMouseEnter, onMouseLeave, onClick }) => (
  <svg 
    width="24" height="24" viewBox="0 0 24 24" 
    fill={filled ? "#E67E22" : "none"} 
    stroke={filled ? "#E67E22" : "#666"} 
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
    style={{ cursor: 'pointer', transition: 'all 0.1s' }}
    onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onClick}
  >
    <path d="M10 2v5l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-10l-2-3V2z"></path>
    <path d="M10 2h4"></path>
  </svg>
);

// --- Modal Component with Review System ---
const BeerModal = ({ beer, onClose, userRatingData, onSubmitReview, onCardClick }) => {
  const [hoverRating, setHoverRating] = useState(0);
  const [rating, setRating] = useState(userRatingData?.rating || 0);
  const [review, setReview] = useState(userRatingData?.review || '');
  const [similarBeers, setSimilarBeers] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  useEffect(() => {
    if (!beer) return;
    let cancelled = false;

    const fetchSimilar = async () => {
      setLoadingSimilar(true);
      setSimilarBeers([]);
      try {
        const { similar } = await getSimilarBeers(beer.id, 3);
        const details = await Promise.all(
          similar.map((s) => getBeerDetails(s.beer_id))
        );
        if (cancelled) return;
        setSimilarBeers(details.map((d, i) => mapBeerToCard(d, similar[i].score)));
      } catch {
        // Similar beers are non-critical; fail silently.
        if (!cancelled) setSimilarBeers([]);
      } finally {
        if (!cancelled) setLoadingSimilar(false);
      }
    };

    fetchSimilar();
    return () => { cancelled = true; };
  }, [beer]);

  if (!beer) return null;
  const matchPercentage = Math.round(beer.match_score * 100);

  const handleSubmit = () => {
    onSubmitReview(beer.id, rating, review);
    onClose(); 
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="close-button" onClick={onClose}>&times;</button>
        <img src={beer.image_url} alt={beer.name} className="modal-image" />
        <div className="modal-details">
          
          {/* Match Score stays at the top left by itself */}
          <div className="match-score" style={{ backgroundColor: '#E67E22', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '4px', display: 'inline-block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.8rem' }}>
            {matchPercentage}% Match
          </div>

          {/* NEW: Title and Rating locked onto the exact same line */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{beer.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '1.2rem', fontWeight: 'bold', color: '#fff' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#E67E22" stroke="#E67E22"><path d="M10 2v5l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-10l-2-3V2z"></path><path d="M10 2h4"></path></svg>
              {typeof beer.rating === 'number' ? beer.rating.toFixed(1) : "New"}
              <span style={{ fontSize: '0.7rem', fontWeight: 'normal', color: '#aaa' }}>Avg Rating</span>
            </div>
          </div>

          <div className="beer-meta" style={{ marginTop: '0.3rem' }}>{beer.style} • {beer.abv}% ABV</div>
          <div className="modal-divider"></div>
          
          <h3>Why it's a match</h3>
          <p>Based on your preference profiles, this selection lines up beautifully with items you've highly rated.</p>
          
          <div className="flavor-tags">
            <span className="tag">Crisp</span>
            <span className="tag">Citrus</span>
            <span className="tag">Bitter</span>
          </div>

          <div className="review-section">
            <h3>Log Your Tasting</h3>
            <div className="bottle-rating-container">
              {[1, 2, 3, 4, 5].map((star) => (
                <BottleIcon 
                  key={star}
                  filled={star <= (hoverRating || rating)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                />
              ))}
            </div>
            <textarea 
              className="review-textarea"
              style={{ resize: 'none' }} 
              placeholder="What did you think of this brew? (Optional)"
              value={review}
              onChange={(e) => setReview(e.target.value)}
              spellCheck={false}
              data-gramm={false}
            />
            <button 
              className="submit-review-btn" 
              disabled={rating === 0}
              onClick={handleSubmit}
            >
              Save Rating
            </button>
          </div>

          {/* Similar Beers Section */}
          <div className="similar-section">
            <h3>Similar Beers</h3>
            {loadingSimilar ? (
              <div className="similar-loading">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton-card" />)}
              </div>
            ) : similarBeers.length > 0 ? (
              <div className="similar-row">
                {similarBeers.map((sb) => (
                  <div
                    key={sb.id}
                    className="similar-card"
                    onClick={() => onCardClick && onCardClick(sb)}
                  >
                    <img src={sb.image_url} alt={sb.name} />
                    <span>{sb.name}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  );
};

// --- BeerCard Component ---
const BeerCard = ({ beer, onCardClick, isFav, onToggleFav }) => {
  const matchPercentage = Math.round(beer.match_score * 100);
  
  return (
    <div className="beer-card-wrapper">
      <button 
        className={`favorite-heart ${isFav ? 'is-favorite' : ''}`}
        onClick={(e) => {
          e.stopPropagation(); 
          onToggleFav(beer.id);
        }}
      >
        {isFav ? '♥' : '♡'}
      </button>

      <div className="beer-card" onClick={() => onCardClick(beer)}>
        <img src={beer.image_url} alt={beer.name} className="beer-image" />
        <div className="beer-info">
          
          <div className="card-header-row">
            <div className="match-score" style={{ color: '#E67E22', fontWeight: 'bold' }}>
              {matchPercentage}% Match
            </div>
            <div className="card-rating">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#E67E22" stroke="#E67E22" strokeWidth="2"><path d="M10 2v5l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-10l-2-3V2z"></path><path d="M10 2h4"></path></svg>
              {typeof beer.rating === 'number' ? beer.rating.toFixed(1) : "N/A"}
            </div>
          </div>

          <h3 className="beer-title">{beer.name}</h3>
          <div className="beer-meta">{beer.style} • {beer.abv}% ABV</div>
        </div>
      </div>
    </div>
  );
};

// Swimlane
const Swimlane = ({ title, beers, onCardClick, favorites, onToggleFav }) => {
  return (
    <div className="swimlane">
      <h2 className="swimlane-title">{title}</h2>
      <div className="swimlane-row">
        {beers.map((beer) => (
          <BeerCard 
            key={beer.id} 
            beer={beer} 
            onCardClick={onCardClick} 
            isFav={favorites.includes(beer.id)}
            onToggleFav={onToggleFav}
          />
        ))}
      </div>
    </div>
  );
};

// Favorites Page Component
const FavoritesPage = ({ allBeers, favorites, onCardClick, onToggleFav }) => {
  const favoritedBeers = allBeers.filter(beer => favorites.includes(beer.id));

  if (favoritedBeers.length === 0) {
    return (
      <div className="empty-state">
        <h2>Your cellar is empty!</h2>
        <p>Head back to the dashboard and click the heart icon on a beer to save it for later.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Your Favorites</h2>
      <div className="favorites-grid">
        {favoritedBeers.map((beer) => (
          <BeerCard 
            key={beer.id} 
            beer={beer} 
            onCardClick={onCardClick} 
            isFav={true}
            onToggleFav={onToggleFav}
          />
        ))}
      </div>
    </div>
  );
};

// Discover Page Component
const DiscoverPage = ({ allBeers, favorites, onCardClick, onToggleFav }) => {
 const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  
  const filterDefaults = { maxAbv: 20, maxDistance: 100, minRating: 0 };
  const [draftFilters, setDraftFilters] = useState({ ...filterDefaults });
  const [appliedFilters, setAppliedFilters] = useState({});

  const dummyCategories = ["IPA", "Stout", "Lager", "Pilsner", "Ale", "Porter"];

  const handleTagClick = (category) => {
    if (activeTags.includes(category)) {
      setActiveTags(activeTags.filter(tag => tag !== category));
    } else {
      setActiveTags([...activeTags, category]);
    }
  };

  const handleApplyFilters = () => {
    const newApplied = {};
    if (draftFilters.maxAbv < filterDefaults.maxAbv) newApplied.maxAbv = draftFilters.maxAbv;
    if (draftFilters.maxDistance < filterDefaults.maxDistance) newApplied.maxDistance = draftFilters.maxDistance;
    if (draftFilters.minRating > filterDefaults.minRating) newApplied.minRating = draftFilters.minRating;
    
    setAppliedFilters(newApplied);
    setShowFilters(false); 
  };

  const removeFilter = (key) => {
    const newApplied = { ...appliedFilters };
    delete newApplied[key];
    setAppliedFilters(newApplied);
    setDraftFilters({ ...draftFilters, [key]: filterDefaults[key] });
  };

  const filteredBeers = allBeers.filter(beer => {
    const matchesSearch = beer.name.toLowerCase().includes(appliedSearch.toLowerCase()) || 
                          beer.style.toLowerCase().includes(appliedSearch.toLowerCase());
    
    const matchesTags = activeTags.length === 0 || 
      activeTags.some(tag => beer.style.toLowerCase().includes(tag.toLowerCase()));

    const beerAbv = beer.abv || 0;
    const beerDistance = beer.distance || 0; 
    const beerRating = beer.rating || 5; 

    const matchesAbv = appliedFilters.maxAbv ? beerAbv <= appliedFilters.maxAbv : true;
    const matchesDistance = appliedFilters.maxDistance ? beerDistance <= appliedFilters.maxDistance : true;
    const matchesRating = appliedFilters.minRating ? beerRating >= appliedFilters.minRating : true;

    return matchesSearch && matchesTags && matchesAbv && matchesDistance && matchesRating;
  });

  return (
    <div>
      <h2 className="page-title">Discover</h2>
      
      <div className="search-container">
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input 
            type="text" 
            className="search-input" 
            placeholder="Search for a beer name or style..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setAppliedSearch(searchQuery)}
            style={{ flex: 1, margin: 0 }} 
          />
          <button 
            onClick={() => setAppliedSearch(searchQuery)}
            style={{ padding: '0 1.5rem', background: '#E67E22', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Search
          </button>
        </div>
        
        <div className="tags-container">
          {dummyCategories.map(category => (
            <button 
              key={category}
              className={`category-tag ${activeTags.includes(category) ? 'active' : ''}`}
              onClick={() => handleTagClick(category)}
            >
              {category}
            </button>
          ))}
        </div>
        
        <button className="filter-toggle-btn" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? '- Hide Advanced Filters' : '+ Show Advanced Filters'}
        </button>

        {showFilters && (
          <div className="advanced-filters-panel">
            <div className="filters-grid">
              <div className="filter-group">
                <label>Max ABV <span className="filter-value">{draftFilters.maxAbv}%</span></label>
                <input 
                  type="range" min="0" max="20" step="0.5" className="filter-slider"
                  value={draftFilters.maxAbv}
                  onChange={(e) => setDraftFilters({...draftFilters, maxAbv: Number(e.target.value)})}
                />
              </div>

              <div className="filter-group">
                <label>Max Distance <span className="filter-value">{draftFilters.maxDistance} km</span></label>
                <input 
                  type="range" min="1" max="100" step="1" className="filter-slider"
                  value={draftFilters.maxDistance}
                  onChange={(e) => setDraftFilters({...draftFilters, maxDistance: Number(e.target.value)})}
                />
              </div>

              <div className="filter-group">
                <label>Min Rating <span className="filter-value">{draftFilters.minRating} Stars</span></label>
                <input 
                  type="range" min="0" max="5" step="0.1" className="filter-slider"
                  value={draftFilters.minRating}
                  onChange={(e) => setDraftFilters({...draftFilters, minRating: Number(e.target.value)})}
                />
              </div>
            </div>
            
            <button className="apply-filters-btn" onClick={handleApplyFilters}>
              Apply Filters
            </button>
          </div>
        )}

        {Object.keys(appliedFilters).length > 0 && (
          <div className="active-filters-container">
            {appliedFilters.maxAbv && (
              <span className="filter-bubble">
                Max {appliedFilters.maxAbv}% ABV 
                <button onClick={() => removeFilter('maxAbv')}>&times;</button>
              </span>
            )}
            {appliedFilters.maxDistance && (
              <span className="filter-bubble">
                Within {appliedFilters.maxDistance}km 
                <button onClick={() => removeFilter('maxDistance')}>&times;</button>
              </span>
            )}
            {appliedFilters.minRating && (
              <span className="filter-bubble">
                {appliedFilters.minRating}+ Stars 
                <button onClick={() => removeFilter('minRating')}>&times;</button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="results-header">
        Found {filteredBeers.length} {filteredBeers.length === 1 ? 'result' : 'results'}
      </div>

      {filteredBeers.length > 0 ? (
        <div className="favorites-grid">
          {filteredBeers.map((beer) => (
            <BeerCard key={beer.id} beer={beer} onCardClick={onCardClick} isFav={favorites.includes(beer.id)} onToggleFav={onToggleFav} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>No matches found</h2>
          <p>Try adjusting your search or clearing some filters.</p>
        </div>
      )}
    </div>
  );
};

// 3. Main Dashboard Component
const RecommenderDashboard = ({ data, onLogout }) => {
  const [selectedBeer, setSelectedBeer] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [userRatings, setUserRatings] = useState({});
  const [activeTab, setActiveTab] = useState('home');

  // NEW: State for Demo vs Live API Data
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [apiData, setApiData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [ratingVersion, setRatingVersion] = useState(0);
  const [liveUserId, setLiveUserId] = useState(null);

  // NEW: The Fetch Hook that triggers when Demo Mode is turned off
useEffect(() => {
    if (!isDemoMode) {
      let cancelled = false;

      const fetchLiveData = async () => {
        setIsLoading(true);
        setApiError(null);
        try {
          let userId = liveUserId;
          if (!userId) {
            const { user_ids } = await getSampleUsers(1);
            userId = user_ids[0];
            if (!cancelled) setLiveUserId(userId);
          }

          const { recommended_ids, scores } = await getRecommendations(userId, 20);
          const details = await Promise.all(
            recommended_ids.map((id) => getBeerDetails(id))
          );
          const beers = details.map((beer, i) => mapBeerToCard(beer, scores[i]));

          if (cancelled) return;
          setApiData({
            swimlanes: [
              { id: 'top-matches', title: 'Top Matches for You', beers: beers.slice(0, 10) },
              { id: 'also-like', title: 'You Might Also Like', beers: beers.slice(10) },
            ],
          });
        } catch (err) {
          if (cancelled) return;
          setApiError(err.message);
          setApiData(null);
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      };

      fetchLiveData();

      return () => { cancelled = true; };
    } else {
      setApiError(null);
      setIsLoading(false);
    }
  }, [isDemoMode, ratingVersion]);

  // Determine which data to feed the UI
  const activeData = isDemoMode ? data : apiData;

  const allUniqueBeers = useMemo(() => {
    if (!activeData || !activeData.swimlanes) return [];
    const allBeers = activeData.swimlanes.flatMap(lane => lane.beers);
    return Array.from(new Map(allBeers.map(b => [b.id, b])).values());
  }, [activeData]);

  const handleSubmitReview = async (beerId, rating, review) => {
    setUserRatings(prev => ({
      ...prev,
      [beerId]: { rating, review }
    }));

    if (!isDemoMode) {
      try {
        await submitRating(liveUserId, beerId, rating);
      } catch {
        // Non-critical — local state was already updated
      }

      // Optimistically remove the rated beer from swimlanes
      setApiData(prev => {
        if (!prev || !prev.swimlanes) return prev;
        return {
          ...prev,
          swimlanes: prev.swimlanes.map(lane => ({
            ...lane,
            beers: lane.beers.filter(b => b.id !== beerId),
          })),
        };
      });

      // Trigger a background re-fetch to get replacement recommendations
      setRatingVersion(v => v + 1);
    }
  };

  const toggleFavorite = (beerId) => {
    if (favorites.includes(beerId)) {
      setFavorites(favorites.filter(id => id !== beerId));
    } else {
      setFavorites([...favorites, beerId]);
    }
  };

  // If in demo mode but data is still loading from parent, show simple loader
  if (isDemoMode && (!data || !data.swimlanes)) return <div>Loading recommendations...</div>;

  return (
    <div style={{ backgroundColor: '#141414', minHeight: '100vh', paddingBottom: '4rem' }}>
      
      {/* Pass the toggle states to the Navbar */}
      <Navbar 
        onLogout={onLogout} 
        activeTab={activeTab}
        setActiveTab={setActiveTab} 
        isDemoMode={isDemoMode}
        setIsDemoMode={setIsDemoMode}
      />
      
      <div style={{ padding: '2rem 3rem' }}>
        
        {/* NEW: Loading State UI */}
        {!isDemoMode && isLoading && (
          <div className="empty-state">
            <h2>Waking up the Recommender Engine...</h2>
            <p>Connecting to Python Backend...</p>
          </div>
        )}

        {/* NEW: Error State UI */}
        {!isDemoMode && apiError && !isLoading && (
          <div className="empty-state">
            <h2>Connection Failed</h2>
            <p style={{ color: '#ff4d4d' }}>{apiError}</p>
            <button className="submit-review-btn" onClick={() => setIsDemoMode(true)} style={{ width: 'auto', marginTop: '1rem' }}>
              Revert to Demo Mode
            </button>
          </div>
        )}

        {/* ONLY Render the views if we aren't loading and don't have an error */}
        {(!isLoading && !apiError) && activeData && activeData.swimlanes && (
          <>
            {activeTab === 'home' && (
              activeData.swimlanes.map((lane) => (
                <Swimlane 
                  key={lane.id} 
                  title={lane.title} 
                  beers={lane.beers} 
                  onCardClick={(beer) => setSelectedBeer(beer)} 
                  favorites={favorites}
                  onToggleFav={toggleFavorite}
                />
              ))
            )}

            {activeTab === 'favorites' && (
              <FavoritesPage 
                allBeers={allUniqueBeers}
                favorites={favorites}
                onCardClick={(beer) => setSelectedBeer(beer)}
                onToggleFav={toggleFavorite}
              />
            )}
            
            {activeTab === 'discover' && (
              <DiscoverPage 
                allBeers={allUniqueBeers}
                favorites={favorites}
                onCardClick={(beer) => setSelectedBeer(beer)}
                onToggleFav={toggleFavorite}
              />
            )}
          </>
        )}

      </div>

      <BeerModal
        beer={selectedBeer}
        onClose={() => setSelectedBeer(null)}
        userRatingData={selectedBeer ? userRatings[selectedBeer.id] : null}
        onSubmitReview={handleSubmitReview}
        onCardClick={(beer) => setSelectedBeer(beer)}
      />
    </div>
  );
};

export default RecommenderDashboard;