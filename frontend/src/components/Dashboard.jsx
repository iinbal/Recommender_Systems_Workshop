import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import './Dashboard.css';
import logo from '../assets/logo.png';
import { getRecommendations, getBeerDetails, getSimilarBeers, submitRating, getSampleUsers, getTopBeers, getAdventurousRecommendations, getAntiRecommendations } from '../services/apiService';
import { getBeerImage, DEFAULT_BEER_IMAGE } from '../utils/beerImages';
import NewUserBanner from './NewUserBanner';
import UserProfilePage from './UserProfilePage';
import SharedWithMePage from './SharedWithMePage';
import { saveRating as persistRating, getUserRecord, getRegisteredUsers, shareBeerWithUser } from '../services/authService';

const SCALED_MIN = 0.70;
const SCALED_MAX = 0.97;

const scaleScores = (scores) => {
  if (!scores || scores.length === 0) return scores;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => (SCALED_MIN + SCALED_MAX) / 2);
  return scores.map(s => SCALED_MIN + ((s - min) / (max - min)) * (SCALED_MAX - SCALED_MIN));
};

// Maps a /beers/{id} response (plus an optional match score) into the shape
// the existing card/modal UI expects.
const mapBeerToCard = (beer, score) => ({
  id: beer.beer_id,
  name: beer.beer_name,
  style: beer.beer_style,
  abv: beer.beer_abv,
  match_score: typeof score === 'number' ? score : 0,
  rating: beer.avg_overall_rating,
  image_url: getBeerImage(beer.beer_style, beer.beer_id),
});

