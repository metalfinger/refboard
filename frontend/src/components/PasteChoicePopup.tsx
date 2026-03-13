/**
 * PasteChoicePopup — floating popup for paste-as choice.
 * Shows "Text" / "Markdown" buttons (and optionally "Image").
 * Auto-dismisses after 5 seconds.
 */

import React, { useEffect } from 'react';

export type PasteChoice = 'text' | 'markdown' | 'image';

interface PasteChoicePopupProps {
  x: number;
  y: number;
  showImage?: boolean;
  onChoice: (choice: PasteChoice) => void;
  onDismiss: () => void;
}

export default function PasteChoicePopup(props: PasteChoicePopupProps) {
  const { x, y, showImage, onChoice, onDismiss } = props;

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  // Escape to dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const btnStyle: React.CSSProperties = {
    background: '#333',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#ccc',
    padding: '6px 14px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
    transition: 'background 0.1s',
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, -100%)',
        display: 'flex',
        gap: '4px',
        padding: '6px',
        background: 'rgba(22, 22, 22, 0.96)',
        border: '1px solid #333',
        borderRadius: '10px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        zIndex: 200,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Full-screen backdrop to block canvas interaction while popup is visible */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: -1,
      }} onClick={onDismiss} />
      <span style={{ color: '#666', fontSize: '11px', padding: '6px 4px', whiteSpace: 'nowrap' }}>Paste as:</span>
      {showImage && (
        <button
          style={btnStyle}
          onClick={() => onChoice('image')}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#444'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#333'; }}
        >
          Image
        </button>
      )}
      <button
        style={btnStyle}
        onClick={() => onChoice('text')}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#444'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#333'; }}
      >
        Text
      </button>
      <button
        style={{ ...btnStyle, background: '#7950f2', color: '#fff', borderColor: '#7950f2' }}
        onClick={() => onChoice('markdown')}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#6741d9'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#7950f2'; }}
      >
        Markdown
      </button>
    </div>
  );
}
