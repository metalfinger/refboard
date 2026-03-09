import React from 'react';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

interface StatusBarProps {
  boardName: string;
  imageCount: number;
  saveStatus: SaveStatus;
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 16px',
    background: '#2d2d2d',
    borderTop: '1px solid #3d3d3d',
    fontSize: '12px',
    color: '#888',
    flexShrink: 0,
    height: '28px',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  name: {
    color: '#aaa',
    fontWeight: 500,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    display: 'inline-block',
  },
};

const statusConfig: Record<SaveStatus, { label: string; color: string }> = {
  saved: { label: 'Saved', color: '#69db7c' },
  saving: { label: 'Saving...', color: '#ffd43b' },
  unsaved: { label: 'Unsaved changes', color: '#ff6b6b' },
};

export default function StatusBar({ boardName, imageCount, saveStatus }: StatusBarProps) {
  const status = statusConfig[saveStatus];

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <span style={styles.name}>{boardName}</span>
        <span>{imageCount} image{imageCount !== 1 ? 's' : ''}</span>
      </div>
      <div style={styles.right}>
        <span style={{ ...styles.dot, background: status.color }} />
        <span>{status.label}</span>
      </div>
    </div>
  );
}
