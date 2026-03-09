import React from 'react';
import { ToolType } from '../canvas/tools';
import ColorPicker from './ColorPicker';

interface OnlineUser {
  userId: string;
  displayName: string;
  color: string;
}

interface ToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  zoom: number;
  onFitAll: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onlineUsers: OnlineUser[];
  onUserClick?: (userId: string, displayName: string) => void;
  followingUserId?: string | null;
  onShareClick?: () => void;
  onToggleLayers?: () => void;
  showLayers?: boolean;
  onToggleHelp?: () => void;
  onMmImport?: () => void;
  boardName?: string;
}

// SVG icon components
function IconSelect() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2L3 13L7 9.5L11 13.5L13 11.5L9 7.5L13 4L3 2Z" />
    </svg>
  );
}

function IconPan() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1v14M1 8h14M4 4L8 1L12 4M4 12L8 15L12 12M1 4L4 8L1 12M15 4L12 8L15 12" strokeLinejoin="round" />
    </svg>
  );
}

function IconPen() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 14L3.5 8.5L11 1L15 5L7.5 12.5L2 14Z" strokeLinejoin="round" />
      <path d="M3.5 8.5L7.5 12.5" />
    </svg>
  );
}

function IconText() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3h10M8 3v11M5 14h6" strokeLinecap="round" />
    </svg>
  );
}

function IconEraser() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6.5 14H14M2 10l4.5-4.5 4 4L6 14H3l-1-1v-3z" strokeLinejoin="round" />
      <path d="M6.5 5.5L14 2" strokeLinecap="round" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h6a3 3 0 010 6H7" strokeLinecap="round" />
      <path d="M5 3L3 5L5 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M11 5H5a3 3 0 000 6h2" strokeLinecap="round" />
      <path d="M9 3L11 5L9 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFit() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M7 1L1 4.5L7 8L13 4.5L7 1Z" strokeLinejoin="round" />
      <path d="M1 7l6 3.5L13 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 9.5L7 13l6-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const toolButtons: { tool: ToolType; label: string; shortcut: string; numKey: string; Icon: React.FC }[] = [
  { tool: ToolType.SELECT, label: 'Select', shortcut: 'V', numKey: '1', Icon: IconSelect },
  { tool: ToolType.PAN, label: 'Pan', shortcut: 'H', numKey: '2', Icon: IconPan },
  { tool: ToolType.PEN, label: 'Draw', shortcut: 'P', numKey: '3', Icon: IconPen },
  { tool: ToolType.TEXT, label: 'Text', shortcut: 'T', numKey: '4', Icon: IconText },
  { tool: ToolType.ERASER, label: 'Eraser', shortcut: 'E', numKey: '5', Icon: IconEraser },
];

