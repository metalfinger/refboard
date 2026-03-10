import React, { useState } from 'react';
import { Thread, AnnotationStore } from '../../stores/annotationStore';
import CommentItem from './CommentItem';
import CommentInput from './CommentInput';
import {
  panelContainerStyle,
  BORDER,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  ACCENT,
  HOVER_BG,
  STATUS_OPEN,
  STATUS_RESOLVED,
} from './feedbackStyles';

interface ThreadDetailProps {
  thread: Thread;
  store: AnnotationStore;
  userId: string;
  onBack: () => void;
  onReply: (threadId: string, content: string) => Promise<void>;
  onResolve: (threadId: string, status: string) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onDeleteThread: (threadId: string) => Promise<void>;
  onJumpToObject?: (objectId: string) => void;
}

export default function ThreadDetail({
  thread,
  store,
  userId,
  onBack,
  onReply,
  onResolve,
  onDeleteComment,
  onDeleteThread,
  onJumpToObject,
}: ThreadDetailProps) {
  const [replyText, setReplyText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pinNumber = store.getPinNumber(thread.id);
  const isOpen = thread.status === 'open';
  const isOwner = thread.created_by === userId;

  const handleReply = async () => {
    if (!replyText.trim()) return;
    await onReply(thread.id, replyText.trim());
    setReplyText('');
  };

  const handleDeleteThread = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await onDeleteThread(thread.id);
  };

  return (
    <div style={panelContainerStyle}>
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: TEXT_MUTED,
            cursor: 'pointer',
            fontSize: '16px',
            padding: '2px 4px',
            borderRadius: '4px',
            transition: 'color 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = TEXT_PRIMARY)}
          onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_MUTED)}
        >
          &larr;
        </button>
        <span style={{ color: TEXT_SECONDARY, fontSize: '11px', fontFamily: 'monospace', fontWeight: 500 }}>
          #{pinNumber}
        </span>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '10px',
            background: isOpen ? 'rgba(240, 72, 72, 0.1)' : 'rgba(52, 210, 123, 0.1)',
            color: isOpen ? STATUS_OPEN : STATUS_RESOLVED,
            letterSpacing: '0.3px',
          }}
        >
          {isOpen ? 'Open' : 'Resolved'}
        </span>
        <div style={{ flex: 1 }} />
        {onJumpToObject && (
          <button
            onClick={() => onJumpToObject(thread.object_id)}
            style={{
              background: 'rgba(74, 158, 255, 0.08)',
              border: `1px solid rgba(74, 158, 255, 0.15)`,
              borderRadius: '6px',
              color: ACCENT,
              cursor: 'pointer',
              fontSize: '11px',
              padding: '4px 10px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(74, 158, 255, 0.15)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(74, 158, 255, 0.08)')}
          >
            Jump
          </button>
        )}
        {isOpen ? (
          <button
            onClick={() => onResolve(thread.id, 'resolved')}
            style={{
              background: 'rgba(52, 210, 123, 0.1)',
              border: `1px solid rgba(52, 210, 123, 0.15)`,
              borderRadius: '6px',
              color: STATUS_RESOLVED,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(52, 210, 123, 0.18)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(52, 210, 123, 0.1)')}
          >
            Resolve
          </button>
        ) : (
          <button
            onClick={() => onResolve(thread.id, 'open')}
            style={{
              background: 'rgba(74, 158, 255, 0.08)',
              border: `1px solid rgba(74, 158, 255, 0.15)`,
              borderRadius: '6px',
              color: ACCENT,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(74, 158, 255, 0.15)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(74, 158, 255, 0.08)')}
          >
            Reopen
          </button>
        )}
        {/* Delete thread */}
        {isOwner &&
          (confirmDelete ? (
            <span style={{ fontSize: '11px', color: TEXT_MUTED, whiteSpace: 'nowrap' }}>
              Delete?{' '}
              <button
                onClick={handleDeleteThread}
                style={{
                  background: 'none',
                  border: 'none',
                  color: STATUS_OPEN,
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                Yes
              </button>{' '}
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: TEXT_MUTED,
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={handleDeleteThread}
              style={{
                background: 'none',
                border: 'none',
                color: TEXT_MUTED,
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 4px',
                borderRadius: '4px',
                opacity: 0.6,
                transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = STATUS_OPEN; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = TEXT_MUTED; }}
              title="Delete thread"
            >
              &times;
            </button>
          ))}
      </div>

      {/* Comments */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', scrollbarWidth: 'thin', scrollbarColor: '#2a2a2e transparent' }}>
        {thread.comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            isOwn={c.user_id === userId}
            onDelete={() => onDeleteComment(thread.id, c.id)}
          />
        ))}
      </div>

      {/* Reply input */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${BORDER}` }}>
        <CommentInput
          value={replyText}
          onChange={setReplyText}
          onSubmit={handleReply}
          placeholder="Reply..."
          submitLabel="Reply"
          autoFocus
        />
      </div>
    </div>
  );
}
