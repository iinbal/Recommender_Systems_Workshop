import React, { useState } from 'react';
import './Auth.css';
import logo from '../assets/logo.png';
import { loginUser, registerUser } from '../services/authService';


const AuthScreen = ({ onLogin, initialIsLogin = true, onBack }) => {
  const [isLoginView, setIsLoginView] = useState(initialIsLogin);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isAdult, setIsAdult] = useState(false);
  const [error, setError] = useState('');

  const validateEmail = (e) => {
    return e.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!isLoginView) {
      if (!username.trim()) return setError("Please enter a display name.");
      if (!validateEmail(email)) return setError("Please enter a valid email address.");
      if (password !== confirmPassword) return setError("Passwords do not match.");
      if (!isAdult) return setError("You must be 18 or older to create an account.");
      if (password.length < 6) return setError("Password must be at least 6 characters.");

      const result = registerUser(username, email, password);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onLogin(result.user, result.user.needsColdStart);
    } else {
      if (!email || !password) return setError("Please enter your email and password.");

      const result = loginUser(email, password);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onLogin(result.user, result.user.needsColdStart);
    }
  };

  const handleForgotPassword = () => {
    alert("Password reset instructions have been sent to your registered email (Simulated).");
  };

 return (
    <div className="auth-container">
      <div className="auth-card">
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          ← Back to Home
        </button>
        <div className="auth-header">
          <div className="auth-logo-row">
            <img src={logo} alt="RuBeer Logo" className="auth-logo" />
            <h1>RuBeer</h1>
          </div>
          <p>{isLoginView ? 'Welcome back to your digital cellar.' : 'Start discovering better beer.'}</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {!isLoginView && (
            <div className="form-group">
              <label>Display Name</label>
              <input
                type="text"
                className="auth-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label>Password</label>
              {isLoginView && (
                <button type="button" className="auth-link" style={{ fontSize: '0.8rem', fontWeight: 'normal' }} onClick={handleForgotPassword}>
                  Forgot Password?
                </button>
              )}
            </div>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {!isLoginView && (
            <>
              <div className="form-group">
                <label>Re-enter Password</label>
                <input
                  type="password"
                  className="auth-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <div className="auth-checkbox-group">
                <input
                  type="checkbox"
                  id="age-verify"
                  checked={isAdult}
                  onChange={(e) => setIsAdult(e.target.checked)}
                />
                <label htmlFor="age-verify">I verify that I am 18 years of age or older.</label>
              </div>
            </>
          )}

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="auth-btn">
            {isLoginView ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-footer">
          {isLoginView ? (
            <>
              Don't have an account?
              <button className="auth-link" onClick={() => { setIsLoginView(false); setError(''); }}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?
              <button className="auth-link" onClick={() => { setIsLoginView(true); setError(''); }}>
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
