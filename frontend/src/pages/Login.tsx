import React, { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { login as apiLogin, register as apiRegister } from '../api';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isRegister) {
        const res = await apiRegister(email, username || email.split('@')[0], password, displayName || username || email.split('@')[0]);
        login(res.data.token, res.data.user);
      } else {
        const res = await apiLogin(email, password);
        login(res.data.token, res.data.user);
      }
      navigate('/', { replace: true });
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Something went wrong';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
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
            {isRegister ? 'Create your account' : 'Sign in to continue'}
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

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#666', fontWeight: 500, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                Username
              </label>
              <input
                style={inputStyle}
                type="text" value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username" required autoComplete="username"
              />
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#666', fontWeight: 500, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                Display Name
              </label>
              <input
                style={inputStyle}
                type="text" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name" autoComplete="name"
              />
            </>
          )}
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#666', fontWeight: 500, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
            Email
          </label>
          <input
            style={inputStyle}
            type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" required autoComplete="email"
          />
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#666', fontWeight: 500, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
            Password
          </label>
          <input
            style={inputStyle}
            type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={6}
          />
          <button
            type="submit" disabled={submitting}
            style={{
              width: '100%', padding: '12px', marginTop: '4px',
              background: submitting ? '#333' : 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
              color: '#fff', border: 'none', borderRadius: '8px',
              fontSize: '14px', fontWeight: 600, cursor: submitting ? 'default' : 'pointer',
              transition: 'opacity 0.2s', opacity: submitting ? 0.6 : 1,
              boxShadow: submitting ? 'none' : '0 2px 12px rgba(74,158,255,0.3)',
            }}
          >
            {submitting ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: '#555' }}>
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            style={{
              color: '#4a9eff', cursor: 'pointer', background: 'none',
              border: 'none', fontSize: '13px', fontWeight: 500,
            }}
          >
            {isRegister ? 'Sign In' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', marginBottom: '16px',
  background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '8px',
  color: '#e0e0e0', fontSize: '14px', outline: 'none',
  boxSizing: 'border-box', transition: 'border-color 0.2s',
};
