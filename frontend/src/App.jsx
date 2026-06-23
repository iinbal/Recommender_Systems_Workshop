import React, { useState } from 'react';
import AuthScreen from './components/AuthScreen';
import RecommenderDashboard, { BottleIcon } from './components/Dashboard';
import LandingPage from './components/LandingPage';
import './components/Dashboard.css';
import { saveColdStartRatings } from './services/authService';
import CherryTartImage from './assets/Cherry Tart.jpg';
import citrusBlastImage from './assets/Citrus Blast.jpg';
import desertMirageImage from './assets/Sour Ale.jpg';
import galacticStoutImage from './assets/Galactic Stout.jpg';
import hazyHorizonImage from './assets/Hazy Horizon.jpg';
import midnightPorterImage from './assets/Midnight Porter.jpg';
import rubyRedImage from './assets/Ruby Red.jpg';
import crispMorningImage from './assets/Crisp morning.jpg';
import goldenHourImage from './assets/Golden Hour.jpg';
import spicedPumpkinImage from './assets/Spiced Pumpkin.jpg';


// --- COLD START QUESTIONNAIRE ---
const MIN_RATINGS_REQUIRED = 5;

const ColdStartCard = ({ beer, rating, hoverRating, onHover, onLeave, onRate }) => (
  <div className="beer-card-wrapper">
    <div className="beer-card">
      <img src={beer.image_url} alt={beer.name} className="beer-image" />
      <div className="beer-info">
        <h3 className="beer-title">{beer.name}</h3>
        <div className="beer-meta">{beer.style} • {beer.abv}% ABV</div>
        <div className="bottle-rating-container" style={{ marginTop: '0.5rem' }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <BottleIcon
              key={star}
              filled={star <= (hoverRating || rating)}
              onMouseEnter={() => onHover(star)}
              onMouseLeave={onLeave}
              onClick={() => onRate(star)}
            />
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ColdStartQuestionnaire = ({ beers, onComplete }) => {
  const [ratings, setRatings] = useState({});
  const [hovered, setHovered] = useState({});

  const ratedCount = Object.keys(ratings).length;
  const canSubmit = ratedCount >= MIN_RATINGS_REQUIRED;

  const handleRate = (beerId, star) => {
    setRatings(prev => ({ ...prev, [beerId]: star }));
  };

  return (
    <div style={{ backgroundColor: '#141414', minHeight: '100vh', padding: '2rem 3rem', color: '#fff' }}>
      <h2 className="page-title">Welcome! Let's get to know your taste</h2>
      <p style={{ color: '#ccc', marginBottom: '1.5rem' }}>
        Rate at least {MIN_RATINGS_REQUIRED} beers to help us build your personalized recommendations.
        ({ratedCount}/{MIN_RATINGS_REQUIRED} rated)
      </p>

      <div className="favorites-grid">
        {beers.map((beer) => (
          <ColdStartCard
            key={beer.id}
            beer={beer}
            rating={ratings[beer.id] || 0}
            hoverRating={hovered[beer.id] || 0}
            onHover={(star) => setHovered(prev => ({ ...prev, [beer.id]: star }))}
            onLeave={() => setHovered(prev => ({ ...prev, [beer.id]: 0 }))}
            onRate={(star) => handleRate(beer.id, star)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
        <button
          className="submit-review-btn"
          style={{ width: 'auto', padding: '0.8rem 2.5rem' }}
          disabled={!canSubmit}
          onClick={() => onComplete(ratings)}
        >
          {canSubmit ? 'Build My Profile' : `Rate at least ${MIN_RATINGS_REQUIRED} beers to continue`}
        </button>
      </div>
    </div>
  );
};

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [needsColdStart, setNeedsColdStart] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(true); 
  
  // NEW: State to control if the Auth Screen is visible
  const [showAuth, setShowAuth] = useState(false);
  const [initialAuthView, setInitialAuthView] = useState(true); // true = login, false = register

const dummyData = {
    swimlanes: [
      {
        id: 'top-matches',
        title: 'Top Matches for You',
        beers: [
          { id: 'b1', name: 'Galactic Stout', style: 'Imperial Stout', abv: 9.5, match_score: 0.98, rating: 4.8, image_url: galacticStoutImage },
          { id: 'b2', name: 'Hazy Horizon', style: 'NEIPA', abv: 6.8, match_score: 0.94, rating: 4.5, image_url: hazyHorizonImage },
          { id: 'b3', name: 'Crisp Morning', style: 'Pilsner', abv: 4.5, match_score: 0.91, rating: 4.2, image_url: crispMorningImage },
          { id: 'b4', name: 'Ruby Red', style: 'Amber Ale', abv: 5.5, match_score: 0.88, rating: 4.0, image_url: rubyRedImage }
        ]
      },
      {
        id: 'trending',
        title: 'Trending in Tel Aviv',
        beers: [
          { id: 'b5', name: 'Desert Mirage', style: 'Sour Ale', abv: 5.2, match_score: 0.85, rating: 4.1, image_url: desertMirageImage },
          { id: 'b6', name: 'Citrus Blast', style: 'IPA', abv: 7.2, match_score: 0.82, rating: 4.4, image_url: citrusBlastImage },
          { id: 'b7', name: 'Midnight Porter', style: 'Porter', abv: 6.0, match_score: 0.80, rating: 4.6, image_url: midnightPorterImage },
          { id: 'b8', name: 'Golden Hour', style: 'Wheat Beer', abv: 4.8, match_score: 0.77, rating: 3.9, image_url: goldenHourImage }
        ]
      },
      {
        id: 'try-something-new',
        title: 'Step Outside Your Comfort Zone',
        beers: [
          { id: 'b9', name: 'Spiced Pumpkin', style: 'Seasonal Ale', abv: 6.5, match_score: 0.65, rating: 3.8, image_url: spicedPumpkinImage },
          { id: 'b10', name: 'Cherry Tart', style: 'Fruited Sour', abv: 4.2, match_score: 0.58, rating: 4.3, image_url: CherryTartImage },
        ]
      }
    ]
  };

  const handleLogin = (userData, requiresColdStart) => {
    setCurrentUser(userData);
    setNeedsColdStart(requiresColdStart);
    setShowAuth(false); // Reset this so it's clean if they log out later
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  const handleStartAuth = (isLogin) => {
    setInitialAuthView(isLogin);
    setShowAuth(true);
  };

  // 1. If not logged in AND Auth Screen is triggered, show Auth Screen
  if (!currentUser && showAuth) {
    return (
      <AuthScreen 
        onLogin={handleLogin} 
        isDemoMode={isDemoMode} 
        initialIsLogin={initialAuthView}
        onBack={() => setShowAuth(false)} // Gives them a way back to the landing page
      />
    );
  }

  // 2. If not logged in AND Auth Screen is NOT triggered, show Landing Page
  if (!currentUser && !showAuth) {
    return <LandingPage onStartAuth={handleStartAuth} />;
  }

  // 3. If logged in but needs cold start, show Questionnaire
  if (needsColdStart) {
    const coldStartBeers = dummyData.swimlanes.flatMap(lane => lane.beers)
      .filter((beer, index, self) => self.findIndex(b => b.id === beer.id) === index);

    return (
      <ColdStartQuestionnaire
        beers={coldStartBeers}
        onComplete={(ratings) => {
          // The questionnaire collects beer ratings, which we persist locally.
          // The quiz-based cold-start endpoint (style answers) is a separate
          // flow driven by the onboarding quiz, not this screen.
          saveColdStartRatings(currentUser.email, ratings);
          setNeedsColdStart(false);
        }}
      />
    );
  }

  // 4. Otherwise, show the main application
  return (
    <RecommenderDashboard 
      data={dummyData} 
      onLogout={handleLogout} 
    />
  );
}

export default App;