import React, { useState, useCallback, useSyncExternalStore } from 'react';
import { AnnotationStore, Thread } from '../stores/annotationStore';

interface FeedbackPanelProps {
  annotationStore: AnnotationStore;
  selectedObjectId: string | null;
  userId: string;
  boardId: string;
  token: string;
  canvasObjects: Map<string, { id: string; name?: string; type: string }>;
  onJumpToObject?: (objectId: string) => void;
}

export default function FeedbackPanel({
  annotationStore,
  selectedObjectId,
  userId,
  boardId,
  token,
  canvasObjects,
  onJumpToObject,
}: FeedbackPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'mine'>('unresolved');
  const [newCommentText, setNewCommentText] = useState('');
  const [showOrphans, setShowOrphans] = useState(false);

  // Subscribe to store changes
  const _version = useSyncExternalStore(
    (cb) => annotationStore.subscribe(cb),
    () => annotationStore.threads.size + annotationStore.votes.size,
  );

  const allThreads = Array.from(annotationStore.threads.values());

  // Apply filter
  let threads = allThreads;
  if (filter === 'unresolved') threads = threads.filter((t) => t.status === 'open');
  if (filter === 'mine') threads = threads.filter((t) => t.created_by === userId);

  // If an object is selected, show only its threads
  if (selectedObjectId) {
    threads = threads.filter((t) => t.object_id === selectedObjectId);
  }

  // Separate orphaned threads (object deleted from canvas)
  const orphanedThreads = threads.filter((t) => !canvasObjects.has(t.object_id));
  threads = threads.filter((t) => canvasObjects.has(t.object_id));

  // Sort: newest activity first
  threads.sort((a, b) => (b.last_commented_at || b.created_at).localeCompare(a.last_commented_at || a.created_at));

  // ── API helpers ──

  const postReply = useCallback(async (threadId: string) => {
    if (!replyText.trim()) return;
    await fetch(`/api/boards/${boardId}/threads/${threadId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: replyText.trim() }),
    });
    setReplyText('');
  }, [boardId, token, replyText]);

  const resolveThread = useCallback(async (threadId: string, status: string) => {
    await fetch(`/api/boards/${boardId}/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
  }, [boardId, token]);

  const deleteComment = useCallback(async (threadId: string, commentId: string) => {
    await fetch(`/api/boards/${boardId}/threads/${threadId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [boardId, token]);

  const toggleVote = useCallback(async (objectId: string) => {
    await fetch(`/api/boards/${boardId}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ object_id: objectId }),
    });
  }, [boardId, token]);

  const createThread = useCallback(async () => {
    if (!newCommentText.trim() || !selectedObjectId) return;
    await fetch(`/api/boards/${boardId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        object_id: selectedObjectId,
        anchor_type: 'object',
        content: newCommentText.trim(),
      }),
    });
    setNewCommentText('');
  }, [boardId, token, newCommentText, selectedObjectId]);

  // ── Collapsed state ──

  if (collapsed) {
    return (
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '28px',
        background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8px',
      }}>
        <button onClick={() => setCollapsed(false)} style={{
          background: 'none', border: 'none', color: '#777', cursor: 'pointer', padding: '2px',
        }} title="Open feedback panel">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3-3h7a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H2z"/>
          </svg>
        </button>
      </div>
    );
  }

  // ── Expanded thread view ──

  const expandedThread = expandedThreadId ? annotationStore.threads.get(expandedThreadId) : null;

  if (expandedThread) {
    return (
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '280px',
        background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
        display: 'flex', flexDirection: 'column', userSelect: 'none',
      }}>
        {/* Header */}
        <div style={{ padding: '8px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setExpandedThreadId(null)} style={{
            background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: '12px',
          }}>Back</button>
          <span style={{ color: '#aaa', fontSize: '12px', flex: 1 }}>
            {expandedThread.status === 'resolved' ? 'Resolved' : 'Open'}
          </span>
          <button onClick={() => toggleVote(expandedThread.object_id)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: annotationStore.hasVoted(expandedThread.object_id, userId) ? '#4a9eff' : '#444',
            fontSize: '11px',
          }}>
            {annotationStore.getVoteCount(expandedThread.object_id) > 0
              ? `+${annotationStore.getVoteCount(expandedThread.object_id)}`
              : '+'}
          </button>
          {onJumpToObject && (
            <button onClick={() => onJumpToObject(expandedThread.object_id)} style={{
              background: 'none', border: 'none', color: '#4a9eff', cursor: 'pointer', fontSize: '10px',
            }}>Jump</button>
          )}
          {expandedThread.status === 'open' ? (
            <button onClick={() => resolveThread(expandedThread.id, 'resolved')} style={{
              background: '#1a3a1a', border: 'none', borderRadius: '4px', color: '#4ade80',
              padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
            }}>Resolve</button>
          ) : (
            <button onClick={() => resolveThread(expandedThread.id, 'open')} style={{
              background: '#1a1a3a', border: 'none', borderRadius: '4px', color: '#77a',
              padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
            }}>Reopen</button>
          )}
        </div>

        {/* Comments */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {expandedThread.comments.map((c) => (
            <div key={c.id} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ color: '#ddd', fontSize: '12px', fontWeight: 600 }}>{c.author_name}</span>
                <span style={{ color: '#555', fontSize: '10px' }}>
                  {new Date(c.created_at).toLocaleString()}
                </span>
                {c.edited_at && <span style={{ color: '#555', fontSize: '10px' }}>(edited)</span>}
              </div>
              <div style={{ color: '#bbb', fontSize: '13px', lineHeight: '1.4' }}>{c.content}</div>
              {c.user_id === userId && (
                <button onClick={() => deleteComment(expandedThread.id, c.id)} style={{
                  background: 'none', border: 'none', color: '#644', cursor: 'pointer', fontSize: '10px', marginTop: '2px',
                }}>Delete</button>
              )}
            </div>
          ))}
        </div>

        {/* Reply input */}
        <div style={{ padding: '8px', borderTop: '1px solid #1a1a1a' }}>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply..."
            rows={2}
            style={{
              width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px',
              color: '#ddd', padding: '6px', fontSize: '12px', resize: 'none', boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                postReply(expandedThread.id);
              }
            }}
          />
          <button onClick={() => postReply(expandedThread.id)} style={{
            marginTop: '4px', background: '#2a3a50', border: 'none', borderRadius: '4px',
            color: '#4a9eff', padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
          }}>Reply</button>
        </div>
      </div>
    );
  }

  // ── Thread list view ──

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: '280px',
      background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
      display: 'flex', flexDirection: 'column', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{ padding: '8px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#ddd', fontSize: '13px', fontWeight: 600 }}>
          Feedback
          {allThreads.filter((t) => t.status === 'open').length > 0 && (
            <span style={{ color: '#e44', fontSize: '11px', fontWeight: 400, marginLeft: '6px' }}>
              {allThreads.filter((t) => t.status === 'open').length} open
            </span>
          )}
        </span>
        <button onClick={() => setCollapsed(true)} style={{
          background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '14px',
        }}>x</button>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '4px' }}>
        {(['unresolved', 'all', 'mine'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? '#2a3a50' : 'transparent',
            border: 'none', borderRadius: '4px', color: filter === f ? '#4a9eff' : '#555',
            padding: '2px 8px', cursor: 'pointer', fontSize: '11px', textTransform: 'capitalize',
          }}>{f}</button>
        ))}
      </div>

      {/* New comment input (when object selected) */}
      {selectedObjectId && (
        <div style={{ padding: '8px', borderBottom: '1px solid #1a1a1a' }}>
          <div style={{ color: '#666', fontSize: '10px', marginBottom: '4px' }}>
            Comment on: {canvasObjects.get(selectedObjectId)?.name || canvasObjects.get(selectedObjectId)?.type || selectedObjectId.slice(0, 8)}
          </div>
          <textarea
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            style={{
              width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px',
              color: '#ddd', padding: '6px', fontSize: '12px', resize: 'none', boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createThread();
            }}
          />
          <button onClick={createThread} disabled={!newCommentText.trim()} style={{
            marginTop: '4px', background: newCommentText.trim() ? '#2a3a50' : '#1a1a1a',
            border: 'none', borderRadius: '4px',
            color: newCommentText.trim() ? '#4a9eff' : '#444',
            padding: '4px 12px', cursor: newCommentText.trim() ? 'pointer' : 'default', fontSize: '12px',
          }}>Comment</button>
        </div>
      )}

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {threads.length === 0 && !selectedObjectId && (
          <div style={{ padding: '16px', color: '#444', fontSize: '12px', textAlign: 'center' }}>
            No threads yet
          </div>
        )}
        {threads.length === 0 && selectedObjectId && (
          <div style={{ padding: '16px', color: '#444', fontSize: '12px', textAlign: 'center' }}>
            No comments on this object
          </div>
        )}
        {threads.map((t) => {
          const obj = canvasObjects.get(t.object_id);
          const firstComment = t.comments[0];
          return (
            <div
              key={t.id}
              onClick={() => setExpandedThreadId(t.id)}
              style={{
                padding: '8px', borderBottom: '1px solid #1a1a1a', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#1a1a1a'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: t.status === 'open' ? '#e44' : '#666', flexShrink: 0,
                }} />
                <span style={{ color: '#aaa', fontSize: '11px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {obj?.name || obj?.type || t.object_id.slice(0, 8)}
                </span>
                <span style={{ color: '#555', fontSize: '10px' }}>{t.comment_count}</span>
                <button onClick={(e) => { e.stopPropagation(); toggleVote(t.object_id); }} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                  color: annotationStore.hasVoted(t.object_id, userId) ? '#4a9eff' : '#444',
                  fontSize: '11px', flexShrink: 0,
                }}>
                  {annotationStore.getVoteCount(t.object_id) > 0
                    ? `+${annotationStore.getVoteCount(t.object_id)}`
                    : '+'}
                </button>
              </div>
              {firstComment && (
                <div style={{ color: '#777', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {firstComment.author_name}: {firstComment.content}
                </div>
              )}
            </div>
          );
        })}

        {/* Orphaned threads (deleted objects) */}
        {orphanedThreads.length > 0 && (
          <div>
            <div onClick={() => setShowOrphans(!showOrphans)} style={{
              padding: '8px', cursor: 'pointer', color: '#555', fontSize: '11px',
              borderTop: '1px solid #1a1a1a',
            }}>
              {showOrphans ? 'v' : '>'} Deleted items ({orphanedThreads.length})
            </div>
            {showOrphans && orphanedThreads.map((t) => {
              const firstComment = t.comments[0];
              return (
                <div key={t.id} onClick={() => setExpandedThreadId(t.id)} style={{
                  padding: '8px', borderBottom: '1px solid #1a1a1a', cursor: 'pointer', opacity: 0.5,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#444', flexShrink: 0 }} />
                    <span style={{ color: '#666', fontSize: '11px', flex: 1 }}>{t.object_id.slice(0, 8)}...</span>
                    <span style={{ color: '#555', fontSize: '10px' }}>{t.comment_count}</span>
                  </div>
                  {firstComment && (
                    <div style={{ color: '#555', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {firstComment.author_name}: {firstComment.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
