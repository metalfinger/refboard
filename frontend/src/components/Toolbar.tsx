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
  onToggleActivity?: () => void;
  showActivity?: boolean;
  onExport?: () => void;
  onRefreshPreview?: () => void;
  previewRefreshing?: boolean;
  onToggleReview?: () => void;
  reviewMode?: boolean;
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

function IconSticky() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M5 6h8M5 9h6M5 12h4" />
    </svg>
  );
}

function IconMarkdown() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="14" height="16" rx="2" />
      <path d="M5 5h8" />
      <path d="M5 8h6" />
      <path d="M5 11h4" />
      <circle cx="13" cy="13" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconReview() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 3A1.5 1.5 0 014 1.5h8A1.5 1.5 0 0113.5 3v7A1.5 1.5 0 0112 11.5H7l-3.5 3V11.5H4A1.5 1.5 0 012.5 10V3z" />
      <circle cx="6" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="8" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
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

const toolButtons: { tool: ToolType; label: string; shortcut: string; numKey: string; Icon: React.FC; hint?: string }[] = [
  { tool: ToolType.SELECT, label: 'Select', shortcut: 'V', numKey: '1', Icon: IconSelect, hint: 'Click to select, drag to move, Shift+click for multi-select' },
  { tool: ToolType.PEN, label: 'Draw', shortcut: 'P', numKey: '3', Icon: IconPen, hint: 'Click and drag to draw freehand' },
  { tool: ToolType.TEXT, label: 'Text', shortcut: 'T', numKey: '4', Icon: IconText, hint: 'Click on the canvas to place text' },
  { tool: ToolType.STICKY, label: 'Sticky', shortcut: 'S', numKey: '5', Icon: IconSticky, hint: 'Click on the canvas to place a sticky note' },
  { tool: ToolType.MARKDOWN, label: 'Markdown', shortcut: 'M', numKey: '6', Icon: IconMarkdown, hint: 'Click on the canvas to place a markdown card' },
];

const REVIEW_HINT = 'Click an object to place a comment pin. Press . to toggle.';

export default function Toolbar({
  activeTool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
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
  onToggleActivity,
  showActivity,
  onExport,
  onRefreshPreview,
  previewRefreshing,
  onToggleReview,
  reviewMode,
}: ToolbarProps) {
  const showStroke = activeTool === ToolType.PEN;

  // Determine active hint
  const activeToolDef = toolButtons.find((t) => t.tool === activeTool);
  const activeHint = reviewMode ? REVIEW_HINT : activeToolDef?.hint || '';

  return (
    <div style={{ flexShrink: 0 }}>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      padding: '4px 8px',
      background: '#1a1a1a',
      borderBottom: activeHint ? 'none' : '1px solid #2a2a2a',
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
      {/* Review mode — independent toggle, separated from tools */}
      {onToggleReview && (<>
        <Divider />
        <button
          onClick={onToggleReview}
          title="Review (.)"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '4px', height: '32px', padding: '0 10px',
            background: reviewMode ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'transparent',
            border: 'none', borderRadius: '6px',
            color: reviewMode ? '#fff' : '#777',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: reviewMode ? '0 1px 4px rgba(249,115,22,0.3)' : 'none',
          }}
          onMouseEnter={(e) => { if (!reviewMode) { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.color = '#bbb'; } }}
          onMouseLeave={(e) => { if (!reviewMode) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#777'; } }}
        >
          <IconReview />
          <span style={{ fontSize: '11px', fontWeight: reviewMode ? 600 : 400, letterSpacing: '0.2px' }}>Review</span>
          <span style={{
            fontSize: '9px', color: reviewMode ? 'rgba(255,255,255,0.5)' : '#555',
            background: reviewMode ? 'rgba(255,255,255,0.1)' : '#1a1a1a',
            padding: '1px 4px', borderRadius: '3px', fontWeight: 500,
            lineHeight: '14px', minWidth: '14px', textAlign: 'center',
          }}>
            .
          </span>
        </button>
      </>)}

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

      {/* Activity log */}
      {onToggleActivity && (
        <ActionBtn onClick={onToggleActivity} title="Activity log"
          active={showActivity}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4v3.2L9.2 8.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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

      {/* Export */}
      {onExport && (
        <ActionBtn onClick={onExport} title="Export as image (Ctrl+Shift+E)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 9v3h10V9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 2v7M4 6l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ActionBtn>
      )}

      {/* Refresh board preview */}
      {onRefreshPreview && (
        <ActionBtn
          onClick={onRefreshPreview}
          title={previewRefreshing ? 'Refreshing board preview...' : 'Update board preview from current view'}
          disabled={previewRefreshing}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M11.5 4.5A4.5 4.5 0 104 11" strokeLinecap="round" />
            <path d="M11.5 1.8v2.7H8.8" strokeLinecap="round" strokeLinejoin="round" />
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
    {/* Tool hint bar */}
    {activeHint && (
      <div style={{
        padding: '4px 16px',
        background: '#141416',
        borderBottom: '1px solid #2a2a2a',
        fontSize: '11px',
        color: '#666',
        letterSpacing: '0.2px',
        lineHeight: '16px',
      }}>
        {activeHint}
      </div>
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
