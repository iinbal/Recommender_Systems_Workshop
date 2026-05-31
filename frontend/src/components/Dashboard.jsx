import React, { useState, useMemo } from 'react';
import './Dashboard.css';
import logo from '../assets/logo.png'; 

// 1. Updated Navbar with routing clicks
const Navbar = ({ onLogout, setActiveTab }) => {
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
        <button className="nav-link" onClick={() => setActiveTab('favorites')}>Favorites</button>
        <button className="nav-link" onClick={() => setActiveTab('discover')}>Discover</button>
        <button className="nav-link">Shared With Me</button>
        
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

const BottleIcon = ({ filled, onMouseEnter, onMouseLeave, onClick }) => (
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

// --- UPDATED: Modal Component with Review System ---
const BeerModal = ({ beer, onClose, userRatingData, onSubmitReview }) => {
  if (!beer) return null;
  const matchPercentage = Math.round(beer.match_score * 100);
  
  // Local state for the interactive rating UI
  const [hoverRating, setHoverRating] = useState(0);
  const [rating, setRating] = useState(userRatingData?.rating || 0);
  const [review, setReview] = useState(userRatingData?.review || '');

  const handleSubmit = () => {
    onSubmitReview(beer.id, rating, review);
    onClose(); // Optional: Close modal after submitting
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="close-button" onClick={onClose}>&times;</button>
        <img src={beer.image_url} alt={beer.name} className="modal-image" />
        <div className="modal-details">
          
          <div className="card-header-row">
            <div className="match-score" style={{ backgroundColor: '#E67E22', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '4px', display: 'inline-block', fontSize: '0.85rem', fontWeight: 'bold' }}>
              {matchPercentage}% Match
            </div>
            {/* Show global rating at the top right of the modal */}
            <div className="card-rating">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#E67E22" stroke="#E67E22"><path d="M10 2v5l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-10l-2-3V2z"></path><path d="M10 2h4"></path></svg>
              {beer.rating || "New"}
            </div>
          </div>

          <h2>{beer.name}</h2>
          <div className="beer-meta">{beer.style} • {beer.abv}% ABV</div>
          <div className="modal-divider"></div>
          
          <h3>Why it's a match</h3>
          <p>Based on your preference profiles, this selection lines up beautifully with items you've highly rated.</p>
          
          <div className="flavor-tags">
            <span className="tag">Crisp</span>
            <span className="tag">Citrus</span>
            <span className="tag">Bitter</span>
          </div>

          {/* Interactive Rating Section */}
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
            />
            <button 
              className="submit-review-btn" 
              disabled={rating === 0}
              onClick={handleSubmit}
            >
              Save Rating
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

// --- UPDATED: BeerCard Component ---
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
          
          {/* New Header Row pushes Match Score left and Rating right */}
          <div className="card-header-row">
            <div className="match-score" style={{ color: '#E67E22', fontWeight: 'bold' }}>
              {matchPercentage}% Match
            </div>
            <div className="card-rating">
              {/* Using a tiny version of our SVG bottle here! */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#E67E22" stroke="#E67E22" strokeWidth="2"><path d="M10 2v5l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-10l-2-3V2z"></path><path d="M10 2h4"></path></svg>
              {beer.rating || "N/A"}
            </div>
          </div>

          <h3 className="beer-title">{beer.name}</h3>
          <div className="beer-meta">{beer.style} • {beer.abv}% ABV</div>
        </div>
      </div>
    </div>
  );
};

// Swimlane (Unchanged)
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

// 2. NEW: Favorites Page Component
const FavoritesPage = ({ allBeers, favorites, onCardClick, onToggleFav }) => {
  // Filter the full list of beers down to just the ones the user favorited
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

const DiscoverPage = ({ allBeers, favorites, onCardClick, onToggleFav }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  
  // 1. Define the "Ignore" boundaries. If a slider is at this value, we ignore it.
  const filterDefaults = { maxAbv: 20, maxDistance: 100, minRating: 0 };
  
  // 2. Draft State: What the sliders currently show
  const [draftFilters, setDraftFilters] = useState({ ...filterDefaults });
  
  // 3. Applied State: What is actively filtering the list
  const [appliedFilters, setAppliedFilters] = useState({});

  const dummyCategories = ["IPA", "Stout", "Lager", "Pilsner", "Ale", "Porter"];

  const handleTagClick = (category) => {
    if (activeTags.includes(category)) {
      setActiveTags(activeTags.filter(tag => tag !== category));
    } else {
      setActiveTags([...activeTags, category]);
    }
  };

  // Pushes draft values into the "Applied" state ONLY if they were moved
  const handleApplyFilters = () => {
    const newApplied = {};
    if (draftFilters.maxAbv < filterDefaults.maxAbv) newApplied.maxAbv = draftFilters.maxAbv;
    if (draftFilters.maxDistance < filterDefaults.maxDistance) newApplied.maxDistance = draftFilters.maxDistance;
    if (draftFilters.minRating > filterDefaults.minRating) newApplied.minRating = draftFilters.minRating;
    
    setAppliedFilters(newApplied);
    setShowFilters(false); // Auto-closes the panel for a cleaner UX
  };

  // Removes a specific bubble and resets its slider back to default
  const removeFilter = (key) => {
    const newApplied = { ...appliedFilters };
    delete newApplied[key];
    setAppliedFilters(newApplied);
    setDraftFilters({ ...draftFilters, [key]: filterDefaults[key] });
  };

  const filteredBeers = allBeers.filter((beer) => {
    const matchesSearch = 
      beer.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      beer.style.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTags = activeTags.length === 0 || 
      activeTags.some(tag => beer.style.toLowerCase().includes(tag.toLowerCase()));

    const beerAbv = beer.abv || 0;
    const beerDistance = beer.distance || 0; 
    const beerRating = beer.rating || 5; 

    // Only apply the check if the filter key actually exists in the appliedFilters object
    const matchesAbv = appliedFilters.maxAbv ? beerAbv <= appliedFilters.maxAbv : true;
    const matchesDistance = appliedFilters.maxDistance ? beerDistance <= appliedFilters.maxDistance : true;
    const matchesRating = appliedFilters.minRating ? beerRating >= appliedFilters.minRating : true;

    return matchesSearch && matchesTags && matchesAbv && matchesDistance && matchesRating;
  });

  return (
    <div>
      <h2 className="page-title">Discover</h2>
      
      <div className="search-container">
        <input 
          type="text" 
          className="search-input" 
          placeholder="Search for a beer name or style..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        
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

        {/* The Gray Filter Bubbles */}
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
  
  // New state to control which page we are looking at
  const [activeTab, setActiveTab] = useState('home');

  // Helper to extract all unique beers from the swimlanes into one flat array
  const allUniqueBeers = useMemo(() => {
    if (!data || !data.swimlanes) return [];
    const allBeers = data.swimlanes.flatMap(lane => lane.beers);
    // Deduplicate them just in case the same beer is in multiple swimlanes
    return Array.from(new Map(allBeers.map(b => [b.id, b])).values());
  }, [data]);

  const handleSubmitReview = (beerId, rating, review) => {
  setUserRatings(prev => ({
    ...prev,
    [beerId]: { rating, review }
  }));
};

  const toggleFavorite = (beerId) => {
    if (favorites.includes(beerId)) {
      setFavorites(favorites.filter(id => id !== beerId));
    } else {
      setFavorites([...favorites, beerId]);
    }
  };

  if (!data || !data.swimlanes) return <div>Loading recommendations...</div>;

  return (
    <div style={{ backgroundColor: '#141414', minHeight: '100vh', paddingBottom: '4rem' }}>
      {/* Pass the setActiveTab function to the Navbar */}
      <Navbar onLogout={onLogout} setActiveTab={setActiveTab} />
      
      <div style={{ padding: '2rem 3rem' }}>
        
        {/* Conditional Rendering: Show Home OR Favorites based on state */}
        {activeTab === 'home' && (
          data.swimlanes.map((lane) => (
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

      </div>

      <BeerModal 
  beer={selectedBeer} 
  onClose={() => setSelectedBeer(null)} 
  userRatingData={selectedBeer ? userRatings[selectedBeer.id] : null}
  onSubmitReview={handleSubmitReview}
/>
    </div>
  );
};

export default RecommenderDashboard;