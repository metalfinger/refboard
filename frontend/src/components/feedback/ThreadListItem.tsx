import React from 'react';
import { Thread } from '../../stores/annotationStore';
import { getAuthorColor, getAuthorInitial } from '../../utils/authorColors';
import { relativeTime, fullTimestamp } from '../../utils/relativeTime';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  STATUS_OPEN,
  STATUS_RESOLVED,
  BORDER,
  HOVER_BG,
} from './feedbackStyles';

interface ThreadListItemProps {
  thread: Thread;
  pinNumber: number;
  onClick: () => void;
}

export default function ThreadListItem({ thread, pinNumber, onClick }: ThreadListItemProps) {
  const firstComment = thread.comments[0];
  const isResolved = thread.status === 'resolved';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${BORDER}`,
        cursor: 'pointer',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = HOVER_BG)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Row 1: author circle + name + timestamp */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: isResolved ? '#333' : getAuthorColor(thread.created_by),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
            opacity: isResolved ? 0.6 : 1,
          }}
        >
          {getAuthorInitial(firstComment?.author_name || '?')}
        </span>
        <span
          style={{
            color: isResolved ? TEXT_MUTED : TEXT_PRIMARY,
            fontSize: '12px',
            fontWeight: 600,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {firstComment?.author_name || 'Unknown'}
        </span>
        <span style={{ color: TEXT_MUTED, fontSize: '10px', flexShrink: 0 }} title={fullTimestamp(thread.last_commented_at || thread.created_at)}>
          {relativeTime(thread.last_commented_at || thread.created_at)}
        </span>
      </div>

      {/* Row 2: comment preview */}
      {firstComment && (
        <div
          style={{
            color: isResolved ? TEXT_MUTED : TEXT_SECONDARY,
            fontSize: '12px',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginLeft: '32px',
          }}
        >
          {firstComment.content}
        </div>
      )}

      {/* Row 3: meta — replies, status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '6px',
          marginLeft: '32px',
        }}
      >
        {thread.comment_count > 1 && (
          <span style={{ color: TEXT_MUTED, fontSize: '10px' }}>
            {thread.comment_count - 1} {thread.comment_count === 2 ? 'reply' : 'replies'}
          </span>
        )}
        <span
          style={{
            fontSize: '10px',
            fontWeight: 500,
            color: isResolved ? STATUS_RESOLVED : STATUS_OPEN,
            marginLeft: 'auto',
            textTransform: 'capitalize',
          }}
        >
          {thread.status}
        </span>
      </div>
    </div>
  );
}
