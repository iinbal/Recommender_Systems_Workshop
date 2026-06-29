import { useState } from 'react';
import AuthScreen from './components/AuthScreen';
import RecommenderDashboard from './components/Dashboard';
import LandingPage from './components/LandingPage';
import './components/Dashboard.css';
import { saveColdStartRatings } from './services/authService';
import ColdStartRouter from './components/ColdStartRouter';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [needsColdStart, setNeedsColdStart] = useState(false);
  const [coldStartRecs, setColdStartRecs] = useState(null);
  const [isNewUser, setIsNewUser] = useState(false);

  // NEW: State to control if the Auth Screen is visible
  const [showAuth, setShowAuth] = useState(false);
  const [initialAuthView, setInitialAuthView] = useState(true); // true = login, false = register

  const handleColdStartComplete = async ({ recs, ratedBeers }) => {
    // Save completion flag regardless of method (guard: demo-mode users have no email)
    if (currentUser.email) {
      saveColdStartRatings(currentUser.email, ratedBeers || {});
    }

    if (recs) {
      // Method 2 path: server returned recommendations directly
      setColdStartRecs(recs);
    }
    // Method 1 path: ratings already posted to /ratings,
    // normal recommendation fetch will pick them up automatically.
    // recs is null — RecommenderDashboard fetches recommendations normally.

    setNeedsColdStart(false);
    setIsNewUser(true);  // trigger the post-onboarding nudge banner
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
        initialIsLogin={initialAuthView}
        onBack={() => setShowAuth(false)} // Gives them a way back to the landing page
      />
    );
  }

  // 2. If not logged in AND Auth Screen is NOT triggered, show Landing Page
  if (!currentUser && !showAuth) {
    return <LandingPage onStartAuth={handleStartAuth} />;
  }

  // 3. If logged in but needs cold start, show ColdStartRouter
  if (needsColdStart) {
    return (
      <ColdStartRouter
        currentUser={currentUser}
        onComplete={handleColdStartComplete}
      />
    );
  }

  // 4. Otherwise, show the main application
  return (
    <RecommenderDashboard
      coldStartRecs={coldStartRecs}
      userId={currentUser.userId}
      onLogout={handleLogout}
      isNewUser={isNewUser}
      onNewUserDismiss={() => setIsNewUser(false)}
    />
  );
}

export default App;