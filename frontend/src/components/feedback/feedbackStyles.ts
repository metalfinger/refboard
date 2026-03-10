// Design tokens for the feedback/annotation system
export const PANEL_WIDTH = 320;
export const PANEL_BG = 'rgba(12, 12, 14, 0.95)';
export const PANEL_BG_SOLID = '#0c0c0e';
export const BORDER = '#1a1a1e';

export const TEXT_PRIMARY = '#eaeaea';
export const TEXT_SECONDARY = '#a0a0a8';
export const TEXT_MUTED = '#5a5a64';

export const ACCENT = '#4a9eff';
export const STATUS_OPEN = '#f04848';
export const STATUS_RESOLVED = '#34d27b';

export const INPUT_BG = '#131316';
export const INPUT_BORDER = '#26262c';
export const INPUT_BORDER_FOCUS = '#4a9eff44';
export const HOVER_BG = '#16161a';
export const FILTER_ACTIVE_BG = '#1e1e24';

// Shared panel container style
export const panelContainerStyle: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: `${PANEL_WIDTH}px`,
  background: PANEL_BG,
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderLeft: `1px solid ${BORDER}`,
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  userSelect: 'none',
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
};

// Import this in components that need React.CSSProperties type
import type React from 'react';
