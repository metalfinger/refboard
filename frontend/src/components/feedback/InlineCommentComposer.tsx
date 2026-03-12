import React, { useRef, useEffect } from 'react';
import {
  PANEL_BG, BORDER, TEXT_PRIMARY, TEXT_MUTED, ACCENT,
  INPUT_BG, INPUT_BORDER, INPUT_BORDER_FOCUS,
} from './feedbackStyles';

interface InlineCommentComposerProps {
  visible: boolean;
  x: number;
  y: number;
  placement: 'right' | 'left';
  objectLabel?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting?: boolean;
  autoFocus?: boolean;
}

const COMPOSER_WIDTH = 260;
const OFFSET_X = 16;

export default function InlineCommentComposer({
  visible,
  x,
  y,
  placement,
  objectLabel,
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting = false,
  autoFocus = true,
}: InlineCommentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (visible && autoFocus && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [visible, autoFocus]);

  if (!visible) return null;

  const hasText = value.trim().length > 0;

  const left = placement === 'right' ? x + OFFSET_X : x - OFFSET_X - COMPOSER_WIDTH;
  const top = y - 30;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (hasText && !submitting) onSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${COMPOSER_WIDTH}px`,
        background: PANEL_BG,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `1px solid ${BORDER}`,
        borderRadius: '10px',
        padding: '12px',
        zIndex: 200,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {objectLabel && (
        <div style={{
          color: TEXT_MUTED,
          fontSize: '10px',
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {objectLabel}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment..."
        disabled={submitting}
        rows={2}
        style={{
          width: '100%',
          background: INPUT_BG,
          border: `1px solid ${INPUT_BORDER}`,
          borderRadius: '6px',
          color: TEXT_PRIMARY,
          fontSize: '12px',
          padding: '8px 10px',
          resize: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          boxSizing: 'border-box',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = INPUT_BORDER_FOCUS; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = INPUT_BORDER; }}
      />

      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '6px',
        marginTop: '8px',
      }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            background: 'transparent',
            border: `1px solid ${BORDER}`,
            borderRadius: '6px',
            color: TEXT_MUTED,
            fontSize: '11px',
            padding: '4px 10px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => { if (hasText && !submitting) onSubmit(); }}
          disabled={!hasText || submitting}
          style={{
            background: hasText && !submitting ? ACCENT : '#2a2a2e',
            border: 'none',
            borderRadius: '6px',
            color: hasText && !submitting ? '#fff' : TEXT_MUTED,
            fontSize: '11px',
            fontWeight: 600,
            padding: '4px 12px',
            cursor: hasText && !submitting ? 'pointer' : 'default',
            fontFamily: 'inherit',
            opacity: submitting ? 0.6 : 1,
            transition: 'background 0.15s, opacity 0.15s',
          }}
        >
          {submitting ? 'Posting...' : 'Comment'}
        </button>
      </div>

      <div style={{
        color: TEXT_MUTED,
        fontSize: '9px',
        marginTop: '6px',
        textAlign: 'right',
        opacity: 0.7,
      }}>
        Enter to submit · Shift+Enter for newline
      </div>
    </div>
  );
}
