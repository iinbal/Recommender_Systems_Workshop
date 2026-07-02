import React, { useState } from 'react';
import MethodChoiceScreen from './MethodChoiceScreen';
import BeerSearchFlow from './BeerSearchFlow';
import AspectRatingFlow from './AspectRatingFlow';
import {
  submitColdStartBeerRatings,
  submitAttributesColdStart,
} from '../services/apiService';

/**
 * ColdStartRouter — top-level orchestrator for the new-user onboarding flows.
 *
 * Props:
 *   currentUser { email, userId }
 *   onComplete  ({ recs: array|null, ratedBeers: object|null }) => void
 *
 * Screens:
 *   'choice'  — MethodChoiceScreen (pick Method 1, Method 2, or skip)
 *   'method1' — BeerSearchFlow     (search & rate real beers)
 *   'method2' — AspectRatingFlow   (rate taste attributes + styles)
 */
const ColdStartRouter = ({ currentUser, onComplete }) => {
  const [activeScreen, setActiveScreen] = useState('choice');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- handlers ----

  const handleChooseMethod = (method) => {
    if (method === 1) setActiveScreen('method1');
    else if (method === 2) setActiveScreen('method2');
  };

  const handleMethod1Complete = async (ratedBeers) => {
    setIsSubmitting(true);
    try {
      await submitColdStartBeerRatings(currentUser.userId, ratedBeers);
    } catch {
      // Best-effort — proceed even if the API call fails
    } finally {
      setIsSubmitting(false);
      onComplete({ recs: null, ratedBeers });
    }
  };

  const handleMethod2Complete = async (payload) => {
    setIsSubmitting(true);
    try {
      const result = await submitAttributesColdStart(currentUser.userId, payload);
      onComplete({ recs: result, ratedBeers: null });
    } catch {
      // Fall through gracefully so the dashboard still opens
      onComplete({ recs: null, ratedBeers: null });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onComplete({ recs: null, ratedBeers: null });
  };

  // ---- loading overlay ----

  if (isSubmitting) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(20, 20, 20, 0.97)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          color: '#fff',
        }}
      >
        <style>{`@keyframes csr-spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '3px solid #333',
            borderTopColor: '#E67E22',
            borderRadius: '50%',
            animation: 'csr-spin 0.8s linear infinite',
            marginBottom: '1.5rem',
          }}
        />
        <p style={{ color: '#ccc', fontSize: '1.1rem' }}>
          Building your taste profile&hellip;
        </p>
      </div>
    );
  }

  // ---- screen routing ----

  if (activeScreen === 'choice') {
    return (
      <MethodChoiceScreen
        onChooseMethod={handleChooseMethod}
        onSkip={handleSkip}
      />
    );
  }

  if (activeScreen === 'method1') {
    return (
      <BeerSearchFlow
        currentUser={currentUser}
        onComplete={handleMethod1Complete}
        onSwitchToMethod2={() => setActiveScreen('method2')}
      />
    );
  }

  if (activeScreen === 'method2') {
    return (
      <AspectRatingFlow
        onComplete={handleMethod2Complete}
        onBack={() => setActiveScreen('choice')}
      />
    );
  }

  return null;
};

export default ColdStartRouter;
