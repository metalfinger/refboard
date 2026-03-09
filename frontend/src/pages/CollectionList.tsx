import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { getCollections, createCollection, deleteCollection as apiDeleteCollection } from '../api';

interface Collection {
  id: string;
  name: string;
  description: string;
  is_public: number;
  created_by: string;
  board_count: number;
  created_at: string;
  updated_at: string;
  member_role: string | null;
}

const gradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export default function CollectionList() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const load = useCallback(async (q?: string) => {
    try {
      const res = await getCollections(q);
      setCollections(res.data.collections || []);
    } catch (err) {
      console.error('Failed to load collections:', err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => load(search || undefined), 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await createCollection(newName.trim(), newDesc.trim());
      const col = res.data.collection || res.data;
      setShowModal(false);
      setNewName('');
      setNewDesc('');
      navigate(`/collection/${col.id}`);
    } catch (err) {
      console.error('Failed to create collection:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Delete this collection and ALL its boards? This cannot be undone.')) return;
    try {
      await apiDeleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete collection:', err);
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px', background: '#111', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '7px',
            background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(74,158,255,0.2)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#e8e8e8', letterSpacing: '-0.3px' }}>RefBoard</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #4a9eff, #667eea)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 700, color: '#fff',
          }}>
            {(user?.display_name || user?.email || '?')[0].toUpperCase()}
          </div>
          <span style={{ fontSize: '13px', color: '#777' }}>{user?.display_name || user?.email}</span>
          <button
            onClick={() => { logout(); navigate('/login', { replace: true }); }}
            style={{
              padding: '5px 14px', background: 'transparent', border: '1px solid #222',
              borderRadius: '6px', color: '#666', fontSize: '12px', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaa'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#666'; }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 28px', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#555" strokeWidth="1.5"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="6" cy="6" r="4.5" /><line x1="9.5" y1="9.5" x2="13" y2="13" strokeLinecap="round" />
          </svg>
          <input
            type="text" placeholder="Search collections..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '9px 14px 9px 34px',
              background: '#161616', border: '1px solid #222', borderRadius: '8px',
              color: '#e0e0e0', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: '9px 20px', background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
            color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px',
            fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            boxShadow: '0 2px 12px rgba(74,158,255,0.25)', transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          + New Collection
        </button>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '0 28px 28px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '16px', alignContent: 'start',
      }}>
        {collections.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: '80px 20px', color: '#444', fontSize: '14px',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.2 }}>+</div>
            No collections yet. Create one to get started.
          </div>
        )}
        {collections.map((col) => (
          <div
            key={col.id}
            onClick={() => navigate(`/collection/${col.id}`)}
            style={{
              background: '#141414', borderRadius: '12px', border: '1px solid #1e1e1e',
              overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#333';
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#1e1e1e';
              (e.currentTarget as HTMLElement).style.transform = 'none';
              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
            }}
          >
            <div style={{
              height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: gradients[hashCode(col.id) % gradients.length],
              fontSize: '32px', color: 'rgba(255,255,255,0.4)', fontWeight: 700,
            }}>
              {col.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ padding: '14px 16px 10px' }}>
              <p style={{
                fontSize: '15px', fontWeight: 600, color: '#e0e0e0', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {col.name}
              </p>
              {col.description && (
                <p style={{
                  fontSize: '12px', color: '#666', margin: '4px 0 0',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {col.description}
                </p>
              )}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 16px', borderTop: '1px solid #1a1a1a',
            }}>
              <span style={{ fontSize: '11px', color: '#555' }}>
                {col.board_count} board{col.board_count !== 1 ? 's' : ''}
              </span>
              <span style={{ fontSize: '11px', color: '#444' }}>
                {new Date(col.updated_at).toLocaleDateString()}
              </span>
              {col.created_by === user?.id && (
                <button
                  onClick={(e) => handleDelete(e, col.id)}
                  style={{
                    padding: '3px 8px', background: 'transparent', border: '1px solid #2a1515',
                    borderRadius: '4px', color: '#ff6b6b', fontSize: '10px', cursor: 'pointer',
                    opacity: 0.6, transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowModal(false)}>
          <div style={{
            background: '#161616', borderRadius: '16px', padding: '32px',
            width: '100%', maxWidth: '420px', border: '1px solid #222',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 24px', fontSize: '18px', fontWeight: 600, color: '#e0e0e0' }}>
              New Collection
            </h2>
            <input
              type="text" placeholder="Collection name" value={newName}
              onChange={(e) => setNewName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '12px',
                background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <input
              type="text" placeholder="Description (optional)" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '16px',
                background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowModal(false)} style={{
                padding: '8px 18px', background: 'transparent', border: '1px solid #222',
                borderRadius: '8px', color: '#888', fontSize: '13px', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating} style={{
                padding: '8px 20px',
                background: creating ? '#333' : 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
                color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px',
                fontWeight: 600, cursor: creating ? 'default' : 'pointer',
                opacity: creating ? 0.6 : 1,
              }}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
