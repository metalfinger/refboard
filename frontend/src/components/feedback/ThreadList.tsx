import React from 'react';
import { Thread, AnnotationStore } from '../../stores/annotationStore';
import ThreadListItem from './ThreadListItem';
import CommentInput from './CommentInput';
import {
  panelContainerStyle,
  BORDER,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  STATUS_OPEN,
  FILTER_ACTIVE_BG,
  ACCENT,
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
    <div style={panelContainerStyle}>
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke={TEXT_SECONDARY} strokeWidth="1.2" style={{ flexShrink: 0 }}>
          <path d="M2 2.5A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5v6A1.5 1.5 0 0110.5 10H6l-3 3v-3H3.5A1.5 1.5 0 012 8.5v-6z" />
        </svg>
        <span style={{ color: TEXT_PRIMARY, fontSize: '13px', fontWeight: 600, flex: 1, letterSpacing: '0.3px' }}>
          Feedback
        </span>
        {openCount > 0 && (
          <span
            style={{
              background: STATUS_OPEN,
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '10px',
              minWidth: '18px',
              textAlign: 'center',
              lineHeight: '14px',
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
            padding: '2px 4px',
            borderRadius: '4px',
            transition: 'color 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = TEXT_PRIMARY)}
          onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_MUTED)}
        >
          &times;
        </button>
      </div>

      {/* Filter bar */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          gap: '4px',
        }}
      >
        {(['open', 'resolved', 'all', 'mine'] as const).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            style={{
              background: filter === f ? FILTER_ACTIVE_BG : 'transparent',
              border: filter === f ? `1px solid ${BORDER}` : '1px solid transparent',
              borderRadius: '6px',
              color: filter === f ? TEXT_PRIMARY : TEXT_MUTED,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: filter === f ? 600 : 400,
              textTransform: 'capitalize',
              transition: 'all 0.15s ease',
              lineHeight: '16px',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* New comment input (when object selected) */}
      {selectedObjectId && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, background: 'rgba(74, 158, 255, 0.03)' }}>
          <div style={{ color: TEXT_MUTED, fontSize: '10px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Comment on
          </div>
          <div style={{ color: TEXT_PRIMARY, fontSize: '12px', marginBottom: '10px', fontWeight: 500 }}>
            {selectedObjectLabel}
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
      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#2a2a2e transparent' }}>
        {threads.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(74, 158, 255, 0.06)', border: `1px solid rgba(74, 158, 255, 0.1)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke={TEXT_MUTED} strokeWidth="1">
                <path d="M2 2.5A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5v6A1.5 1.5 0 0110.5 10H6l-3 3v-3H3.5A1.5 1.5 0 012 8.5v-6z" />
              </svg>
            </div>
            <div style={{ color: TEXT_MUTED, fontSize: '12px', lineHeight: 1.6 }}>
              {selectedObjectId
                ? 'No comments on this item.'
                : <>No comments yet.<br /><span style={{ color: TEXT_SECONDARY }}>Select an image to leave feedback.</span></>}
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
                padding: '10px 16px',
                cursor: 'pointer',
                color: TEXT_MUTED,
                fontSize: '11px',
                borderTop: `1px solid ${BORDER}`,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#16161a')}
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
