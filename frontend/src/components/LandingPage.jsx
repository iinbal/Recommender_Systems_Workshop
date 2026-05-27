import React, { useState } from 'react';
import './LandingPage.css';
import logo from '../assets/logo.png';

const LandingPage = ({ onLogin, onSignUp }) => {
  const [isVerified, setIsVerified] = useState(false);

  const handleAtudaiClick = () => {
    alert("Nice try! Go finish your Calculus homework first. Come back when you're 18.");
  };

  return (
    <div className="landing-container">
      {/* Age Verification Modal */}
      {!isVerified && (
        <div className="age-modal-backdrop">
          <div className="age-modal">
            <h2>Age Verification</h2>
            <p>
              This website contains information about alcohol. 
              You must be of legal drinking age to enter.
            </p>
            <div className="age-buttons">
              <button className="btn-primary" onClick={() => setIsVerified(true)}>
                I am 18 years or older
              </button>
              <button className="btn-secondary" onClick={handleAtudaiClick}>
                I'm an Atudai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="top-section">
        <img src={logo} alt="RuBeer Logo" className="rubeer-logo" />
        <h1 className="hook-text">Stop guessing at the bar. Let our AI find your perfect pint.</h1>
        
        <div className="auth-container">
          <button className="btn-secondary" onClick={onLogin}>Log In</button>
          <button className="btn-primary" onClick={onSignUp}>Create New Account</button>
        </div>
      </div>

      <div className="bottom-section">
        <div className="about-box">
          <h2>About RuBeer</h2>
          <p>
            RuBeer uses advanced collaborative filtering and content-based machine learning 
            to analyze your taste profile. Whether you love a dark, roasted Imperial Stout 
            or a crisp, hazy NEIPA, our pipelines cross-reference thousands of data points 
            to recommend exactly what you should drink next.
          </p>
        </div>

        <div className="reviews-container">
          <h2>What Drinkers Are Saying</h2>
          <div className="review-card">
            "I used to just order whatever was on tap. RuBeer recommended a sour ale I never would have tried, and it's now my absolute favorite."
            <span className="review-author">— Sarah M.</span>
          </div>
          <div className="review-card">
            "The Netflix for beer. The personalized rows make it so easy to navigate through craft breweries."
            <span className="review-author">— Dave T.</span>
          </div>
        </div>

        {/* --- NEW SECTION: How It Works --- */}
        <div className="how-it-works">
          <h2>How It Works</h2>
          <div className="steps-container">
            <div className="step">
              <span className="step-number">1</span>
              <h3>Rate Beers</h3>
              <p>Tell us what you've enjoyed in the past to build your unique taste profile.</p>
            </div>
            <div className="step">
              <span className="step-number">2</span>
              <h3>The AI Engine</h3>
              <p>Our hybrid recommendation models crunch the numbers to find hidden matches.</p>
            </div>
            <div className="step">
              <span className="step-number">3</span>
              <h3>Get Recommendations</h3>
              <p>Discover your next favorite pint, perfectly matched to your palate.</p>
            </div>
          </div>
        </div>
      </div>

      {/* --- NEW SECTION: Footer --- */}
      <footer className="footer">
        <p>&copy; 2026 RuBeer. Drink responsibly.</p>
      </footer>
    </div>
  );
};

export default LandingPage;