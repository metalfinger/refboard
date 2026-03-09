import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  getCollectionDetail,
  getCollectionByShareToken,
  createBoard,
  deleteBoard as apiDeleteBoard,
} from '../api';
import ShareDialog from '../components/ShareDialog';

interface Board {
  id: string;
  name: string;
  description: string;
  image_count: number;
  created_at: string;
  updated_at: string;
}

interface CollectionDetailProps {
  isPublicView?: boolean;
}

const gradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
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

  async function handleDeleteBoard(e: React.MouseEvent, boardId: string) {
    e.stopPropagation();
    if (!confirm('Delete this board? This cannot be undone.')) return;
    try {
      await apiDeleteBoard(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (err) {
      console.error('Failed to delete board:', err);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0d0d', color: '#555', fontSize: '14px' }}>
        Loading...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0d0d', gap: '16px' }}>
        <div style={{ color: '#ff6b6b', fontSize: '14px' }}>{error}</div>
        <button onClick={() => navigate('/')} style={{
          padding: '8px 20px', background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
          border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '13px',
        }}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 28px', background: '#111', borderBottom: '1px solid #1a1a1a',
        flexShrink: 0, gap: '16px',
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '5px 12px', background: 'transparent', border: '1px solid #222',
            borderRadius: '6px', color: '#666', fontSize: '12px', cursor: 'pointer',
            whiteSpace: 'nowrap', transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaa'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#666'; }}
        >
          ← Back
        </button>
        <div style={{
          fontSize: '16px', fontWeight: 600, color: '#e0e0e0', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          letterSpacing: '-0.2px',
        }}>
          {collection?.name || 'Collection'}
        </div>
        {user && !isPublicView && (
          <button
            onClick={() => setShowShare(true)}
            style={{
              padding: '5px 16px', background: 'transparent',
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

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 28px', flexShrink: 0 }}>
        {isEditor && (
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
            + New Board
          </button>
        )}
        {collection?.description && (
          <span style={{ fontSize: '13px', color: '#555' }}>{collection.description}</span>
        )}
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '0 28px 28px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '16px', alignContent: 'start',
      }}>
        {boards.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: '80px 20px', color: '#444', fontSize: '14px',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.2 }}>+</div>
            No boards in this collection yet.
          </div>
        )}
        {boards.map((board) => (
          <div
            key={board.id}
            onClick={() => navigate(`/board/${board.id}`)}
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
              height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: gradients[hashCode(board.id) % gradients.length],
              fontSize: '28px', color: 'rgba(255,255,255,0.4)', fontWeight: 700,
            }}>
              {board.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ padding: '12px 14px 8px' }}>
              <p style={{
                fontSize: '14px', fontWeight: 600, color: '#e0e0e0', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {board.name}
              </p>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 14px', borderTop: '1px solid #1a1a1a',
            }}>
              <span style={{ fontSize: '11px', color: '#555' }}>
                {board.image_count} img{board.image_count !== 1 ? 's' : ''}
              </span>
              <span style={{ fontSize: '11px', color: '#444' }}>
                {new Date(board.updated_at).toLocaleDateString()}
              </span>
              {isOwner && (
                <button
                  onClick={(e) => handleDeleteBoard(e, board.id)}
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

      {/* Create board modal */}
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
            <h2 style={{ margin: '0 0 24px', fontSize: '18px', fontWeight: 600, color: '#e0e0e0' }}>New Board</h2>
            <input
              type="text" placeholder="Board name" value={newName}
              onChange={(e) => setNewName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBoard(); }}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '12px',
                background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <input
              type="text" placeholder="Description (optional)" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBoard(); }}
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
              <button onClick={handleCreateBoard} disabled={creating} style={{
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

      {showShare && resolvedId && (
        <ShareDialog collectionId={resolvedId} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
