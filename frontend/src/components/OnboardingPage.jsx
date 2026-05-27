import React, { useState } from 'react';
import './OnboardingPage.css';
import logo from '../assets/logo.png';

const STYLE_OPTIONS = [
  { id: 'IPA',       emoji: '🍊', label: 'IPA',        desc: 'Hoppy & bitter'       },
  { id: 'Stout',     emoji: '🖤', label: 'Stout',       desc: 'Dark & roasted'       },
  { id: 'Lager',     emoji: '🌾', label: 'Lager',       desc: 'Light & crisp'        },
  { id: 'Sour',      emoji: '🍋', label: 'Sour Ale',    desc: 'Tart & funky'         },
  { id: 'Pale Ale',  emoji: '🌟', label: 'Pale Ale',    desc: 'Balanced & floral'    },
  { id: 'Wheat',     emoji: '🥨', label: 'Wheat Beer',  desc: 'Smooth & hazy'        },
  { id: 'Porter',    emoji: '☕', label: 'Porter',      desc: 'Rich & chocolatey'    },
  { id: 'Pilsner',   emoji: '🏅', label: 'Pilsner',     desc: 'Clean & golden'       },
];

const OnboardingPage = ({ onComplete }) => {
  const [selected, setSelected] = useState([]);

  const toggle = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  return (
    <div className="onboarding-container">
      <img src={logo} alt="RuBeer Logo" className="onboarding-logo" />

      <h1 className="onboarding-title">What's your taste?</h1>
      <p className="onboarding-subtitle">
        Pick the styles you enjoy — we'll use these to kick-start your recommendations.
      </p>

      <div className="style-grid">
        {STYLE_OPTIONS.map((style) => (
          <button
            key={style.id}
            className={`style-card ${selected.includes(style.id) ? 'selected' : ''}`}
            onClick={() => toggle(style.id)}
          >
            <span className="style-emoji">{style.emoji}</span>
            <span className="style-label">{style.label}</span>
            <span className="style-desc">{style.desc}</span>
            {selected.includes(style.id) && <span className="style-check">✓</span>}
          </button>
        ))}
      </div>

      <div className="onboarding-actions">
        <button
          className="btn-primary onboarding-btn"
          onClick={() => onComplete(selected)}
          disabled={selected.length === 0}
        >
          Get My Recommendations →
        </button>
        <button
          className="btn-skip"
          onClick={() => onComplete([])}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
};

export default OnboardingPage;
