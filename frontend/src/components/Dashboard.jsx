import React, { useState, useMemo } from 'react';
import './Dashboard.css';
import logo from '../assets/logo.png'; 

// 1. Updated Navbar with routing clicks
const Navbar = ({ onLogout, setActiveTab }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="navbar-left">
        {/* Clicking the logo takes you home */}
        <img 
          src={logo} 
          alt="RuBeer Logo" 
          className="nav-logo" 
          onClick={() => setActiveTab('home')}
        />
      </div>
      
      <div className="navbar-right">
        {/* Wiring up the Favorites button */}
        <button className="nav-link" onClick={() => setActiveTab('favorites')}>Favorites</button>
        <button className="nav-link">Discover</button>
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

// Modal Component (Unchanged)
const BeerModal = ({ beer, onClose }) => {
  if (!beer) return null;
  const matchPercentage = Math.round(beer.match_score * 100);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="close-button" onClick={onClose}>&times;</button>
        <img src={beer.image_url} alt={beer.name} className="modal-image" />
        <div className="modal-details">
          <div className="match-score" style={{ backgroundColor: '#E67E22', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '4px', display: 'inline-block', fontSize: '0.85rem', fontWeight: 'bold' }}>
            {matchPercentage}% Match
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
        </div>
      </div>
    </div>
  );
};

// BeerCard (Unchanged)
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
          <div className="match-score" style={{ color: '#E67E22', fontWeight: 'bold' }}>{matchPercentage}% Match</div>
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


// 3. Main Dashboard Component
const RecommenderDashboard = ({ data, onLogout }) => {
  const [selectedBeer, setSelectedBeer] = useState(null);
  const [favorites, setFavorites] = useState([]);
  
  // New state to control which page we are looking at
  const [activeTab, setActiveTab] = useState('home');

  // Helper to extract all unique beers from the swimlanes into one flat array
  const allUniqueBeers = useMemo(() => {
    if (!data || !data.swimlanes) return [];
    const allBeers = data.swimlanes.flatMap(lane => lane.beers);
    // Deduplicate them just in case the same beer is in multiple swimlanes
    return Array.from(new Map(allBeers.map(b => [b.id, b])).values());
  }, [data]);

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

      </div>

      <BeerModal beer={selectedBeer} onClose={() => setSelectedBeer(null)} />
    </div>
  );
};

export default RecommenderDashboard;