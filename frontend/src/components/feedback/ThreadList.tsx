import React from 'react';
import { Thread, AnnotationStore } from '../../stores/annotationStore';
import ThreadListItem from './ThreadListItem';
import CommentInput from './CommentInput';
import {
  PANEL_BG,
  PANEL_WIDTH,
  BORDER,
  TEXT_PRIMARY,
  TEXT_MUTED,
  STATUS_OPEN,
  FILTER_ACTIVE_BG,
} from './feedbackStyles';

export type FilterType = 'open' | 'resolved' | 'all' | 'mine';

interface ThreadListProps {
  threads: Thread[];
  orphanedThreads: Thread[];
  store: AnnotationStore;
  openCount: number;
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
  onSelectThread: (id: string) => void;
  onCollapse: () => void;
  // New comment
  selectedObjectId: string | null;
  selectedObjectLabel: string;
  newCommentText: string;
  onNewCommentChange: (text: string) => void;
  onCreateThread: () => void;
}

export default function ThreadList({
  threads,
  orphanedThreads,
  store,
  openCount,
  filter,
  onFilterChange,
  onSelectThread,
  onCollapse,
  selectedObjectId,
  selectedObjectLabel,
  newCommentText,
  onNewCommentChange,
  onCreateThread,
}: ThreadListProps) {
  const [showOrphans, setShowOrphans] = React.useState(false);

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
          padding: '12px 14px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ color: TEXT_PRIMARY, fontSize: '14px', fontWeight: 600, flex: 1 }}>
          Feedback
        </span>
        {openCount > 0 && (
          <span
            style={{
              background: STATUS_OPEN,
              color: '#fff',
              fontSize: '11px',
              fontWeight: 600,
              padding: '1px 7px',
              borderRadius: '10px',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {openCount}
          </span>
        )}
        <button
          onClick={onCollapse}
          style={{
            background: 'none',
            border: 'none',
            color: TEXT_MUTED,
            cursor: 'pointer',
            fontSize: '16px',
            lineHeight: 1,
            padding: '2px',
          }}
        >
          &times;
        </button>
      </div>

      {/* Filter bar */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          gap: '6px',
        }}
      >
        {(['open', 'resolved', 'all', 'mine'] as const).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            style={{
              background: filter === f ? FILTER_ACTIVE_BG : 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: filter === f ? '#fff' : TEXT_MUTED,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: filter === f ? 600 : 400,
              textTransform: 'capitalize',
              transition: 'all 0.1s ease',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* New comment input (when object selected) */}
      {selectedObjectId && (
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ color: TEXT_MUTED, fontSize: '10px', marginBottom: '6px' }}>
            Comment on: <span style={{ color: TEXT_PRIMARY }}>{selectedObjectLabel}</span>
          </div>
          <CommentInput
            value={newCommentText}
            onChange={onNewCommentChange}
            onSubmit={onCreateThread}
            placeholder="Add a comment..."
            submitLabel="Comment"
          />
        </div>
      )}

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {threads.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 14 14"
              fill="none"
              stroke="#333"
              strokeWidth="1"
              style={{ marginBottom: '12px' }}
            >
              <path d="M2 2.5A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5v6A1.5 1.5 0 0110.5 10H6l-3 3v-3H3.5A1.5 1.5 0 012 8.5v-6z" />
            </svg>
            <div style={{ color: TEXT_MUTED, fontSize: '12px', lineHeight: 1.5 }}>
              {selectedObjectId
                ? 'No comments on this item.'
                : 'No comments yet.\nSelect an image and add a comment.'}
            </div>
          </div>
        )}
        {threads.map((t) => (
          <ThreadListItem
            key={t.id}
            thread={t}
            pinNumber={store.getPinNumber(t.id)}
            onClick={() => onSelectThread(t.id)}
          />
        ))}

        {/* Orphaned threads (deleted objects) */}
        {orphanedThreads.length > 0 && (
          <div>
            <div
              onClick={() => setShowOrphans(!showOrphans)}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                color: TEXT_MUTED,
                fontSize: '11px',
                borderTop: `1px solid ${BORDER}`,
                transition: 'background 0.1s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#151515')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {showOrphans ? '\u25BE' : '\u25B8'} Deleted items ({orphanedThreads.length})
            </div>
            {showOrphans &&
              orphanedThreads.map((t) => (
                <ThreadListItem
                  key={t.id}
                  thread={t}
                  pinNumber={store.getPinNumber(t.id)}
                  onClick={() => onSelectThread(t.id)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
