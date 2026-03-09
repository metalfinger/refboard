import React, { useEffect, useRef } from 'react';

interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 1000,
    background: '#2a2a2a',
    border: '1px solid #3d3d3d',
    borderRadius: '8px',
    padding: '4px 0',
    minWidth: '180px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  };

  return (
    <div ref={ref} style={style}>
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} style={{ height: '1px', background: '#3d3d3d', margin: '4px 0' }} />;
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '6px 12px',
              background: 'transparent',
              border: 'none',
              color: item.disabled ? '#555' : item.danger ? '#ff6b6b' : '#ddd',
              fontSize: '12px',
              cursor: item.disabled ? 'default' : 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = '#363636';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ color: '#666', fontSize: '11px', marginLeft: '20px' }}>{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
