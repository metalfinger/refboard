import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import api from '../api';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  is_active: number;
  created_at: string;
  updated_at: string;
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#0d0d0d',
  color: '#f0f0f0',
  border: '1px solid #2a2a2a',
  borderRadius: '6px',
  fontSize: '13px',
  width: '100%',
  boxSizing: 'border-box',
};

function Toast({ msg, kind, onDone }: { msg: string; kind: 'ok' | 'err'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px',
      background: kind === 'ok' ? 'rgba(40, 100, 50, 0.95)' : 'rgba(120, 40, 40, 0.95)',
      color: '#fff', padding: '12px 18px', borderRadius: '8px',
      fontSize: '13px', maxWidth: '420px',
      border: `1px solid ${kind === 'ok' ? '#3a7a4d' : '#a04545'}`,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 1000,
    }}>{msg}</div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (msg: string) => void }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      await api.post('/api/admin/users', {
        email, username, password,
        display_name: displayName || username,
        role,
      });
      onCreated(`Created ${email}`);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{
        background: '#161616', border: '1px solid #222', borderRadius: '14px',
        padding: '28px', width: '440px', maxWidth: 'calc(100vw - 40px)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 700, color: '#f0f0f0' }}>Create new user</h2>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: '#666' }}>
          New users sign in with email + password and start with the role you pick here.
        </p>

        {err && (
          <div style={{
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)',
            color: '#ff8a8a', padding: '10px 14px', borderRadius: '6px',
            fontSize: '12px', marginBottom: '14px',
          }}>{err}</div>
        )}

        <label style={{ display: 'block', marginBottom: '14px' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Email</span>
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label style={{ display: 'block', marginBottom: '14px' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Username</span>
          <input style={inputStyle} type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label style={{ display: 'block', marginBottom: '14px' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Display name <span style={{ color: '#555' }}>(optional)</span></span>
          <input style={inputStyle} type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label style={{ display: 'block', marginBottom: '14px' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Password (min 6 chars)</span>
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        <label style={{ display: 'block', marginBottom: '20px' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Role</span>
          <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onClose} style={{
            padding: '10px 16px', background: 'transparent', border: '1px solid #2a2a2a',
            borderRadius: '6px', color: '#888', fontSize: '13px', cursor: 'pointer',
          }}>Cancel</button>
          <button type="submit" disabled={submitting} style={{
            padding: '10px 18px', background: submitting ? '#2a4f9a' : '#386fe5',
            border: 'none', borderRadius: '6px', color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer',
          }}>{submitting ? 'Creating…' : 'Create user'}</button>
        </div>
      </form>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (msg: string) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      await api.put(`/api/admin/users/${user.id}/password`, { password: pw });
      onDone(`Password reset for ${user.email}`);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{
        background: '#161616', border: '1px solid #222', borderRadius: '14px',
        padding: '28px', width: '400px', maxWidth: 'calc(100vw - 40px)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: '#f0f0f0' }}>Reset password</h2>
        <p style={{ margin: '0 0 18px', fontSize: '12px', color: '#888' }}>For <span style={{ color: '#ccc' }}>{user.email}</span></p>

        {err && (
          <div style={{
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)',
            color: '#ff8a8a', padding: '10px 14px', borderRadius: '6px',
            fontSize: '12px', marginBottom: '14px',
          }}>{err}</div>
        )}

        <input style={inputStyle} type="password" placeholder="New password (min 6 chars)" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoFocus />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button type="button" onClick={onClose} style={{
            padding: '10px 16px', background: 'transparent', border: '1px solid #2a2a2a',
            borderRadius: '6px', color: '#888', fontSize: '13px', cursor: 'pointer',
          }}>Cancel</button>
          <button type="submit" disabled={submitting} style={{
            padding: '10px 18px', background: submitting ? '#2a4f9a' : '#386fe5',
            border: 'none', borderRadius: '6px', color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer',
          }}>{submitting ? 'Resetting…' : 'Reset password'}</button>
        </div>
      </form>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const { user: currentUser, loading: authLoading, logout } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const refresh = useCallback(async () => {
    setLoadErr('');
    try {
      const res = await api.get('/api/admin/users');
      const list: AdminUser[] = res.data?.users || [];
      list.sort((a, b) => {
        if (a.is_active !== b.is_active) return b.is_active - a.is_active;
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return a.email.localeCompare(b.email);
      });
      setUsers(list);
    } catch (e: any) {
      setLoadErr(e?.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) refresh();
  }, [authLoading, refresh]);

  if (authLoading) {
    return <div style={{ padding: 40, color: '#888', background: '#0a0a0a', minHeight: '100vh' }}>Loading…</div>;
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div style={{ padding: 60, background: '#0a0a0a', minHeight: '100vh', color: '#e8e8e8', textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>403 — Admin only</h1>
        <p style={{ color: '#888', marginBottom: 20 }}>You need admin privileges to view this page.</p>
        <button onClick={() => navigate('/')} style={{
          padding: '10px 18px', background: '#386fe5', border: 'none', borderRadius: 6,
          color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>Back to collections</button>
      </div>
    );
  }

  async function toggleRole(u: AdminUser) {
    const next: 'admin' | 'member' = u.role === 'admin' ? 'member' : 'admin';
    try {
      await api.put(`/api/admin/users/${u.id}/role`, { role: next });
      setToast({ msg: `${u.email} is now ${next}`, kind: 'ok' });
      refresh();
    } catch (e: any) {
      setToast({ msg: e?.response?.data?.error || 'Update failed', kind: 'err' });
    }
  }

  async function deactivate(u: AdminUser) {
    if (!confirm(`Deactivate ${u.email}? They won't be able to sign in. This is reversible — you can reactivate them later.`)) return;
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      setToast({ msg: `${u.email} deactivated`, kind: 'ok' });
      refresh();
    } catch (e: any) {
      setToast({ msg: e?.response?.data?.error || 'Deactivation failed', kind: 'err' });
    }
  }

  async function reactivate(u: AdminUser) {
    try {
      await api.put(`/api/admin/users/${u.id}/reactivate`);
      setToast({ msg: `${u.email} reactivated`, kind: 'ok' });
      refresh();
    } catch (e: any) {
      setToast({ msg: e?.response?.data?.error || 'Reactivation failed', kind: 'err' });
    }
  }

  const visible = users.filter((u) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return u.email.toLowerCase().includes(q)
      || u.username.toLowerCase().includes(q)
      || (u.display_name || '').toLowerCase().includes(q);
  });

  const adminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;
  const memberCount = users.filter((u) => u.role === 'member' && u.is_active).length;
  const inactiveCount = users.filter((u) => !u.is_active).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 32px', background: '#0f0f0f', borderBottom: '1px solid #1a1a1a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button onClick={() => navigate('/')} style={{
            padding: '6px 12px', background: 'transparent', border: '1px solid #252525',
            borderRadius: 6, color: '#888', fontSize: 12, cursor: 'pointer',
          }}>← Collections</button>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e8e8e8' }}>Admin · User management</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: '#888' }}>{currentUser.display_name || currentUser.email}</span>
          <button onClick={() => { logout(); navigate('/login', { replace: true }); }} style={{
            padding: '6px 14px', background: 'transparent', border: '1px solid #252525',
            borderRadius: 6, color: '#666', fontSize: 12, cursor: 'pointer',
          }}>Sign out</button>
        </div>
      </div>

      {/* Stats + Controls */}
      <div style={{ padding: '24px 32px 16px' }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <Stat label="Admins" value={adminCount} accent="#7ba9ff" />
          <Stat label="Members" value={memberCount} accent="#9aa9bb" />
          <Stat label="Inactive" value={inactiveCount} accent="#5a5a5a" />
          <Stat label="Total" value={users.length} accent="#cfd6df" />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <input
            placeholder="Filter by email, username, display name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...inputStyle, maxWidth: 360 }}
          />
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowCreate(true)} style={{
            padding: '10px 18px', background: '#386fe5', border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(56,111,229,0.3)',
          }}>+ New user</button>
        </div>

        {loadErr && (
          <div style={{
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)',
            color: '#ff8a8a', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 16,
          }}>{loadErr}</div>
        )}

        {loading ? (
          <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>Loading users…</div>
        ) : (
          <div style={{
            background: '#101010', border: '1px solid #1c1c1c', borderRadius: 10, overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 100px 100px 1fr',
              padding: '12px 16px', background: '#0c0c0c', borderBottom: '1px solid #1a1a1a',
              fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.6px',
            }}>
              <div>Email</div>
              <div>Username · Display</div>
              <div>Role</div>
              <div>Status</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {visible.length === 0 ? (
              <div style={{ padding: 40, color: '#666', textAlign: 'center' }}>No users match.</div>
            ) : visible.map((u) => {
              const isMe = u.id === currentUser.id;
              return (
                <div key={u.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 100px 100px 1fr',
                  padding: '12px 16px', borderTop: '1px solid #181818',
                  alignItems: 'center', fontSize: 13,
                  opacity: u.is_active ? 1 : 0.5,
                }}>
                  <div style={{ color: '#dadada', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
                    {u.email}{isMe && <span style={{ color: '#7ba9ff', marginLeft: 8, fontSize: 11 }}>(you)</span>}
                  </div>
                  <div style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
                    {u.username}{u.display_name && u.display_name !== u.username ? ` · ${u.display_name}` : ''}
                  </div>
                  <div>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                      fontSize: 11, fontWeight: 600,
                      background: u.role === 'admin' ? 'rgba(74,158,255,0.12)' : 'rgba(255,255,255,0.04)',
                      color: u.role === 'admin' ? '#7ba9ff' : '#999',
                      border: u.role === 'admin' ? '1px solid rgba(74,158,255,0.25)' : '1px solid #222',
                    }}>{u.role}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: u.is_active ? '#5fc97e' : '#888' }}>
                      {u.is_active ? '● Active' : '○ Inactive'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <ActionButton onClick={() => toggleRole(u)} disabled={isMe && u.role === 'admin'}>
                      {u.role === 'admin' ? 'Demote' : 'Make admin'}
                    </ActionButton>
                    <ActionButton onClick={() => setResetFor(u)}>Reset pw</ActionButton>
                    {u.is_active ? (
                      <ActionButton onClick={() => deactivate(u)} disabled={isMe} danger>Deactivate</ActionButton>
                    ) : (
                      <ActionButton onClick={() => reactivate(u)}>Reactivate</ActionButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={(m) => { setToast({ msg: m, kind: 'ok' }); refresh(); }} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} onDone={(m) => setToast({ msg: m, kind: 'ok' })} />}
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px', background: '#101010',
      border: '1px solid #1c1c1c', borderRadius: 10,
    }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, letterSpacing: '-0.5px' }}>{value}</div>
    </div>
  );
}

function ActionButton({ children, onClick, disabled, danger }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 10px',
        background: 'transparent',
        border: `1px solid ${danger ? '#5a2a2a' : '#252525'}`,
        borderRadius: 5,
        color: disabled ? '#444' : danger ? '#ff8a8a' : '#aaa',
        fontSize: 11,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >{children}</button>
  );
}
