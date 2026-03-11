import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [searchParams] = useSearchParams();

  // Handle OAuth callback — token + user in URL params
  useEffect(() => {
    const token = searchParams.get('token');
    const userParam = searchParams.get('user');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(errorParam);
      window.history.replaceState({}, '', '/login');
      return;
    }

    if (token && userParam) {
      try {
        const userData = JSON.parse(userParam);
        login(token, userData);
        navigate('/', { replace: true });
      } catch {
        setError('Failed to complete login. Please try again.');
        window.history.replaceState({}, '', '/login');
      }
    }
  }, [searchParams, login, navigate]);

  // If already logged in, redirect
  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  function handleMattermostLogin() {
    window.location.href = '/api/auth/mattermost';
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0d0d0d',
      backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(74,158,255,0.08) 0%, transparent 60%)',
    }}>
      <div style={{
        background: '#161616', borderRadius: '16px', padding: '48px 40px',
        width: '100%', maxWidth: '400px',
        border: '1px solid #222', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '48px', height: '48px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
            marginBottom: '16px', boxShadow: '0 4px 16px rgba(74,158,255,0.3)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <h1 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: 700, color: '#f0f0f0', letterSpacing: '-0.5px' }}>
            RefBoard
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#555', letterSpacing: '0.2px' }}>
            Sign in with your team account
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.15)',
            color: '#ff8a8a', padding: '10px 14px', borderRadius: '8px', marginBottom: '20px',
            fontSize: '13px', lineHeight: '1.4',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleMattermostLogin}
          style={{
            width: '100%', padding: '14px', marginBottom: '0',
            background: '#386fe5', color: '#fff', border: 'none', borderRadius: '8px',
            fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            transition: 'background 0.2s',
            boxShadow: '0 2px 12px rgba(56,111,229,0.3)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#2f5fc4')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#386fe5')}
        >
          <svg width="18" height="18" viewBox="0 0 500 500" fill="currentColor">
            <path d="M250 0C111.93 0 0 111.93 0 250s111.93 250 250 250 250-111.93 250-250S388.07 0 250 0zm127.55 354.07c-2.93 5.77-9.18 8.85-15.57 8.85-2.68 0-5.4-.59-7.97-1.85l-72.76-35.72c-19.7 14.88-43.19 22.66-67.58 22.66-6.2 0-12.5-.5-18.73-1.53-24.83-4.07-47.17-16.41-63.38-34.95-16.63-19.03-25.78-43.42-25.78-68.68 0-12.07 2.1-23.86 6.15-35.12.58-1.62 1.54-3.07 2.79-4.22L250.07 91.53c3.08-2.62 7.51-2.62 10.59 0l135.28 112c1.56 1.29 2.65 3.04 3.13 5-.04 11.84-2.08 23.56-6.02 34.7l-72.76-35.72c-7.72-3.79-17.03-.59-20.82 7.13-3.79 7.72-.59 17.03 7.13 20.82l72.76 35.72c-9.28 21.84-26.16 39.95-47.98 50.72l.01-.01 72.76 35.72c7.72 3.79 10.92 13.1 7.13 20.82l.27-.36z"/>
          </svg>
          Sign in with Mattermost
        </button>
      </div>
    </div>
  );
}
