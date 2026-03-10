import React, { useState } from 'react';
import { Thread, AnnotationStore } from '../../stores/annotationStore';
import CommentItem from './CommentItem';
import CommentInput from './CommentInput';
import {
  PANEL_BG,
  PANEL_WIDTH,
  BORDER,
  TEXT_PRIMARY,
  TEXT_MUTED,
  ACCENT,
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
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: `${PANEL_WIDTH}px`,
        background: PANEL_BG,
        borderLeft: `1px solid ${BORDER}`,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
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
            fontSize: '14px',
            padding: '2px',
          }}
        >
          &larr;
        </button>
        <span style={{ color: TEXT_MUTED, fontSize: '11px', fontFamily: 'monospace' }}>
          #{pinNumber}
        </span>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '10px',
            background: isOpen ? '#2a1515' : '#152a15',
            color: isOpen ? STATUS_OPEN : STATUS_RESOLVED,
          }}
        >
          {isOpen ? 'Open' : 'Resolved'}
        </span>
        <div style={{ flex: 1 }} />
        {onJumpToObject && (
          <button
            onClick={() => onJumpToObject(thread.object_id)}
            style={{
              background: 'none',
              border: 'none',
              color: ACCENT,
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Jump
          </button>
        )}
        {isOpen ? (
          <button
            onClick={() => onResolve(thread.id, 'resolved')}
            style={{
              background: '#152a15',
              border: 'none',
              borderRadius: '6px',
              color: STATUS_RESOLVED,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Resolve
          </button>
        ) : (
          <button
            onClick={() => onResolve(thread.id, 'open')}
            style={{
              background: '#1a1a2a',
              border: 'none',
              borderRadius: '6px',
              color: '#88f',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
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
                color: '#633',
                cursor: 'pointer',
                fontSize: '13px',
                padding: '2px',
              }}
              title="Delete thread"
            >
              &times;
            </button>
          ))}
      </div>

      {/* Comments */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px' }}>
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
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER}` }}>
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
