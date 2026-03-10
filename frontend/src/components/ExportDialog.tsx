import React, { useState, useMemo } from 'react';
import type { SceneItem } from '../canvas/SceneManager';
import { getExportDimensions } from '../canvas/export';

type Format = 'png' | 'jpeg' | 'webp';
type Scope = 'selection' | 'all';

interface ExportDialogProps {
  selectedItems: SceneItem[];
  allItems: SceneItem[];
  boardName: string;
  onExport: (items: SceneItem[], options: {
    format: Format;
    quality: number;
    scale: number;
    background: string;
    filename: string;
  }) => void;
  onClose: () => void;
}

export default function ExportDialog({
  selectedItems, allItems, boardName, onExport, onClose,
}: ExportDialogProps) {
  const hasSelection = selectedItems.length > 0;
  const [scope, setScope] = useState<Scope>(hasSelection ? 'selection' : 'all');
  const [format, setFormat] = useState<Format>('png');
  const [quality, setQuality] = useState(0.9);
  const [scale, setScale] = useState(1);
  const [background, setBackground] = useState('#1e1e1e');
  const [filename, setFilename] = useState(
    () => `${boardName || 'export'}-${new Date().toISOString().slice(0, 10)}`
  );

  const items = scope === 'selection' ? selectedItems : allItems;
  const dims = useMemo(() => getExportDimensions(items, scale), [items, scale]);

  const canExport = items.length > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px',
        padding: '20px', width: '320px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', color: '#ddd', fontSize: '14px', fontWeight: 600 }}>
          Export as Image
        </h3>

        {/* Scope */}
        <FieldLabel>Scope</FieldLabel>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {hasSelection && (
            <ToggleBtn active={scope === 'selection'} onClick={() => setScope('selection')}>
              Selection ({selectedItems.length})
            </ToggleBtn>
          )}
          <ToggleBtn active={scope === 'all'} onClick={() => setScope('all')}>
            Full board ({allItems.length})
          </ToggleBtn>
        </div>

        {/* Filename */}
        <FieldLabel>Filename</FieldLabel>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#111', border: '1px solid #333', borderRadius: '6px',
            color: '#ddd', padding: '6px 8px', fontSize: '12px',
            marginBottom: '12px',
          }}
        />

        {/* Format */}
        <FieldLabel>Format</FieldLabel>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {(['png', 'jpeg', 'webp'] as Format[]).map((f) => (
            <ToggleBtn key={f} active={format === f} onClick={() => setFormat(f)}>
              {f.toUpperCase()}
            </ToggleBtn>
          ))}
        </div>

        {/* Quality (jpeg/webp only) */}
        {format !== 'png' && (
          <div style={{ marginBottom: '12px' }}>
            <FieldLabel>Quality: {Math.round(quality * 100)}%</FieldLabel>
            <input
              type="range" min={0.1} max={1} step={0.05} value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#4a9eff', cursor: 'pointer' }}
            />
          </div>
        )}

        {/* Scale */}
        <FieldLabel>Scale</FieldLabel>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {[0.5, 1, 2].map((s) => (
            <ToggleBtn key={s} active={scale === s} onClick={() => setScale(s)}>
              {s}x
            </ToggleBtn>
          ))}
        </div>

        {/* Background */}
        <FieldLabel>Background</FieldLabel>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '12px' }}>
          {['#1e1e1e', '#ffffff', '#000000', 'transparent'].map((bg) => (
            <button key={bg} onClick={() => setBackground(bg)} style={{
              width: '24px', height: '24px', borderRadius: '4px', cursor: 'pointer',
              border: background === bg ? '2px solid #4a9eff' : '2px solid #333',
              background: bg === 'transparent'
                ? 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 8px 8px'
                : bg,
            }} title={bg} />
          ))}
        </div>

        {/* Dimensions preview */}
        <div style={{
          padding: '8px', background: '#111', borderRadius: '6px', marginBottom: '16px',
          fontSize: '11px', color: '#666', textAlign: 'center',
        }}>
          {canExport
            ? `${dims.width} x ${dims.height} px`
            : 'No items to export'}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '6px 16px', background: 'transparent', border: '1px solid #333',
            borderRadius: '6px', color: '#888', cursor: 'pointer', fontSize: '12px',
          }}>Cancel</button>
          <button
            onClick={() => onExport(items, { format, quality, scale, background, filename })}
            disabled={!canExport}
            style={{
              padding: '6px 16px',
              background: canExport ? 'linear-gradient(135deg, #4a9eff, #3d7dd8)' : '#333',
              border: 'none', borderRadius: '6px',
              color: canExport ? '#fff' : '#666',
              cursor: canExport ? 'pointer' : 'default',
              fontSize: '12px', fontWeight: 600,
            }}
          >Export</button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', fontWeight: 500 }}>{children}</div>;
}

function ToggleBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px',
      background: active ? '#2a3a50' : '#222',
      border: active ? '1px solid #4a9eff44' : '1px solid #333',
      color: active ? '#4a9eff' : '#777',
    }}>{children}</button>
  );
}
