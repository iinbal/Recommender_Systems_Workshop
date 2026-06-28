import React, { useState, useEffect } from 'react';
import AuthScreen from './components/AuthScreen';
import RecommenderDashboard, { BottleIcon } from './components/Dashboard';
import LandingPage from './components/LandingPage';
import './components/Dashboard.css';
import { saveColdStartRatings } from './services/authService';
import { getColdStartRecommendations, getColdStartProbeBeers, submitRating } from './services/apiService';
import { getBeerImage } from './utils/beerImages';


// --- COLD START QUESTIONNAIRE ---
const MIN_RATINGS_REQUIRED = 5;

const computeClusterScores = (ratings, probeBeers) => {
  const clusters = ['hoppy', 'dark', 'sour', 'light'];
  const clusterMap = {};
  probeBeers.forEach(b => { clusterMap[b.id] = b.cluster; });

  const buckets = {};
  Object.entries(ratings).forEach(([beerId, star]) => {
    const cluster = clusterMap[beerId];
    if (cluster) {
      if (!buckets[cluster]) buckets[cluster] = [];
      buckets[cluster].push(star);
    }
  });

  const scores = {};
  clusters.forEach(c => {
    const vals = buckets[c] || [];
    scores[c] = vals.length ? vals.reduce((a, b) => a + b) / vals.length : 3;
  });
  return scores;
};

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

const ColdStartQuestionnaire = ({ onComplete }) => {
  const [ratings, setRatings] = useState({});
  const [hovered, setHovered] = useState({});
  const [probeBeers, setProbeBeers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getColdStartProbeBeers()
      .then(beers => {
        setProbeBeers(beers.map(b => ({
          id: b.beer_id,
          name: b.beer_name,
          style: b.beer_style,
          abv: b.beer_abv,
          cluster: b.cluster,
          image_url: getBeerImage(b.beer_style, b.beer_id),
        })));
      })
      .catch(() => setProbeBeers([]))
      .finally(() => setLoading(false));
  }, []);

  const ratedCount = Object.keys(ratings).length;
  const canSubmit = ratedCount >= MIN_RATINGS_REQUIRED;

  const handleRate = (beerId, star) => {
    setRatings(prev => ({ ...prev, [beerId]: star }));
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: '#141414', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
        <p style={{ fontSize: '1.2rem', color: '#ccc' }}>Loading beers…</p>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#141414', minHeight: '100vh', padding: '2rem 3rem', color: '#fff' }}>
      <h2 className="page-title">Welcome! Let's get to know your taste</h2>
      <p style={{ color: '#ccc', marginBottom: '1.5rem' }}>
        Rate at least {MIN_RATINGS_REQUIRED} beers to help us build your personalized recommendations.
        ({ratedCount}/{MIN_RATINGS_REQUIRED} rated)
      </p>

      <div className="favorites-grid">
        {probeBeers.map((beer) => (
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
          onClick={() => onComplete(ratings, probeBeers)}
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
  const [coldStartRecs, setColdStartRecs] = useState(null);
  const [coldStartLoading, setColdStartLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [initialAuthView, setInitialAuthView] = useState(true);

  const handleColdStartComplete = async (ratings, probeBeers) => {
    setColdStartLoading(true);
    try {
      const clusterScores = computeClusterScores(ratings, probeBeers);

      // Seed the backend session with the quiz ratings so CB fold-in works immediately
      await Promise.allSettled(
        Object.entries(ratings).map(([beerId, rating]) =>
          submitRating(currentUser.userId, beerId, rating)
        )
      );

      const recs = await getColdStartRecommendations(clusterScores);
      setColdStartRecs(recs);
    } catch {
      // API unavailable — Dashboard will fetch sample-user recs as fallback
    } finally {
      saveColdStartRatings(currentUser.email, ratings);
      setNeedsColdStart(false);
      setColdStartLoading(false);
    }
  };

  const handleLogin = (userData, requiresColdStart) => {
    setCurrentUser(userData);
    setNeedsColdStart(requiresColdStart);
    setShowAuth(false);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setColdStartRecs(null);
  };

  const handleStartAuth = (isLogin) => {
    setInitialAuthView(isLogin);
    setShowAuth(true);
  };

  if (!currentUser && showAuth) {
    return (
      <AuthScreen
        onLogin={handleLogin}
        initialIsLogin={initialAuthView}
        onBack={() => setShowAuth(false)}
      />
    );
  }

  if (!currentUser && !showAuth) {
    return <LandingPage onStartAuth={handleStartAuth} />;
  }

  if (needsColdStart) {
    if (coldStartLoading) {
      return (
        <div style={{ backgroundColor: '#141414', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <p style={{ fontSize: '1.2rem', color: '#ccc' }}>Building your taste profile…</p>
        </div>
      );
    }

    return (
      <ColdStartQuestionnaire onComplete={handleColdStartComplete} />
    );
  }

  return (
    <RecommenderDashboard
      coldStartRecs={coldStartRecs}
      userId={currentUser.userId}
      onLogout={handleLogout}
    />
  );
}

export default App;