export default function Toolbar({
  activeTool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  fontSize,
  onFontSizeChange,
  zoom,
  onFitAll,
  onZoomIn,
  onZoomOut,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onlineUsers,
  onUserClick,
  followingUserId,
  onShareClick,
  onToggleLayers,
  showLayers,
  onToggleHelp,
  onMmImport,
}: ToolbarProps) {
  const showStroke = activeTool === ToolType.PEN;
  const showFontSize = activeTool === ToolType.TEXT;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      padding: '4px 8px',
      background: '#1a1a1a',
      borderBottom: '1px solid #2a2a2a',
      flexShrink: 0,
      height: '44px',
      boxSizing: 'border-box',
    }}>
      {/* Tool buttons */}
      <div style={{ display: 'flex', gap: '1px', background: '#222', borderRadius: '8px', padding: '2px' }}>
        {toolButtons.map(({ tool, label, shortcut, numKey, Icon }) => {
          const active = activeTool === tool;
          return (
            <button
              key={tool}
              onClick={() => onToolChange(tool)}
              title={`${label} (${shortcut} or ${numKey})`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '4px', height: '32px', padding: '0 10px',
                background: active ? 'linear-gradient(135deg, #4a9eff, #3d7dd8)' : 'transparent',
                border: 'none', borderRadius: '6px',
                color: active ? '#fff' : '#777',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: active ? '0 1px 4px rgba(74,158,255,0.3)' : 'none',
              }}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.color = '#bbb'; } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#777'; } }}
            >
              <Icon />
              <span style={{ fontSize: '11px', fontWeight: active ? 600 : 400, letterSpacing: '0.2px' }}>{label}</span>
              <span style={{
                fontSize: '9px', color: active ? 'rgba(255,255,255,0.5)' : '#555',
                background: active ? 'rgba(255,255,255,0.1)' : '#1a1a1a',
                padding: '1px 4px', borderRadius: '3px', fontWeight: 500,
                lineHeight: '14px', minWidth: '14px', textAlign: 'center',
              }}>
                {numKey}
              </span>
            </button>
          );
        })}
      </div>

      <Divider />

      {/* Color */}
      <ColorPicker color={color} onChange={onColorChange} />

      {/* Stroke width (pen) */}
      {showStroke && (
        <>
          <Divider />
          <span style={{ fontSize: '10px', color: '#555', marginLeft: '4px' }}>Width</span>
          <input
            type="range" min={2} max={20} value={strokeWidth}
            onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
            style={{ width: '60px', height: '3px', accentColor: '#4a9eff', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '10px', color: '#666', minWidth: '18px', textAlign: 'center' }}>{strokeWidth}</span>
        </>
      )}

      {/* Font size (text) */}
      {showFontSize && (
        <>
          <Divider />
          <span style={{ fontSize: '10px', color: '#555', marginLeft: '4px' }}>Size</span>
          <input
            type="range" min={12} max={72} value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            style={{ width: '60px', height: '3px', accentColor: '#4a9eff', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '10px', color: '#666', minWidth: '18px', textAlign: 'center' }}>{fontSize}</span>
        </>
      )}

      <Divider />

      {/* Undo/Redo */}
      <ActionBtn onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><IconUndo /></ActionBtn>
      <ActionBtn onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><IconRedo /></ActionBtn>

      <Divider />

      {/* Zoom */}
      {onZoomOut && (
        <ActionBtn onClick={onZoomOut} title="Zoom out (Ctrl+-)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="3" y1="7" x2="11" y2="7" strokeLinecap="round" />
          </svg>
        </ActionBtn>
      )}
      <span style={{
        fontSize: '11px', color: '#888', minWidth: '40px', textAlign: 'center',
        userSelect: 'none', fontVariantNumeric: 'tabular-nums',
      }}>
        {Math.round(zoom * 100)}%
      </span>
      {onZoomIn && (
        <ActionBtn onClick={onZoomIn} title="Zoom in (Ctrl+=)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="3" y1="7" x2="11" y2="7" strokeLinecap="round" />
            <line x1="7" y1="3" x2="7" y2="11" strokeLinecap="round" />
          </svg>
        </ActionBtn>
      )}
      <ActionBtn onClick={onFitAll} title="Fit all (Ctrl+0)"><IconFit /></ActionBtn>

      <Divider />

      {/* Layers toggle */}
      {onToggleLayers && (
        <ActionBtn onClick={onToggleLayers} title="Layers panel"
          active={showLayers}>
          <IconLayers />
        </ActionBtn>
      )}

      {/* Help / shortcuts */}
      {onToggleHelp && (
        <ActionBtn onClick={onToggleHelp} title="Keyboard shortcuts (?)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="6" />
            <path d="M5.5 5.5a1.5 1.5 0 013 0c0 1-1.5 1-1.5 2" strokeLinecap="round" />
            <circle cx="7" cy="10" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        </ActionBtn>
      )}

      {/* Mattermost import */}
      {onMmImport && (
        <ActionBtn onClick={onMmImport} title="Import from Mattermost">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 10V4a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2z" />
            <path d="M5 7h4M7 5v4" strokeLinecap="round" />
          </svg>
        </ActionBtn>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Online users */}
      {onlineUsers.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '-4px', marginRight: '8px' }}
             title={onlineUsers.map((u) => u.displayName).join(', ')}>
          {onlineUsers.slice(0, 5).map((u, i) => (
            <div key={u.userId} style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${u.color}, ${u.color}dd)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', fontWeight: 700, color: '#fff',
              border: followingUserId === u.userId ? '2px solid #4a9eff' : '2px solid #1a1a1a',
              marginLeft: i > 0 ? '-6px' : '0',
              zIndex: 5 - i,
              boxShadow: followingUserId === u.userId ? '0 0 6px rgba(74,144,217,0.6)' : '0 1px 3px rgba(0,0,0,0.3)',
              cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onClick={() => onUserClick?.(u.userId, u.displayName)}
            title={`${u.displayName}${followingUserId === u.userId ? ' (following)' : ' — click to follow'}`}
            >
              {(u.displayName || '?')[0].toUpperCase()}
            </div>
          ))}
          {onlineUsers.length > 5 && (
            <span style={{ fontSize: '10px', color: '#666', marginLeft: '4px' }}>+{onlineUsers.length - 5}</span>
          )}
        </div>
      )}

      {/* Share */}
      {onShareClick && (
        <button onClick={onShareClick} style={{
          padding: '5px 14px', background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
          border: 'none', borderRadius: '6px',
          color: '#fff', fontSize: '11px', fontWeight: 600,
          cursor: 'pointer', letterSpacing: '0.3px',
          boxShadow: '0 1px 4px rgba(74,158,255,0.3)',
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
          Share
        </button>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: '1px', height: '20px', background: '#2a2a2a', margin: '0 6px', flexShrink: 0 }} />;
}

function ActionBtn({ onClick, disabled, title, children, active }: {
  onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode; active?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '28px', height: '28px', background: active ? '#2a3a50' : 'transparent',
        border: 'none', borderRadius: '6px',
        color: active ? '#4a9eff' : disabled ? '#333' : '#777',
        cursor: disabled ? 'default' : 'pointer', padding: 0,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = active ? '#2a3a50' : '#2a2a2a'; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? '#2a3a50' : 'transparent'; }}
    >
      {children}
    </button>
  );
}
