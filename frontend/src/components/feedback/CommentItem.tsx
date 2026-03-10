import React from 'react';
import { Comment } from '../../stores/annotationStore';
import { getAuthorColor, getAuthorInitial } from '../../utils/authorColors';
import { relativeTime } from '../../utils/relativeTime';
import { TEXT_PRIMARY, TEXT_MUTED, BORDER } from './feedbackStyles';

interface CommentItemProps {
  comment: Comment;
  isOwn: boolean;
  onDelete?: () => void;
}

export default function CommentItem({ comment, isOwn, onDelete }: CommentItemProps) {
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span
          style={{
            width: '22px',
            height: '22px',
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
        <span style={{ color: TEXT_PRIMARY, fontSize: '12px', fontWeight: 600 }}>
          {comment.author_name}
        </span>
        <span style={{ color: TEXT_MUTED, fontSize: '10px' }}>
          {relativeTime(comment.created_at)}
        </span>
        {comment.edited_at && (
          <span style={{ color: TEXT_MUTED, fontSize: '10px' }}>(edited)</span>
        )}
        <div style={{ flex: 1 }} />
        {isOwn && onDelete && (
          <button
            onClick={onDelete}
            style={{
              background: 'none',
              border: 'none',
              color: '#633',
              cursor: 'pointer',
              fontSize: '10px',
              opacity: 0.6,
              transition: 'opacity 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
          >
            Delete
          </button>
        )}
      </div>
      <div
        style={{
          color: '#ccc',
          fontSize: '13px',
          lineHeight: 1.5,
          marginLeft: '30px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {comment.content}
      </div>
    </div>
  );
}
