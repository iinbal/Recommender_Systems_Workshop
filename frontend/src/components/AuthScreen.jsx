import React, { useState } from 'react';
import './LandingPage.css';
import logo from '../assets/logo.png';

const AuthScreen = ({ onLogin, isDemoMode, initialIsLogin, onBack }) => {
  const [isLogin, setIsLogin] = useState(initialIsLogin);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const userData = { email: email || 'demo@rubeer.com' };
    // New accounts (register) go through the cold-start questionnaire first.
    const requiresColdStart = !isLogin;
    onLogin(userData, requiresColdStart);
  };

  return (
    <div className="landing-container">
      <div className="top-section">
        <img src={logo} alt="RuBeer Logo" className="rubeer-logo" />
        <h1 className="hook-text">{isLogin ? 'Welcome Back' : 'Create Your Account'}</h1>

        <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email"
            className="search-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', maxWidth: 'none' }}
            required
          />
          <input
            type="password"
            className="search-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', maxWidth: 'none' }}
            required
          />

          <button type="submit" className="btn-primary">
            {isLogin ? 'Log In' : 'Create Account'}
          </button>

          {isDemoMode && (
            <p style={{ color: '#888', fontSize: '0.85rem', textAlign: 'center', margin: 0 }}>
              Demo mode: any email/password will work.
            </p>
          )}
        </form>

        <div className="auth-container" style={{ marginTop: '1.5rem' }}>
          <button className="btn-secondary" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? "Need an account? Sign Up" : 'Already have an account? Log In'}
          </button>
        </div>

        <button
          onClick={onBack}
          style={{ marginTop: '1rem', background: 'none', border: 'none', color: '#888', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default AuthScreen;
