import { useState } from 'react';
import AuthScreen from './components/AuthScreen';
import RecommenderDashboard from './components/Dashboard';
import LandingPage from './components/LandingPage';
import './components/Dashboard.css';
import { saveColdStartRatings } from './services/authService';
import ColdStartRouter from './components/ColdStartRouter';
import StavAssistant from './components/StavAssistant';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [needsColdStart, setNeedsColdStart] = useState(false);
  const [coldStartRecs, setColdStartRecs] = useState(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const isLoggedIn = currentUser !== null;
  const [showAuth, setShowAuth] = useState(false);
  const [initialAuthView, setInitialAuthView] = useState(true); 

  const handleColdStartComplete = async ({ recs, ratedBeers }) => {
    if (currentUser.email) {
      saveColdStartRatings(currentUser.email, ratedBeers || {});
    }
    if (recs) {
      setColdStartRecs(recs);
    }
    setNeedsColdStart(false);
    setIsNewUser(true);  
  };

  const handleLogin = (userData, requiresColdStart) => {
    setCurrentUser(userData);
    setNeedsColdStart(requiresColdStart);
    setShowAuth(false); 
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  const handleStartAuth = (isLogin) => {
    setInitialAuthView(isLogin);
    setShowAuth(true);
  };

  const renderCurrentScreen = () => {
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
      return (
        <ColdStartRouter
          currentUser={currentUser}
          onComplete={handleColdStartComplete}
        />
      );
    }

    return (
      <RecommenderDashboard
        coldStartRecs={coldStartRecs}
        userId={currentUser.userId}
        onLogout={handleLogout}
        isNewUser={isNewUser}
        onNewUserDismiss={() => setIsNewUser(false)}
      />
    );
  };

  return (
    <>
      {renderCurrentScreen()}
      {isLoggedIn && <StavAssistant />}
    </>
  );
}

export default App;