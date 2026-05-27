import React, { useState } from 'react';
import LandingPage from './components/LandingPage';
import RecommenderDashboard from './components/Dashboard';
import mockData from './dummy_ui_data.json';

function App() {
  // false = Landing Page, true = Dashboard
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <div>
      {!isLoggedIn ? (
        <LandingPage onLogin={() => setIsLoggedIn(true)} />
      ) : (
        <RecommenderDashboard data={mockData} onLogout={() => setIsLoggedIn(false)} />
      )}
    </div>
  );
}

export default App;