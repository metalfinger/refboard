import React from 'react';
import { Comment } from '../../stores/annotationStore';
import { getAuthorColor, getAuthorInitial } from '../../utils/authorColors';
import { relativeTime, fullTimestamp } from '../../utils/relativeTime';
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, BORDER, HOVER_BG } from './feedbackStyles';

interface CommentItemProps {
  comment: Comment;
  isOwn: boolean;
  onDelete?: () => void;
}

export default function CommentItem({ comment, isOwn, onDelete }: CommentItemProps) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      style={{
        padding: '12px 0',
        borderBottom: `1px solid ${BORDER}`,
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: getAuthorColor(comment.user_id),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {getAuthorInitial(comment.author_name)}
        </span>
        <span style={{ color: TEXT_PRIMARY, fontSize: '12px', fontWeight: 600, letterSpacing: '0.2px' }}>
          {comment.author_name}
        </span>
        <span style={{ color: TEXT_MUTED, fontSize: '10px' }} title={fullTimestamp(comment.created_at)}>
          {relativeTime(comment.created_at)}
        </span>
        {comment.edited_at && (
          <span style={{ color: TEXT_MUTED, fontSize: '10px', fontStyle: 'italic' }}>edited</span>
        )}
        <div style={{ flex: 1 }} />
        {isOwn && onDelete && hovered && (
          <button
            onClick={onDelete}
            style={{
              background: 'rgba(240, 72, 72, 0.08)',
              border: '1px solid rgba(240, 72, 72, 0.12)',
              borderRadius: '4px',
              color: TEXT_MUTED,
              cursor: 'pointer',
              fontSize: '10px',
              padding: '2px 6px',
              transition: 'all 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#f04848'; e.currentTarget.style.background = 'rgba(240, 72, 72, 0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TEXT_MUTED; e.currentTarget.style.background = 'rgba(240, 72, 72, 0.08)'; }}
          >
            Delete
          </button>
        )}
      </div>
      <div
        style={{
          color: TEXT_SECONDARY,
          fontSize: '13px',
          lineHeight: 1.5,
          marginLeft: '32px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {comment.content}
      </div>
    </div>
  );
}
