/**
 * MattermostImport — modal dialog for importing media from Mattermost.
 *
 * Allows pulling images from a Mattermost thread/channel URL and managing
 * linked channels for auto-sync.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';

interface MattermostImportProps {
  boardId: string;
  onClose: () => void;
  onMediaArrived?: (assets: { assetKey: string; w: number; h: number }[]) => void;
}

interface LinkedChannel {
  id: string;
  channelName: string;
  channelId: string;
  linkedAt: string;
}

export default function MattermostImport({ boardId, onClose, onMediaArrived }: MattermostImportProps) {
  const [url, setUrl] = useState('');
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [linkedChannels, setLinkedChannels] = useState<LinkedChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linking, setLinking] = useState(false);

  // Load linked channels on mount
  const loadLinkedChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const res = await api.get(`/api/boards/${boardId}/mm-links`);
      setLinkedChannels(res.data?.links || []);
    } catch {
      // Endpoint may not exist yet — silently ignore
      setLinkedChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  }, [boardId]);

  useEffect(() => {
    loadLinkedChannels();
  }, [loadLinkedChannels]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pull images from URL
  const handlePull = async () => {
    if (!url.trim()) return;
    setPulling(true);
    setError('');
    setSuccess('');

    try {
      const res = await api.post(`/api/boards/${boardId}/mm-pull`, { url: url.trim() });
      const assets = res.data?.assets || [];
      const count = assets.length;
      setSuccess(`Pulled ${count} image${count !== 1 ? 's' : ''}`);
      setUrl('');

      if (count > 0 && onMediaArrived) {
        onMediaArrived(assets);
      }

      // Auto-close after brief delay on success
      if (count > 0) {
        setTimeout(onClose, 800);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to pull images');
    } finally {
      setPulling(false);
    }
  };

  // Link a channel
  const handleLink = async () => {
    if (!linkUrl.trim()) return;
    setLinking(true);
    setError('');

    try {
      await api.post(`/api/boards/${boardId}/mm-links`, { url: linkUrl.trim() });
      setLinkUrl('');
      loadLinkedChannels();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to link channel');
    } finally {
      setLinking(false);
    }
  };

  // Unlink a channel
  const handleUnlink = async (linkId: string) => {
    try {
      await api.delete(`/api/boards/${boardId}/mm-links/${linkId}`);
      loadLinkedChannels();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to unlink channel');
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#141414', border: '1px solid #222', borderRadius: '16px',
          width: '100%', maxWidth: '480px', maxHeight: '85vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 16px', borderBottom: '1px solid #1e1e1e', flexShrink: 0,
        }}>
          <h2 style={{
            margin: 0, fontSize: '16px', fontWeight: 600,
            color: '#e0e0e0', letterSpacing: '-0.3px',
          }}>
            Import from Mattermost
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: '6px',
              color: '#888', padding: '4px 12px', cursor: 'pointer', fontSize: '11px',
            }}
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px 24px' }}>
          {/* Error / Success */}
          {error && (
            <div style={{
              padding: '8px 12px', background: 'rgba(255,80,80,0.1)',
              border: '1px solid rgba(255,80,80,0.2)', borderRadius: '8px',
              color: '#ff6b6b', fontSize: '12px', marginBottom: '12px',
            }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{
              padding: '8px 12px', background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.2)', borderRadius: '8px',
              color: '#4ade80', fontSize: '12px', marginBottom: '12px',
            }}>
              {success}
            </div>
          )}

          {/* Pull images section */}
          <SectionLabel text="Pull Images from Thread" />
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePull(); }}
              placeholder="https://chat.metalfinger.xyz/team/pl/..."
              style={{
                flex: 1, padding: '8px 12px', background: '#1a1a1a',
                border: '1px solid #333', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '13px', outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#4a9eff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#333'; }}
            />
            <button
              onClick={handlePull}
              disabled={pulling || !url.trim()}
              style={{
                padding: '8px 16px',
                background: pulling ? '#333' : 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
                border: 'none', borderRadius: '8px',
                color: '#fff', fontSize: '12px', fontWeight: 600,
                cursor: pulling ? 'wait' : 'pointer',
                opacity: !url.trim() ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {pulling ? 'Pulling...' : 'Pull Images'}
            </button>
          </div>

          {/* Linked channels section */}
          <SectionLabel text="Linked Channels" />
          <div style={{ marginBottom: '12px' }}>
            {loadingChannels ? (
              <div style={{ fontSize: '12px', color: '#555', padding: '8px 0' }}>
                Loading...
              </div>
            ) : linkedChannels.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#555', padding: '8px 0' }}>
                No linked channels. Link one below for auto-sync.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {linkedChannels.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', background: '#1a1a1a',
                      border: '1px solid #2a2a2a', borderRadius: '8px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', color: '#ccc', fontWeight: 500 }}>
                        {ch.channelName || ch.channelId}
                      </div>
                      <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
                        Linked {new Date(ch.linkedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnlink(ch.id)}
                      style={{
                        padding: '4px 10px', background: 'transparent',
                        border: '1px solid #333', borderRadius: '6px',
                        color: '#888', fontSize: '11px', cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#ff6b6b';
                        e.currentTarget.style.color = '#ff6b6b';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#333';
                        e.currentTarget.style.color = '#888';
                      }}
                    >
                      Unlink
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Link new channel */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }}
              placeholder="Channel URL to link..."
              style={{
                flex: 1, padding: '8px 12px', background: '#1a1a1a',
                border: '1px solid #333', borderRadius: '8px',
                color: '#e0e0e0', fontSize: '13px', outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#4a9eff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#333'; }}
            />
            <button
              onClick={handleLink}
              disabled={linking || !linkUrl.trim()}
              style={{
                padding: '8px 16px', background: '#1a1a1a',
                border: '1px solid #333', borderRadius: '8px',
                color: '#ccc', fontSize: '12px', fontWeight: 500,
                cursor: linking ? 'wait' : 'pointer',
                opacity: !linkUrl.trim() ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (linkUrl.trim()) {
                  e.currentTarget.style.borderColor = '#4a9eff';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#333';
              }}
            >
              {linking ? 'Linking...' : 'Link Channel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: '10px', fontWeight: 700, color: '#4a9eff', letterSpacing: '0.8px',
      textTransform: 'uppercase', padding: '0 0 8px', marginBottom: '4px',
    }}>
      {text}
    </div>
  );
}
