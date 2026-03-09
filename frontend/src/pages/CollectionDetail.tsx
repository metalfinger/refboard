import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  getCollectionDetail,
  getCollectionByShareToken,
  createBoard,
  deleteBoard as apiDeleteBoard,
  updateBoard,
  updateCollection,
} from '../api';
import ShareDialog from '../components/ShareDialog';

interface Board {
  id: string;
  name: string;
  description: string;
  image_count: number;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionDetailProps {
  isPublicView?: boolean;
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

function CardMenu({ onRename, onDelete, canEdit, canDelete }: {
  onRename: () => void;
  onDelete?: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!canEdit && !canDelete) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          width: '24px', height: '24px', background: 'transparent', border: 'none',
          color: '#666', cursor: 'pointer', borderRadius: '4px', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', padding: 0,
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
          padding: '4px', minWidth: '110px', zIndex: 100,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }} onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <button
              onClick={() => { setOpen(false); onRename(); }}
              style={{
                display: 'block', width: '100%', padding: '7px 12px', background: 'transparent',
                border: 'none', color: '#ccc', fontSize: '12px', cursor: 'pointer',
                textAlign: 'left', borderRadius: '5px', transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#222'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Rename
            </button>
          )}
          {canDelete && onDelete && (
            <button
              onClick={() => { setOpen(false); onDelete(); }}
              style={{
                display: 'block', width: '100%', padding: '7px 12px', background: 'transparent',
                border: 'none', color: '#ff6b6b', fontSize: '12px', cursor: 'pointer',
                textAlign: 'left', borderRadius: '5px', transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#1f1111'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CollectionDetail({ isPublicView }: CollectionDetailProps) {
  const { collectionId, shareToken } = useParams<{ collectionId?: string; shareToken?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [collection, setCollection] = useState<any>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameBoardText, setRenameBoardText] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const boardRenameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      let res;
      if (shareToken) {
        res = await getCollectionByShareToken(shareToken);
        setCollection(res.data.collection);
        setBoards(res.data.boards || []);
        setMembers([]);
      } else if (collectionId) {
        res = await getCollectionDetail(collectionId);
        setCollection(res.data.collection);
        setBoards(res.data.boards || []);
        setMembers(res.data.members || []);
      }
      setLoading(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load collection');
      setLoading(false);
    }
  }, [collectionId, shareToken]);

  useEffect(() => { load(); }, [load]);

  const resolvedId = collectionId || collection?.id;
  const isOwner = members.some((m: any) => m.user_id === user?.id && m.role === 'owner');
  const isEditor = isOwner || members.some((m: any) => m.user_id === user?.id && (m.role === 'editor' || m.role === 'owner'));

  useEffect(() => { if (editingTitle) titleRef.current?.select(); }, [editingTitle]);
  useEffect(() => { if (renamingBoardId) boardRenameRef.current?.select(); }, [renamingBoardId]);

  async function handleCreateBoard() {
    if (!newName.trim() || !resolvedId) return;
    setCreating(true);
    try {
      const res = await createBoard(resolvedId, newName.trim(), newDesc.trim());
      const board = res.data.board || res.data;
      setShowModal(false);
      setNewName('');
      setNewDesc('');
      navigate(`/board/${board.id}`);
    } catch (err) {
      console.error('Failed to create board:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteBoard(boardId: string) {
    if (!confirm('Delete this board? This cannot be undone.')) return;
    try {
      await apiDeleteBoard(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (err) {
      console.error('Failed to delete board:', err);
    }
  }

  async function commitBoardRename(boardId: string) {
    const trimmed = renameBoardText.trim();
    const board = boards.find(b => b.id === boardId);
    if (trimmed && trimmed !== board?.name) {
      try {
        await updateBoard(boardId, { name: trimmed });
        setBoards((prev) => prev.map((b) => b.id === boardId ? { ...b, name: trimmed } : b));
      } catch (err) {
        console.error('Failed to rename board:', err);
      }
    }
    setRenamingBoardId(null);
  }

  async function handleRenameCollection(name: string) {
    if (!resolvedId) return;
    try {
      await updateCollection(resolvedId, { name });
      setCollection((prev: any) => ({ ...prev, name }));
    } catch (err) {
      console.error('Failed to rename collection:', err);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', color: '#555', fontSize: '14px' }}>
        Loading...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', gap: '16px' }}>
        <div style={{ color: '#ff6b6b', fontSize: '14px' }}>{error}</div>
        <button onClick={() => navigate('/')} style={{
          padding: '8px 20px', background: '#4a9eff',
          border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px',
        }}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 32px', background: '#0f0f0f', borderBottom: '1px solid #1a1a1a',
        flexShrink: 0, gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '5px 12px', background: 'transparent', border: '1px solid #252525',
              borderRadius: '6px', color: '#666', fontSize: '12px', cursor: 'pointer',
              whiteSpace: 'nowrap', transition: 'all 0.15s', flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaa'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#666'; }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: '4px', verticalAlign: 'middle' }}>
              <path d="M8 1L3 6l5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Collections
          </button>
          <span style={{ color: '#333', flexShrink: 0 }}>/</span>
          {editingTitle ? (
            <input
              ref={titleRef}
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={() => {
                const t = titleText.trim();
                if (t && t !== collection?.name) handleRenameCollection(t);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              style={{
                fontSize: '15px', fontWeight: 600, color: '#e0e0e0',
                background: '#0a0a0a', border: '1px solid #4a9eff', borderRadius: '4px',
                padding: '2px 8px', outline: 'none', minWidth: '120px', maxWidth: '300px',
              }}
              autoFocus
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span
                style={{
                  fontSize: '15px', fontWeight: 600, color: '#e0e0e0',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {collection?.name || 'Collection'}
              </span>
              {isEditor && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTitleText(collection?.name || '');
                    setEditingTitle(true);
                  }}
                  style={{
                    width: '22px', height: '22px', background: 'transparent', border: 'none',
                    color: '#555', cursor: 'pointer', borderRadius: '4px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                    flexShrink: 0, padding: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#222'; e.currentTarget.style.color = '#ccc'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#555'; }}
                  title="Rename collection"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {user && !isPublicView && (
            <button
              onClick={() => setShowShare(true)}
              style={{
                padding: '5px 14px', background: 'transparent',
                border: '1px solid rgba(74,158,255,0.3)', borderRadius: '6px',
                color: '#4a9eff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(74,158,255,0.08)';
                e.currentTarget.style.borderColor = '#4a9eff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(74,158,255,0.3)';
              }}
            >
              Share
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: '16px 32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isEditor && (
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
              + New Board
            </button>
          )}
          {collection?.description && (
            <span style={{ fontSize: '13px', color: '#555' }}>{collection.description}</span>
          )}
        </div>
        <span style={{ fontSize: '12px', color: '#444' }}>
          {boards.length} board{boards.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Board Grid */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '0 32px 32px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: '16px', alignContent: 'start',
      }}>
        {boards.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: '100px 20px', color: '#444',
          }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1" style={{ marginBottom: '14px' }}>
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <circle cx="8.5" cy="10.5" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 500, color: '#555', marginBottom: '6px' }}>No boards yet</div>
            <div style={{ fontSize: '13px', color: '#444' }}>Create a board to start collecting references</div>
          </div>
        )}
        {boards.map((board) => (
          <div
            key={board.id}
            onClick={() => navigate(`/board/${board.id}`)}
            style={{
              background: '#131313', borderRadius: '10px', border: '1px solid #1c1c1c',
              cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = '#2a2a2a';
              el.style.transform = 'translateY(-2px)';
              el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = '#1c1c1c';
              el.style.transform = 'none';
              el.style.boxShadow = 'none';
            }}
          >
            {/* Preview — auto-generated from board content */}
            <div style={{
              height: '140px',
              background: '#0c0c0c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', borderRadius: '10px 10px 0 0',
            }}>
              {board.thumbnail ? (
                <img
                  src={board.thumbnail}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  draggable={false}
                />
              ) : (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: '#2a2a2a',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="2" y="3" width="20" height="18" rx="2" />
                    <circle cx="8.5" cy="10.5" r="2" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  <span style={{ fontSize: '10px', color: '#333' }}>
                    {board.image_count > 0 ? `${board.image_count} image${board.image_count !== 1 ? 's' : ''}` : 'Empty board'}
                  </span>
                </div>
              )}
            </div>

            {/* Board name + menu */}
            <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {renamingBoardId === board.id ? (
                  <input
                    ref={boardRenameRef}
                    value={renameBoardText}
                    onChange={(e) => setRenameBoardText(e.target.value)}
                    onBlur={() => commitBoardRename(board.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitBoardRename(board.id);
                      if (e.key === 'Escape') setRenamingBoardId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%', fontSize: '13px', fontWeight: 600, color: '#e0e0e0',
                      background: '#0a0a0a', border: '1px solid #4a9eff', borderRadius: '4px',
                      padding: '2px 6px', outline: 'none', boxSizing: 'border-box',
                    }}
                    autoFocus
                  />
                ) : (
                  <p style={{
                    fontSize: '13px', fontWeight: 600, color: '#e0e0e0', margin: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {board.name}
                  </p>
                )}
              </div>
              <CardMenu
                onRename={() => { setRenameBoardText(board.name); setRenamingBoardId(board.id); }}
                onDelete={() => handleDeleteBoard(board.id)}
                canEdit={isEditor}
                canDelete={isOwner}
              />
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 12px', borderTop: '1px solid #191919',
              fontSize: '10px', color: '#555',
            }}>
              <span>{board.image_count} img{board.image_count !== 1 ? 's' : ''}</span>
              <span style={{ color: '#2a2a2a' }}>|</span>
              <span style={{ color: '#444' }}>{timeAgo(board.updated_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Create board modal */}
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
            <h2 style={{ margin: '0 0 20px', fontSize: '17px', fontWeight: 600, color: '#e0e0e0' }}>New Board</h2>
            <input
              type="text" placeholder="Board name" value={newName}
              onChange={(e) => setNewName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBoard(); }}
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBoard(); }}
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
              <button onClick={handleCreateBoard} disabled={creating || !newName.trim()} style={{
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

      {showShare && resolvedId && (
        <ShareDialog collectionId={resolvedId} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
