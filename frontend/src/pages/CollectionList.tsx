import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { getCollections, createCollection, deleteCollection as apiDeleteCollection, updateCollection } from '../api';
import ShareDialog from '../components/ShareDialog';

interface Collection {
  id: string;
  name: string;
  description: string;
  is_public: number;
  created_by: string;
  board_count: number;
  member_count: number;
  created_at: string;
  updated_at: string;
  member_role: string | null;
  preview_thumbnail: string | null;
  preview_thumbnails: string | null;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// Seeded pseudo-random for consistent offsets per card
function seededRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

// Three-dot dropdown menu for card actions
function CardMenu({ onRename, onShare, onDelete, isOwner }: {
  onRename: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          width: '24px', height: '24px', background: 'transparent', border: 'none',
          color: '#666', cursor: 'pointer', borderRadius: '4px', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
          fontSize: '16px', padding: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#222'; e.currentTarget.style.color = '#ccc'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#666'; }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: '4px',
          background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px',
          padding: '4px', minWidth: '120px', zIndex: 100,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }} onClick={(e) => e.stopPropagation()}>
          {[
            { label: 'Rename', onClick: onRename, show: true },
            { label: 'Share', onClick: onShare, show: isOwner && !!onShare },
            { label: 'Delete', onClick: onDelete, show: isOwner && !!onDelete, danger: true },
          ].filter(i => i.show).map((item, idx) => (
            <button
              key={idx}
              onClick={() => { setOpen(false); item.onClick?.(); }}
              style={{
                display: 'block', width: '100%', padding: '7px 12px', background: 'transparent',
                border: 'none', color: item.danger ? '#ff6b6b' : '#ccc', fontSize: '12px',
                cursor: 'pointer', textAlign: 'left', borderRadius: '5px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = item.danger ? '#1f1111' : '#222'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CollectionList() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [shareColId, setShareColId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

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

  async function handleDelete(id: string) {
    if (!confirm('Delete this collection and ALL its boards? This cannot be undone.')) return;
    try {
      await apiDeleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete collection:', err);
    }
  }

  async function commitRename(id: string) {
    const trimmed = renameText.trim();
    const col = collections.find(c => c.id === id);
    if (trimmed && trimmed !== col?.name) {
      try {
        await updateCollection(id, { name: trimmed });
        setCollections((prev) => prev.map((c) => c.id === id ? { ...c, name: trimmed } : c));
      } catch (err) {
        console.error('Failed to rename:', err);
      }
    }
    setRenamingId(null);
  }

  function getThumbnails(col: Collection): string[] {
    if (!col.preview_thumbnails) return [];
    return col.preview_thumbnails.split('|||').filter(Boolean).slice(0, 4);
  }

  // Stacked photo offsets — consistent per collection via seeded random
  function getStackOffsets(id: string, count: number) {
    const rng = seededRandom(hashCode(id));
    return Array.from({ length: count }, () => ({
      rotate: (rng() - 0.5) * 16,     // -8 to +8 degrees
      offsetX: (rng() - 0.5) * 20,    // -10 to +10 px
      offsetY: (rng() - 0.5) * 12,    // -6 to +6 px
    }));
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 32px', background: '#0f0f0f', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '8px',
            background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(74,158,255,0.25)',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#e8e8e8', letterSpacing: '-0.3px' }}>RefBoard</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #4a9eff, #667eea)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 700, color: '#fff',
          }}>
            {(user?.display_name || user?.email || '?')[0].toUpperCase()}
          </div>
          <span style={{ fontSize: '13px', color: '#888' }}>{user?.display_name || user?.email}</span>
          <button
            onClick={() => { logout(); navigate('/login', { replace: true }); }}
            style={{
              padding: '6px 14px', background: 'transparent', border: '1px solid #252525',
              borderRadius: '6px', color: '#666', fontSize: '12px', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaa'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#666'; }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Title + Controls */}
      <div style={{ padding: '24px 32px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e8e8e8', letterSpacing: '-0.4px' }}>
            Collections
          </h1>
          <span style={{ fontSize: '12px', color: '#555' }}>
            {collections.length} collection{collections.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#555" strokeWidth="1.5"
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
              <circle cx="6" cy="6" r="4.5" /><line x1="9.5" y1="9.5" x2="13" y2="13" strokeLinecap="round" />
            </svg>
            <input
              type="text" placeholder="Search..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '8px 14px 8px 34px',
                background: '#141414', border: '1px solid #222', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#333'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#222'; }}
            />
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '8px 18px', background: '#4a9eff',
              color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px',
              fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3d8be0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#4a9eff'; }}
          >
            + New Collection
          </button>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '0 32px 32px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '20px', alignContent: 'start',
      }}>
        {collections.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: '100px 20px', color: '#444',
          }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1" style={{ marginBottom: '16px' }}>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 500, color: '#555', marginBottom: '6px' }}>No collections yet</div>
            <div style={{ fontSize: '13px', color: '#444' }}>Create a collection to organize your reference boards</div>
          </div>
        )}
        {collections.map((col) => {
          const thumbs = getThumbnails(col);
          const offsets = getStackOffsets(col.id, thumbs.length);
          const isOwner = col.created_by === user?.id;

          return (
            <div
              key={col.id}
              onClick={() => navigate(`/collection/${col.id}`)}
              style={{
                background: '#131313', borderRadius: '12px', border: '1px solid #1e1e1e',
                cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = '#2a2a2a';
                el.style.transform = 'translateY(-3px)';
                el.style.boxShadow = '0 12px 32px rgba(0,0,0,0.35)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = '#1e1e1e';
                el.style.transform = 'none';
                el.style.boxShadow = 'none';
              }}
            >
              {/* Preview — stacked board thumbnails like scattered photos */}
              <div style={{
                height: '160px',
                background: '#0c0c0c',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', borderRadius: '12px 12px 0 0',
                position: 'relative',
              }}>
                {thumbs.length > 0 ? (
                  // Stacked/fanned thumbnails
                  thumbs.map((t, i) => {
                    const o = offsets[i];
                    const z = thumbs.length - i; // first on top
                    return (
                      <div key={i} style={{
                        position: 'absolute',
                        width: thumbs.length === 1 ? '75%' : '60%',
                        aspectRatio: '4/3',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        border: '2px solid #1a1a1a',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        transform: `rotate(${o.rotate}deg) translate(${o.offsetX}px, ${o.offsetY}px)`,
                        zIndex: z,
                        background: `url(${t}) center/cover #111`,
                      }} />
                    );
                  })
                ) : (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: '#2a2a2a',
                  }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                    <span style={{ fontSize: '11px', color: '#333' }}>
                      {col.board_count === 0 ? 'Empty collection' : `${col.board_count} board${col.board_count !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                )}
              </div>

              {/* Name + menu */}
              <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === col.id ? (
                    <input
                      ref={renameRef}
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => commitRename(col.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(col.id);
                        if (e.key === 'Escape') setRenamingId(null);
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%', fontSize: '14px', fontWeight: 600, color: '#e0e0e0',
                        background: '#0a0a0a', border: '1px solid #4a9eff', borderRadius: '4px',
                        padding: '2px 6px', outline: 'none', boxSizing: 'border-box',
                      }}
                      autoFocus
                    />
                  ) : (
                    <p style={{
                      fontSize: '14px', fontWeight: 600, color: '#e0e0e0', margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {col.name}
                    </p>
                  )}
                  {col.description && (
                    <p style={{
                      fontSize: '11px', color: '#555', margin: '3px 0 0',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {col.description}
                    </p>
                  )}
                </div>
                <CardMenu
                  onRename={() => { setRenameText(col.name); setRenamingId(col.id); }}
                  onShare={() => setShareColId(col.id)}
                  onDelete={() => handleDelete(col.id)}
                  isOwner={isOwner}
                />
              </div>

              {/* Footer */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 14px', borderTop: '1px solid #191919',
                fontSize: '10px', color: '#555',
              }}>
                <span>{col.board_count} board{col.board_count !== 1 ? 's' : ''}</span>
                <span style={{ color: '#2a2a2a' }}>|</span>
                {col.is_public ? (
                  <span style={{ color: '#43e97b', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" />
                    </svg>
                    Public
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" />
                    </svg>
                    {col.member_count} member{col.member_count !== 1 ? 's' : ''}
                  </span>
                )}
                <span style={{ color: '#2a2a2a' }}>|</span>
                <span style={{ color: '#444' }}>{timeAgo(col.updated_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(8px)',
        }} onClick={() => setShowModal(false)}>
          <div style={{
            background: '#151515', borderRadius: '14px', padding: '28px',
            width: '100%', maxWidth: '400px', border: '1px solid #252525',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 20px', fontSize: '17px', fontWeight: 600, color: '#e0e0e0' }}>
              New Collection
            </h2>
            <input
              type="text" placeholder="Collection name" value={newName}
              onChange={(e) => setNewName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '10px',
                background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#4a9eff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; }}
            />
            <input
              type="text" placeholder="Description (optional)" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '20px',
                background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#4a9eff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowModal(false)} style={{
                padding: '8px 16px', background: 'transparent', border: '1px solid #252525',
                borderRadius: '8px', color: '#888', fontSize: '13px', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()} style={{
                padding: '8px 20px',
                background: creating || !newName.trim() ? '#333' : '#4a9eff',
                color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px',
                fontWeight: 600, cursor: creating || !newName.trim() ? 'default' : 'pointer',
                opacity: creating || !newName.trim() ? 0.5 : 1,
                transition: 'all 0.15s',
              }}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareColId && (
        <ShareDialog collectionId={shareColId} onClose={() => { setShareColId(null); load(); }} />
      )}
    </div>
  );
}
