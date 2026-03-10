import React, { useRef, useEffect } from 'react';
import { ACCENT, INPUT_BG, INPUT_BORDER, INPUT_BORDER_FOCUS, TEXT_PRIMARY } from './feedbackStyles';

interface CommentInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
}

export default function CommentInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Add a comment...',
  submitLabel = 'Post',
  autoFocus = false,
}: CommentInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  const hasText = value.trim().length > 0;

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${placeholder} (Enter to send)`}
        rows={2}
        style={{
          width: '100%',
          background: INPUT_BG,
          border: `1px solid ${INPUT_BORDER}`,
          borderRadius: '8px',
          color: TEXT_PRIMARY,
          padding: '8px 10px',
          fontSize: '12px',
          resize: 'none',
          boxSizing: 'border-box',
          lineHeight: 1.4,
          outline: 'none',
          transition: 'border-color 0.1s ease',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = INPUT_BORDER_FOCUS)}
        onBlur={(e) => (e.currentTarget.style.borderColor = INPUT_BORDER)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (hasText) onSubmit();
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
        <button
          onClick={() => { if (hasText) onSubmit(); }}
          disabled={!hasText}
          style={{
            background: hasText ? ACCENT : '#1a1a1a',
            border: 'none',
            borderRadius: '6px',
            color: hasText ? '#fff' : '#444',
            padding: '5px 14px',
            cursor: hasText ? 'pointer' : 'default',
            fontSize: '12px',
            fontWeight: 500,
            transition: 'all 0.1s ease',
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
