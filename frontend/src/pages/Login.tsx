import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import api from '../api';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [allowRegister, setAllowRegister] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);
  const navigate = useNavigate();
  const { login, user } = useAuth();

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    api.get('/api/auth/config')
      .then((res) => {
        setAllowRegister(!!res.data?.allowSelfRegistration);
        setHasUsers(!!res.data?.hasUsers);
        if (!res.data?.hasUsers) setMode('register');
      })
      .catch(() => { /* fall through; defaults are safe */ });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, username, displayName: displayName || username, password };
      const res = await api.post(path, body);
      if (res.data?.token && res.data?.user) {
        login(res.data.token, res.data.user);
        navigate('/', { replace: true });
      } else {
        setError('Unexpected response from server.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', marginBottom: '12px',
    background: '#0d0d0d', color: '#f0f0f0',
    border: '1px solid #2a2a2a', borderRadius: '8px',
    fontSize: '14px', boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0d0d0d',
      backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(74,158,255,0.08) 0%, transparent 60%)',
    }}>
      <div style={{
        background: '#161616', borderRadius: '16px', padding: '40px 36px',
        width: '100%', maxWidth: '400px',
        border: '1px solid #222', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
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
          <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
            {!hasUsers ? 'Create the first admin account' : mode === 'login' ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.15)',
            color: '#ff8a8a', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
            fontSize: '13px', lineHeight: '1.4',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            style={inputStyle}
          />
          {mode === 'register' && (
            <>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={inputStyle}
              />
            </>
          )}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '14px', marginTop: '4px',
              background: loading ? '#2a4f9a' : '#386fe5', color: '#fff',
              border: 'none', borderRadius: '8px',
              fontSize: '15px', fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              transition: 'background 0.2s',
              boxShadow: '0 2px 12px rgba(56,111,229,0.3)',
            }}
          >
            {loading ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        {(allowRegister || !hasUsers) && (
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#666' }}>
            {mode === 'login' ? (
              <>Need an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); setError(''); }} style={{ color: '#4a9eff' }}>Register</a></>
            ) : hasUsers ? (
              <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); }} style={{ color: '#4a9eff' }}>Sign in</a></>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