const GroupSwitcher = ({ partyMembers, onApplyMembers, friendDatabase }) => {
  const [draftMembers, setDraftMembers] = useState(partyMembers);

  return (
    <div style={{ backgroundColor: '#222', padding: '0.6rem 1.2rem', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '0.8rem', border: '1px solid #333' }}>
      <span style={{ color: '#aaa', fontSize: '0.9rem' }}>Matching for:</span>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        {draftMembers.map(m => (
          <span key={m} style={{ backgroundColor: '#E67E22', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '15px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            {m}
            {m !== 'Me' && <button onClick={() => setDraftMembers(draftMembers.filter(p => p !== m))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}>&times;</button>}
          </span>
        ))}
      </div>
      <select 
        onChange={(e) => { if(e.target.value && !draftMembers.includes(e.target.value)) setDraftMembers([...draftMembers, e.target.value]); e.target.value = ''; }}
        style={{ background: 'none', border: 'none', color: '#E67E22', fontWeight: 'bold', cursor: 'pointer', outline: 'none' }}
      >
        <option value="">+ Add</option>
        {friendDatabase.filter(f => !draftMembers.includes(f)).map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      <button 
        onClick={() => onApplyMembers(draftMembers)}
        style={{ backgroundColor: '#fff', color: '#000', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '15px', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer' }}
      >
        Apply
      </button>
    </div>
  );
};

// 1. Updated Navbar with toggle
const Navbar = ({ onLogout, activeTab, setActiveTab, unreadShareCount = 0 }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDiscoverMenu, setShowDiscoverMenu] = useState(false);

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
        
        {/* 1. Discover */}
        <div 
          className="nav-item dropdown-container"
          onMouseEnter={() => setShowDiscoverMenu(true)}
          onMouseLeave={() => setShowDiscoverMenu(false)}
          style={{ position: 'relative', display: 'inline-block' }}
        >
          <button 
            className={`nav-link ${['discover', 'beer-lists', 'build-six-pack', 'anti-recommender', 'top50', 'adventurous'].includes(activeTab) ? 'active' : ''}`}
            onClick={() => setActiveTab('discover')}
          >
            Discover
          </button>

          {showDiscoverMenu && (
            <div 
              style={{ 
                position: 'absolute', 
                top: '100%', 
                left: '-20px', 
                backgroundColor: '#1a1a1a', 
                border: '1px solid #333', 
                borderRadius: '6px', 
                padding: '0.5rem 0',
                minWidth: '180px',
                zIndex: 1000,
                boxShadow: '0 8px 16px rgba(0,0,0,0.8)'
              }}
            >
              <div className="dropdown-item" style={{ fontWeight: 'bold' }} onClick={() => { setActiveTab('discover'); setShowDiscoverMenu(false); }}>
                Explore
              </div>
              <div className="dropdown-item" style={{ fontWeight: 'bold' }} onClick={() => { setActiveTab('beer-lists'); setShowDiscoverMenu(false); }}>
                Beer Lists
              </div>
              <div className="dropdown-item" style={{ fontWeight: 'bold' }} onClick={() => { setActiveTab('build-six-pack'); setShowDiscoverMenu(false); }}>
                Build a 6-Pack
              </div>
            </div>
          )}
        </div>

        {/* 2. Favorites */}
        <button className={`nav-link ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setActiveTab('favorites')}>Favorites</button>
        
        {/* 3. Shared With Me */}
        <button
          className={`nav-link ${activeTab === 'shared-with-me' ? 'active' : ''}`}
          onClick={() => setActiveTab('shared-with-me')}
          style={{ position: 'relative' }}
        >
          Shared With Me
          {unreadShareCount > 0 && (
            <span style={{
              position: 'absolute', top: '-4px', right: '-10px',
              backgroundColor: '#E67E22', color: '#fff',
              fontSize: '0.65rem', fontWeight: 'bold',
              width: '16px', height: '16px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {unreadShareCount > 9 ? '9+' : unreadShareCount}
            </span>
          )}
        </button>

        {/* Profile Hamburger Menu */}
        <div className="profile-menu-container">
          <button className="hamburger-menu" onClick={() => setDropdownOpen(!dropdownOpen)}>
            <span></span>
            <span></span>
            <span></span>
          </button>
          
          {dropdownOpen && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={() => { setActiveTab('home'); setDropdownOpen(false); }}>Home</button>
              <button className="dropdown-item" onClick={() => { setActiveTab('profile'); setDropdownOpen(false); }}>Profile</button>
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
const BeerModal = ({ beer, onClose, userRatingData, onSubmitReview, onCardClick, userId, onShareSent }) => {
  const [hoverRating, setHoverRating] = useState(0);
  const [rating, setRating] = useState(userRatingData?.rating || 0);
  const [review, setReview] = useState(userRatingData?.review || '');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareRecipient, setShareRecipient] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [shareStatus, setShareStatus] = useState(null); // null | 'sent' | 'error'
  const registeredUsers = userId ? getRegisteredUsers(userId) : [];
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

  const handleShare = () => {
    if (!shareRecipient) return;
    const result = shareBeerWithUser(shareRecipient, {
      id: crypto.randomUUID(),
      beerId: beer.id,
      beerName: beer.name,
      beerStyle: beer.style,
      beerAbv: beer.abv,
      beerImage: beer.image_url,
      sharedByEmail: userId,
      sharedByName: getUserRecord(userId)?.username || userId,
      note: shareNote.trim(),
      sharedAt: Date.now(),
      seen: false,
    });
    if (result.success) {
      setShareStatus('sent');
      setShareNote('');
      setShareRecipient('');
      onShareSent?.();
    } else {
      setShareStatus('error');
    }
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

          {/* Share toggle */}
          {userId && registeredUsers.length > 0 && (
            <div style={{ marginTop: '0.6rem' }}>
              <button
                onClick={() => { setShareOpen(o => !o); setShareStatus(null); }}
                style={{ background: 'none', border: 'none', color: '#E67E22', fontSize: '0.85rem', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}
              >
                {shareOpen ? '✕ Cancel' : '↗ Share this beer'}
              </button>

              {shareOpen && (
                <div style={{ marginTop: '0.6rem', backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <select
                    value={shareRecipient}
                    onChange={(e) => { setShareRecipient(e.target.value); setShareStatus(null); }}
                    style={{ backgroundColor: '#141414', border: '1px solid #333', borderRadius: '6px', color: shareRecipient ? '#fff' : '#888', padding: '0.5rem 0.6rem', fontSize: '0.88rem' }}
                  >
                    <option value="">Select a friend…</option>
                    {registeredUsers.map((u) => (
                      <option key={u.email} value={u.email}>{u.username}</option>
                    ))}
                  </select>
                  <textarea
                    placeholder="Add a note (optional)"
                    value={shareNote}
                    onChange={(e) => setShareNote(e.target.value.slice(0, 200))}
                    maxLength={200}
                    rows={2}
                    style={{ backgroundColor: '#141414', border: '1px solid #333', borderRadius: '6px', color: '#fff', padding: '0.5rem 0.6rem', fontSize: '0.88rem', resize: 'none', outline: 'none' }}
                  />
                  {shareStatus === 'sent' && <p style={{ margin: 0, color: '#2ecc71', fontSize: '0.82rem' }}>Sent!</p>}
                  {shareStatus === 'error' && <p style={{ margin: 0, color: '#e74c3c', fontSize: '0.82rem' }}>Could not send — user not found.</p>}
                  <button
                    onClick={handleShare}
                    disabled={!shareRecipient}
                    style={{ backgroundColor: shareRecipient ? '#E67E22' : '#333', color: shareRecipient ? '#fff' : '#666', border: 'none', borderRadius: '6px', padding: '0.5rem 1.2rem', fontWeight: 'bold', fontSize: '0.88rem', cursor: shareRecipient ? 'pointer' : 'not-allowed', alignSelf: 'flex-start' }}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

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
        <img
          src={beer.image_url}
          alt={beer.name}
          className="beer-image"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = DEFAULT_BEER_IMAGE; }}
        />
        <div className="beer-info">
          
          <div className="card-header-row">
            <div className="match-score" style={{ color: '#E67E22', fontWeight: 'bold' }}>
              {beer.rank ? `#${beer.rank}` : `${matchPercentage}% Match`}
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

const ListCard = ({ id, title, beers = [], icon, isAddButton, isCustom, onAdd, onSelect, onDelete }) => (
  <div
    className={isAddButton ? undefined : 'curated-card'}
    style={isAddButton ? {
      backgroundColor: '#1a1a1a',
      border: '2px dashed #666',
      borderRadius: '16px',
      padding: '1.8rem',
      minHeight: '180px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
      transition: 'transform 0.25s ease, border-color 0.25s ease',
    } : undefined}
    onMouseEnter={isAddButton ? (e) => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.borderColor = '#E67E22'; } : undefined}
    onMouseLeave={isAddButton ? (e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = '#666'; } : undefined}
    onClick={() => {
      if (isAddButton) onAdd();
      else onSelect(id);
    }}
  >
    {isCustom && !isAddButton && (
      <button
        onClick={(e) => onDelete(id, e)}
        style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: '#ff4d4d', fontSize: '1.2rem', cursor: 'pointer', opacity: 0.7 }}
        title="Delete List"
      >
        ✖
      </button>
    )}

    {isAddButton ? (
      <>
        <div style={{ fontSize: '3rem', color: '#666', marginTop: '1rem' }}>+</div>
        <h3 style={{ color: '#666', margin: 0, marginTop: 'auto' }}>Create New List</h3>
      </>
    ) : (
      <>
        <div className="curated-icon">{icon}</div>
        <div>
          <h3 className="curated-title">{title}</h3>
          <span className="curated-subtitle">{beers.length} Beers</span>
        </div>
      </>
    )}
  </div>
);

// --- UPDATED: Beer Lists Page Component ---
const BeerListsPage = ({ allBeers = [], onNavigate }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListSection, setNewListSection] = useState('');
  const [showSectionDropdown, setShowSectionDropdown] = useState(false);

  // NEW: State for the Delete Confirmation Modal
  const [listToDelete, setListToDelete] = useState(null);

  const [activeList, setActiveList] = useState(null); 
  const [showAddBeerModal, setShowAddBeerModal] = useState(false);
  const [beerSearchQuery, setBeerSearchQuery] = useState('');

  const [existingSections, setExistingSections] = useState([
    "Hoppy & Bitter", "BBQ Pairings", "Winter Stouts", "Gifts for Friends"
  ]);

  const [myLists, setMyLists] = useState([
    { id: 'm1', title: "My Favorite IPAs", beers: [], icon: '⭐', color: '#333333', section: 'Hoppy & Bitter' },
    { id: 'm2', title: "BBQ Weekend", beers: [], icon: '🍔', color: '#333333', section: 'BBQ Pairings' }
  ]);

  // --- ACTIONS ---

  const handleCreateSubmit = () => {
    if (!newListName.trim()) return;
    const finalSection = newListSection.trim() || "Uncategorized";
    if (!existingSections.includes(finalSection)) setExistingSections([...existingSections, finalSection]);

    const newList = {
      id: `m-${Date.now()}`,
      title: newListName.trim(),
      beers: [], 
      icon: '🍻',
      color: '#333333',
      section: finalSection
    };

    setMyLists([...myLists, newList]);
    setIsModalOpen(false);
    setNewListName('');
    setNewListSection('');
  };

  // 1. Triggers the warning popup instead of instant deletion
  const handleDeleteClick = (listId, e) => {
    e.stopPropagation(); 
    setListToDelete(listId);
  };

  // 2. Executes the actual deletion and section cleanup
  const confirmDeleteList = () => {
    if (!listToDelete) return;

    // Find the list we are about to delete to check its section
    const listToRemove = myLists.find(l => l.id === listToDelete);
    const updatedLists = myLists.filter(list => list.id !== listToDelete);
    
    setMyLists(updatedLists);
    if (activeList?.id === listToDelete) setActiveList(null);

    // FEATURE: Auto-Cleanup the Section Dropdown
    if (listToRemove && listToRemove.section) {
      // Check if any *remaining* lists still use this section
      const sectionStillInUse = updatedLists.some(l => l.section === listToRemove.section);
      if (!sectionStillInUse) {
        // If not, remove it from the dropdown options!
        setExistingSections(prev => prev.filter(s => s !== listToRemove.section));
      }
    }

    setListToDelete(null); // Close the warning modal
  };

  const handleAddBeerToList = (beer) => {
    const updatedLists = myLists.map(l => {
      if (l.id === activeList.id && !l.beers.includes(beer.id)) {
        return { ...l, beers: [...l.beers, beer.id] };
      }
      return l;
    });
    setMyLists(updatedLists);
    setActiveList({ ...activeList, beers: [...activeList.beers, beer.id] });
  };

  const handleRemoveBeerFromList = (beerId) => {
    const updatedLists = myLists.map(l => {
      if (l.id === activeList.id) {
        return { ...l, beers: l.beers.filter(id => id !== beerId) };
      }
      return l;
    });
    setMyLists(updatedLists);
    setActiveList({ ...activeList, beers: activeList.beers.filter(id => id !== beerId) });
  };

  // --- RENDER LOGIC ---

  if (activeList) {
    const listBeers = allBeers.filter(b => activeList.beers.includes(b.id));
    const availableBeersToAdd = allBeers.filter(b => !activeList.beers.includes(b.id) && b.name.toLowerCase().includes(beerSearchQuery.toLowerCase()));

    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <button onClick={() => setActiveList(null)} style={{ background: 'none', border: 'none', color: '#E67E22', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem', fontWeight: 'bold' }}>
          ← Back to Lists
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginBottom: '3rem', background: 'linear-gradient(180deg, #333333 0%, #141414 100%)', padding: '2rem', borderRadius: '12px' }}>
          <div style={{ fontSize: '5rem', backgroundColor: activeList.color, width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
            {activeList.icon}
          </div>
          <div>
            <span style={{ textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '2px', color: '#aaa' }}>{activeList.section || 'Playlist'}</span>
            <h1 style={{ fontSize: '3.5rem', margin: '0.5rem 0', color: '#fff' }}>{activeList.title}</h1>
            <p style={{ color: '#ccc', margin: 0 }}>{activeList.beers.length} beers in this list</p>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <button 
            onClick={() => setShowAddBeerModal(true)}
            style={{ backgroundColor: '#E67E22', color: '#fff', border: 'none', padding: '0.8rem 2rem', borderRadius: '30px', fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 12px rgba(230, 126, 34, 0.3)' }}
          >
            + Add Beers
          </button>
        </div>

        {listBeers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
            <h3>This list is empty.</h3>
            <p>Click "Add Beers" above to start building your collection.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {listBeers.map((beer, index) => (
              <div key={beer.id} style={{ display: 'flex', alignItems: 'center', padding: '1rem', backgroundColor: '#1a1a1a', borderRadius: '8px', border: '1px solid #333' }}>
                <span style={{ color: '#666', width: '30px', fontWeight: 'bold' }}>{index + 1}</span>
                <img src={beer.image_url} alt={beer.name} style={{ width: '40px', height: '40px', borderRadius: '4px', marginRight: '1rem', objectFit: 'cover' }} />
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, color: '#fff' }}>{beer.name}</h4>
                  <span style={{ color: '#888', fontSize: '0.9rem' }}>{beer.style} • {beer.abv}%</span>
                </div>
                <button 
                  onClick={() => handleRemoveBeerFromList(beer.id)}
                  style={{ background: 'none', border: '1px solid #666', color: '#aaa', padding: '0.4rem 1rem', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={(e) => { e.target.style.borderColor = '#ff4d4d'; e.target.style.color = '#ff4d4d'; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = '#666'; e.target.style.color = '#aaa'; }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {showAddBeerModal && (
          <div className="modal-backdrop" onClick={() => setShowAddBeerModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ backgroundColor: '#1a1a1a', border: '1px solid #333', padding: '2rem', width: '90%', maxWidth: '500px', borderRadius: '12px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, color: '#fff' }}>Add to {activeList.title}</h2>
                <button onClick={() => setShowAddBeerModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>✖</button>
              </div>
              <input 
                type="text" 
                placeholder="Search database..." 
                value={beerSearchQuery}
                onChange={e => setBeerSearchQuery(e.target.value)}
                style={{ padding: '0.8rem', borderRadius: '6px', border: 'none', marginBottom: '1rem', width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ overflowY: 'auto', flex: 1, display: 'grid', gap: '0.5rem' }}>
                {availableBeersToAdd.map(beer => (
                  <div key={beer.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', backgroundColor: '#222', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <img src={beer.image_url} alt={beer.name} style={{ width: '30px', height: '30px', borderRadius: '4px' }} />
                      <span style={{ color: '#fff', fontSize: '0.9rem' }}>{beer.name}</span>
                    </div>
                    <button onClick={() => handleAddBeerToList(beer)} style={{ backgroundColor: '#E67E22', border: 'none', color: '#fff', padding: '0.3rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                      Add
                    </button>
                  </div>
                ))}
                {availableBeersToAdd.length === 0 && <p style={{ color: '#666', textAlign: 'center' }}>No beers found.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <h2 className="page-title">Beer Lists</h2>
      
      <div style={{ marginBottom: '3rem' }}>
        <h3 style={{ color: '#E67E22', borderBottom: '1px solid #333', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Curated by RuBeer</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1.5rem' }}>
          <div className="curated-card curated-dark" onClick={() => onNavigate && onNavigate('anti-recommender')}>
            <div className="curated-icon">&#9888;</div>
            <div>
              <h3 className="curated-title">Anti-Recommender List</h3>
              <span className="curated-subtitle">Beers you should avoid</span>
            </div>
          </div>
          <div className="curated-card curated-gold" onClick={() => onNavigate && onNavigate('top50')}>
            <div className="curated-icon">&#127942;</div>
            <div>
              <h3 className="curated-title">Top 50 Rated All-Time</h3>
              <span className="curated-subtitle">Highest rated beers overall</span>
            </div>
          </div>
          <div className="curated-card curated-blue" onClick={() => onNavigate && onNavigate('adventurous')}>
            <div className="curated-icon">&#127757;</div>
            <div>
              <h3 className="curated-title">Feeling Adventurous?</h3>
              <span className="curated-subtitle">Step outside your comfort zone</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ color: '#E67E22', borderBottom: '1px solid #333', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>My Custom Lists</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1.5rem' }}>
          {myLists.map(list => (
            <ListCard
              key={list.id}
              {...list}
              isCustom={true}
              onAdd={() => setIsModalOpen(true)}
              onSelect={(id) => setActiveList(myLists.find(l => l.id === id))}
              onDelete={handleDeleteClick}
            />
          ))}
          <ListCard
            isAddButton={true}
            onAdd={() => setIsModalOpen(true)}
            onSelect={() => {}}
            onDelete={() => {}}
          />
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#1a1a1a', border: '2px solid #E67E22', padding: '2rem', maxWidth: '400px', width: '90%', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '1.5rem', boxSizing: 'border-box', overflow: 'visible' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#E67E22', fontSize: '1.5rem' }}>Create New List</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: '#E67E22', fontSize: '2rem', cursor: 'pointer', lineHeight: 1, padding: 0 }}>&times;</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ marginBottom: '0.5rem', fontWeight: 'bold', color: '#E67E22' }}>List Name:</label>
              <input type="text" value={newListName} onChange={(e) => setNewListName(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: 'none', outline: 'none', backgroundColor: '#fff', color: '#000', fontSize: '1rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ marginBottom: '0.5rem', fontWeight: 'bold', color: '#E67E22' }}>Section:</label>
              <div style={{ position: 'relative', width: '100%' }}>
                <input type="text" value={newListSection} onChange={(e) => setNewListSection(e.target.value)} onFocus={() => setShowSectionDropdown(true)} onBlur={() => setShowSectionDropdown(false)} placeholder="Type or select ->" style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: 'none', outline: 'none', backgroundColor: '#fff', color: '#000', fontSize: '1rem', boxSizing: 'border-box' }} />
                {showSectionDropdown && (
                  <div style={{ position: 'absolute', top: '0', left: 'calc(100% + 15px)', width: '200px', backgroundColor: '#2a2a2a', border: '1px solid #E67E22', borderRadius: '6px', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                    {existingSections.map((section, idx) => (
                      <div key={idx} onMouseDown={(e) => { e.preventDefault(); setNewListSection(section); setShowSectionDropdown(false); }} style={{ padding: '0.8rem 1rem', color: '#fff', cursor: 'pointer', borderBottom: idx === existingSections.length - 1 ? 'none' : '1px solid #444', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.target.style.backgroundColor = '#E67E22'} onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}>{section}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button onClick={handleCreateSubmit} disabled={!newListName.trim()} style={{ width: '100%', padding: '1rem', border: 'none', borderRadius: '6px', backgroundColor: newListName.trim() ? '#E67E22' : '#333', color: newListName.trim() ? '#fff' : '#666', fontWeight: 'bold', fontSize: '1.1rem', cursor: newListName.trim() ? 'pointer' : 'not-allowed', transition: 'background-color 0.2s', marginTop: '0.5rem', boxSizing: 'border-box' }}>Save List</button>
          </div>
        </div>
      )}

      {/* NEW: Safe Delete Confirmation Modal */}
      {listToDelete && (
        <div className="modal-backdrop" onClick={() => setListToDelete(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ backgroundColor: '#1a1a1a', border: '1px solid #ff4d4d', padding: '2rem', width: '90%', maxWidth: '400px', borderRadius: '12px', textAlign: 'center' }}>
            <h2 style={{ color: '#fff', marginTop: 0 }}>Delete this list?</h2>
            <p style={{ color: '#aaa', marginBottom: '2rem' }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button onClick={() => setListToDelete(null)} style={{ padding: '0.8rem 1.5rem', borderRadius: '6px', border: '1px solid #666', background: 'transparent', color: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmDeleteList} style={{ padding: '0.8rem 1.5rem', borderRadius: '6px', border: 'none', backgroundColor: '#ff4d4d', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- NEW: Build a 6-Pack Page Component ---
const BuildSixPackPage = ({ allBeers = [], onCardClick }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPack, setGeneratedPack] = useState(null);
  
  const [packCount, setPackCount] = useState(1);
  const [partyMembers, setPartyMembers] = useState(['Me']);
  const [selectedFriend, setSelectedFriend] = useState('');
  
  const friendDatabase = ["Alex (Lager Lover)", "Sarah (Hops Fanatic)", "David (Stout Guy)", "Emily (Sour Queen)"];

  const fallbackBeers = [
    { id: 'f1', name: 'Cosmic IPA',     style: 'IPA',       abv: 6.5, image_url: getBeerImage('IPA', 'f1') },
    { id: 'f2', name: 'Midnight Stout', style: 'Stout',     abv: 8.0, image_url: getBeerImage('Stout', 'f2') },
    { id: 'f3', name: 'Sunny Pilsner',  style: 'Pilsner',   abv: 5.0, image_url: getBeerImage('Pilsner', 'f3') },
    { id: 'f4', name: 'Hazy Horizon',   style: 'NEIPA',     abv: 7.2, image_url: getBeerImage('NEIPA', 'f4') },
    { id: 'f5', name: 'Amber Echo',     style: 'Amber Ale', abv: 5.5, image_url: getBeerImage('Amber Ale', 'f5') },
    { id: 'f6', name: 'Crisp Cider',    style: 'Cider',     abv: 4.5, image_url: getBeerImage('Cider', 'f6') },
  ];

  const handleAddFriend = (e) => {
    const friend = e.target.value;
    if (friend && !partyMembers.includes(friend)) {
      setPartyMembers([...partyMembers, friend]);
    }
    setSelectedFriend('');
  };

  const removeFriend = (friendToRemove) => {
    if (friendToRemove === 'Me') return; 
    setPartyMembers(partyMembers.filter(f => f !== friendToRemove));
  };

  const handleGenerate = () => {
    setGeneratedPack(null);
    setIsGenerating(true);

    setTimeout(() => {
      const totalBeersNeeded = packCount * 6;
      let sourceBeers = allBeers.length > 5 ? [...allBeers] : [...fallbackBeers];
      
      while (sourceBeers.length < totalBeersNeeded) {
        sourceBeers = [...sourceBeers, ...sourceBeers];
      }

      const shuffled = sourceBeers.sort(() => 0.5 - Math.random());
      const selectedBeers = shuffled.slice(0, totalBeersNeeded);
      
      setGeneratedPack(selectedBeers);
      setIsGenerating(false);
    }, 1500);
  };

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes dropIn {
          0% { transform: translateY(-100px); opacity: 0; }
          60% { transform: translateY(10px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(230, 126, 34, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(230, 126, 34, 0); }
          100% { box-shadow: 0 0 0 0 rgba(230, 126, 34, 0); }
        }
        .bottle-slot {
          opacity: 0;
          animation: dropIn 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          transition: transform 0.2s ease;
        }
        .bottle-slot:hover {
          transform: scale(1.05);
        }
      `}</style>

      <div style={{ marginBottom: '2rem' }}>
        <h2 className="page-title" style={{ marginBottom: '0.2rem' }}>Build a 6-Pack</h2>
        <p style={{ fontStyle: 'italic', color: '#888', margin: 0, fontSize: '1.2rem' }}>
          "Abs are made in the Gym, but these 6-packs are generated by algorithms."
        </p>
      </div>

      <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        
        <div style={{ flex: '1 1 60%', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {Array.from({ length: packCount }).map((_, packIndex) => (
            <div key={packIndex} style={{ 
              backgroundColor: '#1a1a1a', 
              borderRadius: '12px', 
              padding: '2rem', 
              border: '2px solid #333',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column'
            }}>
              
              {packCount > 1 && (
                <h3 style={{ margin: '0 0 1.5rem 0', color: '#fff', fontSize: '1.2rem', textAlign: 'center' }}>
                  6-Pack #{packIndex + 1}
                </h3>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', position: 'relative', flex: 1 }}>
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '4px', backgroundColor: '#333', zIndex: 0 }}></div>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '33.3%', width: '4px', backgroundColor: '#333', zIndex: 0 }}></div>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '66.6%', width: '4px', backgroundColor: '#333', zIndex: 0 }}></div>

                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const absoluteIndex = (packIndex * 6) + index;
                  const beer = generatedPack ? generatedPack[absoluteIndex] : null;
                  
                  return (
                    <div key={index} style={{ backgroundColor: '#222', borderRadius: '8px', height: '180px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1, border: '1px solid #444', overflow: 'hidden', position: 'relative' }}>
                      {isGenerating && (
                        <div style={{ color: '#E67E22', animation: 'pulseGlow 1.5s infinite', borderRadius: '50%', width: '30px', height: '30px', border: '2px solid #E67E22', borderTopColor: 'transparent' }} className="spinner"></div>
                      )}
                      
                      {beer && !isGenerating && (
                        <div 
                          className="bottle-slot" 
                          onClick={() => onCardClick(beer)} // <-- Triggers the modal!
                          style={{ animationDelay: `${absoluteIndex * 0.1}s`, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                        >
                          <img src={beer.image_url} alt={beer.name} style={{ width: '100%', height: '110px', objectFit: 'cover' }} />
                          <div style={{ padding: '0.5rem', textAlign: 'center', backgroundColor: '#111', flex: 1 }}>
                            <h4 style={{ margin: 0, fontSize: '0.8rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{beer.name}</h4>
                            <span style={{ fontSize: '0.7rem', color: '#E67E22' }}>{beer.style}</span>
                          </div>
                        </div>
                      )}
                      
                      {!beer && !isGenerating && (
                        <span style={{ color: '#444', fontSize: '2rem', fontWeight: 'bold' }}>{index + 1}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {generatedPack && !isGenerating && (
            <div style={{ backgroundColor: '#222', padding: '1.5rem', borderRadius: '8px', borderLeft: '4px solid #E67E22', animation: 'dropIn 0.5s ease forwards', animationDelay: '1s', opacity: 0 }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.2rem' }}>Algorithm Report</h4>
              <p style={{ margin: 0, fontSize: '1rem', color: '#aaa' }}>
                Blended profiles for <strong style={{ color: '#fff' }}>{partyMembers.join(' & ')}</strong>. 
                Result leans heavily towards {generatedPack[0]?.style}s and {generatedPack[1]?.style}s based on overlapping high-rated preferences. 
                {packCount > 1 && ` Expanded to ${packCount * 6} unique recommendations for the group.`}
              </p>
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                <button style={{ backgroundColor: '#E67E22', color: '#fff', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Save to My Lists</button>
                <button style={{ backgroundColor: 'transparent', color: '#E67E22', border: '1px solid #E67E22', padding: '0.8rem 1.5rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Order Delivery</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 30%', minWidth: '250px', position: 'sticky', top: '20px' }}>
          <div style={{ backgroundColor: '#1a1a1a', padding: '2rem', borderRadius: '12px', border: '1px solid #333' }}>
            <h3 style={{ margin: '0 0 1.5rem 0', color: '#E67E22', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Algorithm Tuning
            </h3>

            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', color: '#fff', fontWeight: 'bold', marginBottom: '0.8rem' }}>Who is drinking?</label>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {partyMembers.map(member => (
                  <span key={member} style={{ backgroundColor: '#333', color: '#fff', padding: '0.4rem 0.8rem', borderRadius: '20px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {member}
                    {member !== 'Me' && (
                      <button onClick={() => removeFriend(member)} style={{ background: 'none', border: 'none', color: '#ff4d4d', cursor: 'pointer', padding: 0 }}>✖</button>
                    )}
                  </span>
                ))}
              </div>

              <select 
                value={selectedFriend} 
                onChange={handleAddFriend}
                style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: '1px solid #444', backgroundColor: '#222', color: '#fff', outline: 'none' }}
              >
                <option value="">+ Add a friend to blend profiles...</option>
                {friendDatabase.map(friend => (
                  <option key={friend} value={friend} disabled={partyMembers.includes(friend)}>{friend}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '2.5rem' }}>
              <label style={{ display: 'block', color: '#fff', fontWeight: 'bold', marginBottom: '0.8rem' }}>How many 6-Packs?</label>
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#222', borderRadius: '6px', border: '1px solid #444', width: 'fit-content' }}>
                <button onClick={() => setPackCount(Math.max(1, packCount - 1))} style={{ background: 'none', border: 'none', color: '#fff', padding: '0.8rem 1.2rem', cursor: 'pointer', fontSize: '1.2rem' }}>-</button>
                <span style={{ color: '#fff', padding: '0 1.5rem', fontWeight: 'bold', fontSize: '1.2rem' }}>{packCount}</span>
                <button onClick={() => setPackCount(Math.min(10, packCount + 1))} style={{ background: 'none', border: 'none', color: '#fff', padding: '0.8rem 1.2rem', cursor: 'pointer', fontSize: '1.2rem' }}>+</button>
              </div>
            </div>

            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{ 
                width: '100%', 
                padding: '1.2rem', 
                backgroundColor: isGenerating ? '#333' : '#E67E22', 
                color: isGenerating ? '#888' : '#fff', 
                border: 'none', 
                borderRadius: '8px', 
                fontWeight: 'bold', 
                fontSize: '1.2rem', 
                cursor: isGenerating ? 'wait' : 'pointer',
                transition: 'background-color 0.2s',
                animation: isGenerating ? 'pulseGlow 1.5s infinite' : 'none'
              }}
            >
              {isGenerating ? 'Crunching Preferences...' : 'Generate Selection'}
            </button>
          </div>
        </div>
        
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

  const ALL_CATEGORIES = ["IPA", "Stout", "Lager", "Pilsner", "Ale", "Porter"];

  // Maps each UI tag to the substrings that can appear in real dataset style names.
  // "IPA" must cover "India Pale Ale" because that's how the BeerAdvocate dataset
  // labels most IPA beers — "india pale ale".includes("ipa") is false.
  const STYLE_PATTERNS = {
    IPA:     ['ipa', 'india pale ale', 'imperial pale ale'],
    Stout:   ['stout'],
    Lager:   ['lager'],
    Pilsner: ['pilsner', 'pils'],
    Ale:     ['ale'],
    Porter:  ['porter'],
  };

  // Only show tags that actually have matching beers in the current pool.
  const availableCategories = ALL_CATEGORIES.filter(tag => {
    const patterns = STYLE_PATTERNS[tag] || [tag.toLowerCase()];
    return allBeers.some(beer => {
      const style = (beer.style || '').toLowerCase();
      return patterns.some(p => style.includes(p));
    });
  });

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
    const style = (beer.style || '').toLowerCase();
    const matchesSearch = beer.name.toLowerCase().includes(appliedSearch.toLowerCase()) ||
                          style.includes(appliedSearch.toLowerCase());

    const matchesTags = activeTags.length === 0 ||
      activeTags.some(tag => {
        const patterns = STYLE_PATTERNS[tag] || [tag.toLowerCase()];
        return patterns.some(p => style.includes(p));
      });

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
      <h2 className="page-title">Explore</h2>
      
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
          {availableCategories.map(category => (
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

// Top 50 Page Component
const TopBeersPage = ({ onCardClick, favorites, onToggleFav }) => {
  const [topBeers, setTopBeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchTop = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getTopBeers(50);
        if (cancelled) return;
        setTopBeers(data.map((beer, i) => ({
          id: beer.beer_id,
          name: beer.beer_name,
          style: beer.beer_style,
          abv: beer.beer_abv,
          match_score: 0,
          rating: beer.avg_overall_rating,
          image_url: getBeerImage(beer.beer_style, beer.beer_id),
          rank: i + 1,
        })));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTop();
    return () => { cancelled = true; };
  }, []);

  if (loading) return (
    <div className="empty-state">
      <h2>Loading Top 50...</h2>
    </div>
  );

  if (error) return (
    <div className="empty-state">
      <h2>Failed to load Top 50</h2>
      <p style={{ color: '#ff4d4d' }}>{error}</p>
    </div>
  );

  return (
    <div>
      <h2 className="page-title">Top 50 Highest Rated Beers</h2>
      <div className="favorites-grid">
        {topBeers.map((beer) => (
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

// Feeling Adventurous Page Component
const AdventurousPage = ({ userId, onCardClick, favorites, onToggleFav }) => {
  const [beers, setBeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAdventurous = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { recommended_ids, scores } = await getAdventurousRecommendations(userId, 10);
      const scaled = scaleScores(scores);
      const details = await Promise.all(recommended_ids.map((id) => getBeerDetails(id)));
      if (!mountedRef.current) return;
      setBeers(details.map((beer, i) => ({
        id: beer.beer_id,
        name: beer.beer_name,
        style: beer.beer_style,
        abv: beer.beer_abv,
        match_score: scaled[i],
        rating: beer.avg_overall_rating,
        image_url: getBeerImage(beer.beer_style, beer.beer_id),
      })));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchAdventurous();
  }, [userId, fetchAdventurous]);

  if (!userId) return (
    <div className="empty-state">
      <h2>Sign in to unlock this</h2>
      <p>Adventurous picks require a personal taste profile. Log in or complete onboarding first.</p>
    </div>
  );

  if (loading) return (
    <div className="empty-state">
      <h2>Finding your next adventure...</h2>
    </div>
  );

  if (error) return (
    <div className="empty-state">
      <h2>Could not load adventurous picks</h2>
      <p style={{ color: '#ff4d4d' }}>{error}</p>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 className="page-title" style={{ marginBottom: '0.3rem' }}>Feeling Adventurous?</h2>
          <p style={{ color: '#aaa', margin: 0 }}>
            These picks diverge from your usual taste — step outside your comfort zone!
          </p>
        </div>
        <button
          className="submit-review-btn"
          style={{ width: 'auto', padding: '0.6rem 1.5rem', whiteSpace: 'nowrap' }}
          onClick={fetchAdventurous}
        >
          Surprise Me Again
        </button>
      </div>
      <div className="favorites-grid">
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

const AntiRecommenderPage = ({ userId, onCardClick, favorites, onToggleFav }) => {
  const [beers, setBeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAnti = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { recommended_ids, scores } = await getAntiRecommendations(userId, 10);
      const details = await Promise.all(recommended_ids.map((id) => getBeerDetails(id)));
      if (!mountedRef.current) return;
      setBeers(details.map((beer, i) => ({
        id: beer.beer_id,
        name: beer.beer_name,
        style: beer.beer_style,
        abv: beer.beer_abv,
        match_score: scores[i],
        rating: beer.avg_overall_rating,
        image_url: getBeerImage(beer.beer_style, beer.beer_id),
      })));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchAnti();
  }, [userId, fetchAnti]);

  if (!userId) return (
    <div className="empty-state">
      <h2>Sign in to unlock this</h2>
      <p>Anti-recommendations require a personal taste profile. Log in or complete onboarding first.</p>
    </div>
  );

  if (loading) return (
    <div className="empty-state">
      <h2>Finding beers you should avoid...</h2>
    </div>
  );

  if (error) return (
    <div className="empty-state">
      <h2>Could not load anti-recommendations</h2>
      <p style={{ color: '#ff4d4d' }}>{error}</p>
    </div>
  );

  return (
    <div className="anti-page-container">
      <div className="anti-page-header">
        <div>
          <div className="anti-page-title-row">
            <span className="anti-icon">&#9888;</span>
            <h2>Anti-Recommender List</h2>
            <span className="anti-icon">&#9888;</span>
          </div>
          <p className="anti-page-subtitle">
            Our model is pretty sure you will hate these. Proceed at your own risk.
          </p>
        </div>
        <button
          className="submit-review-btn"
          style={{ width: 'auto', padding: '0.6rem 1.5rem', whiteSpace: 'nowrap' }}
          onClick={fetchAnti}
        >
          Refresh List
        </button>
      </div>
      <div className="favorites-grid">
        {beers.map((beer) => (
          <div key={beer.id} className="anti-card-wrapper">
            <BeerCard
              beer={beer}
              onCardClick={onCardClick}
              isFav={favorites.includes(beer.id)}
              onToggleFav={onToggleFav}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// 3. Main Dashboard Component
const RecommenderDashboard = ({ onLogout, coldStartRecs, userId, isNewUser = false, onNewUserDismiss }) => {
  const [selectedBeer, setSelectedBeer] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [userRatings, setUserRatings] = useState({});
  const [activeTab, setActiveTab] = useState('home');
  const [apiData, setApiData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [ratingVersion, setRatingVersion] = useState(0);
  const [liveUserId, setLiveUserId] = useState(null);
  const liveUserIdRef = useRef(null);
  const coldStartShownRef = useRef(false);
  const [partyMembers, setPartyMembers] = useState(['Me']);
  const friendDatabase = ["Alex (Lager Lover)", "Sarah (Hops Fanatic)", "David (Stout Guy)"];
  const [shareVersion, setShareVersion] = useState(0);

  const unreadShareCount = useMemo(() => {
    if (!userId) return 0;
    const record = getUserRecord(userId);
    return (record?.sharedWithMe || []).filter((s) => !s.seen).length;
  }, [userId, shareVersion]);

  useEffect(() => {
    let cancelled = false;

    const fetchLiveData = async () => {
      setIsLoading(true);
      setApiError(null);
      try {
        // 1. Cold-start: show quiz-based recs on first load for a new user.
        if (coldStartRecs && !coldStartShownRef.current) {
          const { recommended_ids, scores } = coldStartRecs;
          const scaled = scaleScores(scores);
          const details = await Promise.all(
            recommended_ids.map((id) => getBeerDetails(id))
          );
          if (cancelled) return;
          coldStartShownRef.current = true;
          const beers = details.map((beer, i) => mapBeerToCard(beer, scaled[i]));
          setApiData({ swimlanes: [{ id: 'top-matches', title: 'Top Matches for You', beers }] });
          return;
        }

        // 2. Real user: fetch recommendations using their actual identity.
        if (userId) {
          let fetchedFromRealUser = false;
          try {
            const { recommended_ids, scores } = await getRecommendations(userId, 20);
            const scaled = scaleScores(scores);
            const details = await Promise.all(
              recommended_ids.map((id) => getBeerDetails(id))
            );
            if (cancelled) return;
            const beers = details.map((beer, i) => mapBeerToCard(beer, scaled[i]));
            const sorted = [...beers].sort((a, b) => b.match_score - a.match_score);
            setApiData({
              swimlanes: [
                { id: 'top-matches', title: 'Top Matches for You', beers: sorted.slice(0, 10) },
                { id: 'also-like', title: 'You Might Also Like', beers: sorted.slice(10) },
              ],
            });
            fetchedFromRealUser = true;
          } catch {
            // User not in CF pipeline — fall through to sample user below
          }
          if (fetchedFromRealUser) return;
        }

        // 3. Fallback: fetch recommendations for a sample user.
        let sampleId = liveUserIdRef.current;
        if (!sampleId) {
          const { user_ids } = await getSampleUsers(1);
          sampleId = user_ids[0];
          if (!cancelled) {
            liveUserIdRef.current = sampleId;
            setLiveUserId(sampleId);
          }
        }
        const { recommended_ids, scores } = await getRecommendations(sampleId, 20);
        const scaled = scaleScores(scores);
        const details = await Promise.all(
          recommended_ids.map((id) => getBeerDetails(id))
        );
        if (cancelled) return;
        const beers = details.map((beer, i) => mapBeerToCard(beer, scaled[i]));
        const sorted = [...beers].sort((a, b) => b.match_score - a.match_score);
        setApiData({
          swimlanes: [
            { id: 'top-matches', title: 'Top Matches for You', beers: sorted.slice(0, 10) },
            { id: 'also-like', title: 'You Might Also Like', beers: sorted.slice(10) },
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
  }, [ratingVersion, userId, coldStartRecs]);

  const activeData = apiData;

  const displaySwimlanes = useMemo(() => {
    if (!activeData || !activeData.swimlanes) return [];
    
    const priority = ["top matches", "trending in", "outside"];
    
    // We create a fresh array copy to ensure React detects the change
    return [...activeData.swimlanes].sort((a, b) => {
      const getPriority = (title) => {
        const lowerTitle = title.toLowerCase();
        const index = priority.findIndex(p => lowerTitle.includes(p));
        return index === -1 ? 99 : index;
      };
      return getPriority(a.title) - getPriority(b.title);
    });
  }, [activeData, partyMembers]);

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

    if (userId) persistRating(userId, beerId, rating);

    const activeUserId = userId || liveUserId;
    try {
      if (activeUserId) await submitRating(activeUserId, beerId, rating);
    } catch {
      // Non-critical — local state was already updated
    }

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

    setRatingVersion(v => v + 1);
  };

  const toggleFavorite = (beerId) => {
    setFavorites(prev => prev.includes(beerId) ? prev.filter(id => id !== beerId) : [...prev, beerId]);
  };

  return (
    <div style={{ backgroundColor: '#141414', minHeight: '100vh', paddingBottom: '4rem' }}>
      <Navbar
        onLogout={onLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadShareCount={unreadShareCount}
      />
      
      <div style={{ padding: '1rem 3rem', display: 'flex', justifyContent: 'flex-end' }}>
        <GroupSwitcher 
          partyMembers={partyMembers} 
          friendDatabase={friendDatabase}
          onApplyMembers={(newMembers) => {
            setPartyMembers(newMembers);
            setActiveTab('home'); 
          }}
        />
      </div>

      <div style={{ padding: '0 3rem' }}>
        {activeData && activeData.swimlanes && (
          <>
            {activeTab === 'home' && (
              <>
                {isNewUser && (
                  <NewUserBanner onDismiss={onNewUserDismiss} />
                )}
                {displaySwimlanes.map((lane) => (
                  <Swimlane
                    key={`${lane.id}-${partyMembers.join(',')}`}
                    title={lane.title}
                    beers={lane.beers.filter(b => !userRatings[b.id])}
                    onCardClick={(beer) => setSelectedBeer(beer)}
                    favorites={favorites}
                    onToggleFav={toggleFavorite}
                  />
                ))}
              </>
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
                allBeers={allUniqueBeers.filter(b => !userRatings[b.id])}
                favorites={favorites}
                onCardClick={(beer) => setSelectedBeer(beer)}
                onToggleFav={toggleFavorite}
              />
            )}

            {activeTab === 'beer-lists' && <BeerListsPage allBeers={allUniqueBeers} onNavigate={setActiveTab} />}
            {activeTab === 'anti-recommender' && (
              <AntiRecommenderPage
                userId={liveUserId}
                onCardClick={(beer) => setSelectedBeer(beer)}
                favorites={favorites}
                onToggleFav={toggleFavorite}
              />
            )}
            {activeTab === 'build-six-pack' && <BuildSixPackPage allBeers={allUniqueBeers} onCardClick={(beer) => setSelectedBeer(beer)} />}
          </>
        )}

        {activeTab === 'top50' && (
          <TopBeersPage
            onCardClick={(beer) => setSelectedBeer(beer)}
            favorites={favorites}
            onToggleFav={toggleFavorite}
          />
        )}

        {activeTab === 'adventurous' && (
          <AdventurousPage
            userId={liveUserId}
            onCardClick={(beer) => setSelectedBeer(beer)}
            favorites={favorites}
            onToggleFav={toggleFavorite}
          />
        )}

        {activeTab === 'profile' && (
          <UserProfilePage userId={userId} />
        )}

        {activeTab === 'shared-with-me' && (
          <SharedWithMePage
            userId={userId}
            onBeerClick={async (beerId) => {
              try {
                const details = await getBeerDetails(beerId);
                setSelectedBeer(mapBeerToCard(details, 0));
              } catch {
                // beer details unavailable — silently skip
              }
            }}
          />
        )}
      </div>

      <BeerModal
        beer={selectedBeer}
        onClose={() => setSelectedBeer(null)}
        userRatingData={selectedBeer ? userRatings[selectedBeer.id] : null}
        onSubmitReview={handleSubmitReview}
        onCardClick={(beer) => setSelectedBeer(beer)}
        userId={userId}
        onShareSent={() => setShareVersion((v) => v + 1)}
      />
    </div>
  );
};

export default RecommenderDashboard;