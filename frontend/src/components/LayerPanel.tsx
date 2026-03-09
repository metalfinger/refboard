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
  onRename: (id: string, name: string) => void;
  onGroup: () => void;
  onUngroup: () => void;
  hasSelection: boolean;
  hasGroupSelection: boolean;
}

export default function LayerPanel({
  layers, selectedIds, onSelect, onToggleVisible, onToggleLock,
  onReorder, onDelete, onRename, onGroup, onUngroup, hasSelection, hasGroupSelection,
}: LayerPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const onDragStart = useCallback((idx: number) => setDragIdx(idx), []);
  const onDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);
  const onDrop = useCallback((targetIdx: number) => {
    if (dragIdx !== null && dragIdx !== targetIdx) {
      onReorder(dragIdx, targetIdx);
    }
    setDragIdx(null);
  }, [dragIdx, onReorder]);

  const toggleGroupExpand = useCallback((id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const startRename = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, onRename]);

  if (collapsed) {
    return (
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '28px',
        background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8px',
      }}>
        <button onClick={() => setCollapsed(false)} title="Show layers"
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '14px', padding: '4px' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 2L2 7l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  function getTypeIcon(type: string, isGroup: boolean) {
    if (isGroup) return '\u25B8'; // triangle
    if (type === 'image') return '\u{1F5BC}';
    if (type === 'text' || type === 'i-text') return 'T';
    if (type === 'path') return '\u270E';
    if (type === 'video') return '\u25B6';
    return '\u25C7';
  }

  function renderLayer(layer: LayerItem, realIdx: number, depth = 0) {
    const selected = selectedIds.includes(layer.id);
    const isExpanded = expandedGroups.has(layer.id);
    const isEditing = editingId === layer.id;

    return (
      <React.Fragment key={layer.id}>
        <div
          draggable={!isEditing}
          onDragStart={() => onDragStart(realIdx)}
          onDragOver={onDragOver}
          onDrop={() => onDrop(realIdx)}
          onClick={() => onSelect(layer.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            padding: `3px 6px 3px ${6 + depth * 12}px`, cursor: 'pointer',
            background: selected ? 'rgba(74,158,255,0.1)' : dragIdx === realIdx ? '#1a1a1a' : 'transparent',
            borderBottom: '1px solid #151515',
            borderLeft: selected ? '2px solid #4a9eff' : '2px solid transparent',
            opacity: layer.visible ? 1 : 0.35,
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#161616'; }}
          onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          {/* Group expand/collapse */}
          {layer.isGroup ? (
            <button onClick={(e) => { e.stopPropagation(); toggleGroupExpand(layer.id); }}
              style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#666', flexShrink: 0, fontSize: '10px', width: '14px' }}>
              {isExpanded ? '\u25BE' : '\u25B8'}
            </button>
          ) : (
            <span style={{ width: '14px', flexShrink: 0 }} />
          )}

          {/* Visibility toggle */}
          <button onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id); }}
            title={layer.visible ? 'Hide' : 'Show'}
            style={{ background: 'none', border: 'none', padding: '1px', cursor: 'pointer', color: layer.visible ? '#666' : '#333', flexShrink: 0 }}>
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
            style={{ background: 'none', border: 'none', padding: '1px', cursor: 'pointer', color: layer.locked ? '#e8a946' : '#333', flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              {layer.locked ? (
                <><rect x="2" y="5" width="6" height="4" rx="0.5" /><path d="M3.5 5V3.5a1.5 1.5 0 013 0V5" /></>
              ) : (
                <><rect x="2" y="5" width="6" height="4" rx="0.5" /><path d="M3.5 5V3.5a1.5 1.5 0 013 0" /></>
              )}
            </svg>
          </button>

          {/* Type icon */}
          <span style={{ fontSize: '9px', color: '#444', flexShrink: 0, width: '12px', textAlign: 'center' }}>
            {getTypeIcon(layer.type, layer.isGroup)}
          </span>

          {/* Name (editable) */}
          {isEditing ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1, fontSize: '11px', color: '#ddd', background: '#0d0d0d',
                border: '1px solid #333', borderRadius: '3px', padding: '1px 4px',
                outline: 'none', minWidth: 0,
              }}
            />
          ) : (
            <span
              onDoubleClick={(e) => { e.stopPropagation(); startRename(layer.id, layer.name); }}
              style={{
                flex: 1, fontSize: '11px', color: selected ? '#ccc' : '#888',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                cursor: 'text',
              }}
              title="Double-click to rename"
            >
              {layer.name}
            </span>
          )}

          {/* Delete */}
          <button onClick={(e) => { e.stopPropagation(); onDelete(layer.id); }}
            title="Delete"
            style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#333', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ff6b6b'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#333'; }}>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
            </svg>
          </button>
        </div>

        {/* Group children */}
        {layer.isGroup && isExpanded && layer.children && (
          layer.children.map((child, ci) => renderLayer(child, realIdx, depth + 1))
        )}
      </React.Fragment>
    );
  }

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: '200px',
      background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
      display: 'flex', flexDirection: 'column', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
      }}>
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#555', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
          Layers
        </span>
        <div style={{ display: 'flex', gap: '2px' }}>
          <SmallBtn title="Group (Ctrl+G)" disabled={!hasSelection} onClick={onGroup}>G+</SmallBtn>
          <SmallBtn title="Ungroup (Ctrl+Shift+G)" disabled={!hasGroupSelection} onClick={onUngroup}>G-</SmallBtn>
          <SmallBtn title="Collapse panel" onClick={() => setCollapsed(true)}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </SmallBtn>
        </div>
      </div>

      {/* Layer list — reversed so top layer is first */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {[...layers].reverse().map((layer, i) => {
          const realIdx = layers.length - 1 - i;
          return renderLayer(layer, realIdx);
        })}
        {layers.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: '#333', fontSize: '11px' }}>
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
        background: 'none', border: 'none', padding: '2px 4px', cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#222' : '#666', borderRadius: '3px', fontSize: '9px', fontWeight: 600,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#1a1a1a'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
      {children}
    </button>
  );
}
