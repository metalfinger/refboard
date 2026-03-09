import React, { useState, useCallback } from 'react';

interface LayerItem {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  isGroup: boolean;
  children?: LayerItem[];
}

interface LayerPanelProps {
  layers: LayerItem[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete: (id: string) => void;
  onGroup: () => void;
  onUngroup: () => void;
  hasSelection: boolean;
  hasGroupSelection: boolean;
}

export default function LayerPanel({
  layers, selectedIds, onSelect, onToggleVisible, onToggleLock,
  onReorder, onDelete, onGroup, onUngroup, hasSelection, hasGroupSelection,
}: LayerPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const onDragStart = useCallback((idx: number) => setDragIdx(idx), []);
  const onDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);
  const onDrop = useCallback((targetIdx: number) => {
    if (dragIdx !== null && dragIdx !== targetIdx) {
      onReorder(dragIdx, targetIdx);
    }
    setDragIdx(null);
  }, [dragIdx, onReorder]);

  if (collapsed) {
    return (
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '28px',
        background: '#1e1e1e', borderLeft: '1px solid #2a2a2a', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8px',
      }}>
        <button onClick={() => setCollapsed(false)} title="Show layers"
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: '4px' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 2L2 7l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: '200px',
      background: '#1e1e1e', borderLeft: '1px solid #2a2a2a', zIndex: 100,
      display: 'flex', flexDirection: 'column', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#999', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Layers
        </span>
        <div style={{ display: 'flex', gap: '2px' }}>
          <SmallBtn title="Group (Ctrl+G)" disabled={!hasSelection} onClick={onGroup}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="1" width="4" height="4" rx="0.5" /><rect x="7" y="7" width="4" height="4" rx="0.5" />
              <path d="M5 6h2M6 5v2" strokeLinecap="round" />
            </svg>
          </SmallBtn>
          <SmallBtn title="Ungroup (Ctrl+Shift+G)" disabled={!hasGroupSelection} onClick={onUngroup}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="1" width="4" height="4" rx="0.5" /><rect x="7" y="7" width="4" height="4" rx="0.5" />
              <path d="M4 6h4" strokeLinecap="round" />
            </svg>
          </SmallBtn>
          <SmallBtn title="Collapse panel" onClick={() => setCollapsed(true)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </SmallBtn>
        </div>
      </div>

      {/* Layer list — reversed so top layer is first */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {[...layers].reverse().map((layer, i) => {
          const realIdx = layers.length - 1 - i;
          const selected = selectedIds.includes(layer.id);
          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => onDragStart(realIdx)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(realIdx)}
              onClick={() => onSelect(layer.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '3px 6px', cursor: 'pointer',
                background: selected ? '#2a3a50' : dragIdx === realIdx ? '#2a2a2a' : 'transparent',
                borderBottom: '1px solid #222',
                opacity: layer.visible ? 1 : 0.4,
              }}
              onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#252525'; }}
              onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {/* Visibility toggle */}
              <button onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id); }}
                title={layer.visible ? 'Hide' : 'Show'}
                style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: layer.visible ? '#888' : '#444', flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                  {layer.visible ? (
                    <><ellipse cx="5" cy="5" rx="4" ry="2.5" /><circle cx="5" cy="5" r="1" fill="currentColor" /></>
                  ) : (
                    <><line x1="1" y1="1" x2="9" y2="9" /><ellipse cx="5" cy="5" rx="4" ry="2.5" /></>
                  )}
                </svg>
              </button>

              {/* Lock toggle */}
              <button onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id); }}
                title={layer.locked ? 'Unlock' : 'Lock'}
                style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: layer.locked ? '#e8a946' : '#444', flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                  {layer.locked ? (
                    <><rect x="2" y="5" width="6" height="4" rx="0.5" /><path d="M3.5 5V3.5a1.5 1.5 0 013 0V5" /></>
                  ) : (
                    <><rect x="2" y="5" width="6" height="4" rx="0.5" /><path d="M3.5 5V3.5a1.5 1.5 0 013 0" /></>
                  )}
                </svg>
              </button>

              {/* Type icon */}
              <span style={{ fontSize: '9px', color: '#555', flexShrink: 0, width: '12px', textAlign: 'center' }}>
                {layer.isGroup ? '📁' : layer.type === 'image' ? '🖼' : layer.type === 'i-text' ? 'T' : layer.type === 'path' ? '✏' : '◇'}
              </span>

              {/* Name */}
              <span style={{
                flex: 1, fontSize: '11px', color: selected ? '#ccc' : '#999',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {layer.name}
              </span>

              {/* Delete */}
              <button onClick={(e) => { e.stopPropagation(); onDelete(layer.id); }}
                title="Delete"
                style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#444', flexShrink: 0, opacity: 0.5 }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ff6b6b'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = '#444'; }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            </div>
          );
        })}
        {layers.length === 0 && (
          <div style={{ padding: '12px', textAlign: 'center', color: '#444', fontSize: '11px' }}>
            No objects
          </div>
        )}
      </div>
    </div>
  );
}

function SmallBtn({ onClick, title, disabled, children }: {
  onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{
        background: 'none', border: 'none', padding: '3px', cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#333' : '#888', borderRadius: '3px',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#333'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
      {children}
    </button>
  );
}
