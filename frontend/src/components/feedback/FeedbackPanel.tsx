import React, { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { AnnotationStore } from '../../stores/annotationStore';
import ThreadList, { FilterType } from './ThreadList';
import ThreadDetail from './ThreadDetail';
import CommentInput from './CommentInput';
import { PANEL_BG, BORDER, TEXT_MUTED, TEXT_PRIMARY, STATUS_OPEN } from './feedbackStyles';
import type { DraftPin } from '../../pages/Editor';

interface FeedbackPanelProps {
  annotationStore: AnnotationStore;
  selectedObjectId: string | null;
  userId: string;
  boardId: string;
  token: string;
  canvasObjects: Map<string, { id: string; name?: string; type: string }>;
  onJumpToObject?: (objectId: string, thread?: any) => void;
  onError?: (msg: string) => void;
  /** Pulse signal to expand a specific thread */
  expandRequest?: { threadId: string | null; seq: number } | null;
  /** Focused thread ID for highlighting */
  focusedThreadId?: string | null;
  /** Draft pin for point-comment creation */
  draftPin?: DraftPin | null;
  /** Callback to create a point-pinned thread */
  onCreatePointThread?: (draftPin: DraftPin, content: string) => Promise<void>;
  /** Callback when expanded thread detail changes */
  onThreadDetailChange?: (threadId: string | null) => void;
}

export default function FeedbackPanel({
  annotationStore,
  selectedObjectId,
  userId,
  boardId,
  token,
  canvasObjects,
  onJumpToObject,
  onError,
  expandRequest,
  focusedThreadId,
  draftPin,
  onCreatePointThread,
  onThreadDetailChange,
}: FeedbackPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('open');
  const [newCommentText, setNewCommentText] = useState('');

  // Subscribe to store changes
  const _version = useSyncExternalStore(
    (cb) => annotationStore.subscribe(cb),
    () => annotationStore.version,
  );

  // Wrap setExpandedThreadId to notify parent
  const updateExpandedThread = useCallback((id: string | null) => {
    setExpandedThreadId(id);
    onThreadDetailChange?.(id);
  }, [onThreadDetailChange]);

  // External expand trigger (from pin click or submit)
  useEffect(() => {
    if (!expandRequest) return;
    if (expandRequest.threadId) {
      // Open/expand a specific thread
      updateExpandedThread(expandRequest.threadId);
      setCollapsed(false);
    } else {
      // Collapse signal (threadId: null) — close thread detail
      updateExpandedThread(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandRequest?.seq]);

  const allThreads = Array.from(annotationStore.threads.values());
  const openCount = allThreads.filter((t) => t.status === 'open').length;

  // Apply filter
  let threads = allThreads;
  if (filter === 'open') threads = threads.filter((t) => t.status === 'open');
  if (filter === 'resolved') threads = threads.filter((t) => t.status === 'resolved');
  if (filter === 'mine') threads = threads.filter((t) => t.created_by === userId);

  // If an object is selected, show only its threads
  if (selectedObjectId) {
    threads = threads.filter((t) => t.object_id === selectedObjectId);
  }

  // Separate orphaned threads
  const orphanedThreads = threads.filter((t) => !canvasObjects.has(t.object_id));
  threads = threads.filter((t) => canvasObjects.has(t.object_id));

  // Sort: newest activity first
  threads.sort(
    (a, b) =>
      (b.last_commented_at || b.created_at).localeCompare(a.last_commented_at || a.created_at),
  );

  // ── API helpers ──

  const apiFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error || `Request failed (${res.status})`;
        onError?.(msg);
        throw new Error(msg);
      }
      return res;
    },
    [onError],
  );

  const headers = useCallback(
    (json = true) => {
      const h: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (json) h['Content-Type'] = 'application/json';
      return h;
    },
    [token],
  );

  const handleReply = useCallback(
    async (threadId: string, content: string) => {
      try {
        await apiFetch(`/api/boards/${boardId}/threads/${threadId}/comments`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ content }),
        });
      } catch {
        // Error surfaced via onError
      }
    },
    [boardId, headers, apiFetch],
  );

  const handleResolve = useCallback(
    async (threadId: string, status: string) => {
      try {
        await apiFetch(`/api/boards/${boardId}/threads/${threadId}`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ status }),
        });
      } catch {
        // Error surfaced via onError
      }
    },
    [boardId, headers, apiFetch],
  );

  const handleDeleteComment = useCallback(
    async (threadId: string, commentId: string) => {
      try {
        await apiFetch(`/api/boards/${boardId}/threads/${threadId}/comments/${commentId}`, {
          method: 'DELETE',
          headers: headers(false),
        });
      } catch {
        // Error surfaced via onError
      }
    },
    [boardId, headers, apiFetch],
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      try {
        await apiFetch(`/api/boards/${boardId}/threads/${threadId}`, {
          method: 'DELETE',
          headers: headers(false),
        });
        updateExpandedThread(null);
      } catch {
        // Error surfaced via onError
      }
    },
    [boardId, headers, apiFetch, updateExpandedThread],
  );

  const handleCreateThread = useCallback(async () => {
    if (!newCommentText.trim() || !selectedObjectId) return;
    try {
      await apiFetch(`/api/boards/${boardId}/threads`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          object_id: selectedObjectId,
          anchor_type: 'object',
          content: newCommentText.trim(),
        }),
      });
      setNewCommentText('');
    } catch {
      // Error surfaced via onError
    }
  }, [boardId, newCommentText, selectedObjectId, headers, apiFetch]);

  // ── Collapsed state ──

  if (collapsed) {
    return (
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '32px',
          background: PANEL_BG,
          borderLeft: `1px solid ${BORDER}`,
          zIndex: 100,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '10px',
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: 'none',
            border: 'none',
            color: TEXT_MUTED,
            cursor: 'pointer',
            padding: '4px',
            position: 'relative',
          }}
          title="Open feedback panel"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          >
            <path d="M2 2.5A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5v6A1.5 1.5 0 0110.5 10H6l-3 3v-3H3.5A1.5 1.5 0 012 8.5v-6z" />
          </svg>
          {openCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 0,
                right: -2,
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: STATUS_OPEN,
              }}
            />
          )}
        </button>
      </div>
    );
  }

  // ── Expanded thread detail ──

  const expandedThread = expandedThreadId
    ? annotationStore.threads.get(expandedThreadId)
    : null;

  if (expandedThread) {
    return (
      <ThreadDetail
        thread={expandedThread}
        store={annotationStore}
        userId={userId}
        onBack={() => updateExpandedThread(null)}
        onReply={handleReply}
        onResolve={handleResolve}
        onDeleteComment={handleDeleteComment}
        onDeleteThread={handleDeleteThread}
        onJumpToObject={onJumpToObject ? (objectId) => onJumpToObject(objectId, expandedThread) : undefined}
      />
    );
  }

  // ── Thread list ──

  const selectedLabel =
    canvasObjects.get(selectedObjectId || '')?.name ||
    canvasObjects.get(selectedObjectId || '')?.type ||
    selectedObjectId?.slice(0, 8) ||
    '';

  // Draft pin comment input (shown above thread list when draft is active)
  const draftCommentSection = draftPin ? (
    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, background: 'rgba(249, 115, 22, 0.03)' }}>
      <div style={{ color: TEXT_MUTED, fontSize: '10px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Comment on point
      </div>
      <div style={{ color: TEXT_PRIMARY, fontSize: '12px', marginBottom: '10px', fontWeight: 500 }}>
        {canvasObjects.get(draftPin.objectId)?.name || canvasObjects.get(draftPin.objectId)?.type || 'Object'}
      </div>
      <CommentInput
        value={newCommentText}
        onChange={setNewCommentText}
        onSubmit={async () => {
          if (!newCommentText.trim() || !onCreatePointThread || !draftPin) return;
          await onCreatePointThread(draftPin, newCommentText.trim());
          setNewCommentText('');
        }}
        placeholder="Add a point comment..."
        submitLabel="Comment"
        autoFocus
      />
    </div>
  ) : null;

  return (
    <ThreadList
      threads={threads}
      orphanedThreads={orphanedThreads}
      store={annotationStore}
      openCount={openCount}
      filter={filter}
      onFilterChange={setFilter}
      onSelectThread={updateExpandedThread}
      onCollapse={() => setCollapsed(true)}
      selectedObjectId={draftPin ? null : selectedObjectId}
      selectedObjectLabel={selectedLabel}
      newCommentText={newCommentText}
      onNewCommentChange={setNewCommentText}
      onCreateThread={handleCreateThread}
      headerSlot={draftCommentSection}
      focusedThreadId={focusedThreadId}
    />
  );
}
