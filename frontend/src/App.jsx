import React, { useState } from 'react';
import LandingPage from './components/LandingPage';
import OnboardingPage from './components/OnboardingPage';
import RecommenderDashboard from './components/Dashboard';
import mockData from './dummy_ui_data.json';

// page states: 'landing' | 'onboarding' | 'dashboard'

function App() {
  const [page, setPage] = useState('landing');
  const [preferredStyles, setPreferredStyles] = useState([]);

  const handleLogin = () => setPage('dashboard');

  const handleSignUp = () => setPage('onboarding');

  const handleOnboardingComplete = (styles) => {
    setPreferredStyles(styles);
    setPage('dashboard');
  };

  const handleLogout = () => {
    setPreferredStyles([]);
    setPage('landing');
  };

  if (page === 'onboarding') {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  if (page === 'dashboard') {
    return (
      <RecommenderDashboard
        data={mockData}
        preferredStyles={preferredStyles}
        onLogout={handleLogout}
      />
    );
  }

  return <LandingPage onLogin={handleLogin} onSignUp={handleSignUp} />;
}

export default App;
