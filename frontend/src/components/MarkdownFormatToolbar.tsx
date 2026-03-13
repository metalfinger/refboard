/**
 * MarkdownFormatToolbar — contextual toolbar for selected markdown cards.
 * Shows name, color picker (sets accent + auto-derives bg), and width presets.
 */

import React, { useState, useEffect } from 'react';

interface MarkdownFormatToolbarProps {
  x: number;
  y: number;
  accentColor: string;
  width: number;
  name: string;
  onColorChange: (accent: string, bg: string) => void;
  onWidthChange: (width: number) => void;
  onNameChange: (name: string) => void;
}

/** Derive a dark card background from an accent color. */
function deriveBg(accent: string): string {
  // Parse hex to RGB, then darken heavily
  const hex = accent.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  // Mix ~15% accent into a dark base
  const mix = (c: number) => Math.round(28 + c * 0.12);
  return `#${mix(r).toString(16).padStart(2, '0')}${mix(g).toString(16).padStart(2, '0')}${mix(b).toString(16).padStart(2, '0')}`;
}

const CARD_COLORS = [
  { accent: '#7950f2', label: 'Purple' },
  { accent: '#4dabf7', label: 'Blue' },
  { accent: '#69db7c', label: 'Green' },
  { accent: '#ffd43b', label: 'Yellow' },
  { accent: '#ff6b6b', label: 'Red' },
  { accent: '#e64980', label: 'Pink' },
  { accent: '#ffa94d', label: 'Orange' },
  { accent: '#868e96', label: 'Gray' },
  { accent: '#f783ac', label: 'Rose' },
  { accent: '#20c997', label: 'Teal' },
];

const WIDTH_PRESETS = [
  { label: 'S', value: 300 },
  { label: 'M', value: 450 },
  { label: 'L', value: 650 },
];

export default function MarkdownFormatToolbar(props: MarkdownFormatToolbarProps) {
  const { x, y, accentColor, width, name, onColorChange, onWidthChange, onNameChange } = props;
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const onDown = () => setShowPicker(false);
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '26px', background: 'transparent', border: 'none', borderRadius: '5px',
    color: '#999', cursor: 'pointer', padding: '0 6px', fontSize: '11px',
    fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap', transition: 'all 0.1s',
  };

  return (
    <div
      style={{
        position: 'absolute', left: x, top: y - 8,
        transform: 'translate(-50%, -100%)',
        display: 'flex', alignItems: 'center', gap: '1px', padding: '3px',
        background: 'rgba(22, 22, 22, 0.96)', border: '1px solid #333',
        borderRadius: '10px', backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 100, pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Title / name */}
      <input
        type="text"
        value={name}
        placeholder="Untitled card"
        onChange={(e) => onNameChange(e.target.value)}
        style={{
          background: 'transparent', border: '1px solid transparent',
          borderRadius: '5px', color: '#ccc', fontSize: '11px',
          padding: '2px 8px', width: '120px', outline: 'none',
          fontFamily: 'system-ui, sans-serif',
        }}
        onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = '#555'; }}
        onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'transparent'; }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />

      <div style={{ width: '1px', height: '18px', background: '#333', margin: '0 2px', flexShrink: 0 }} />

      {/* Card color */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...btnStyle, gap: '4px', padding: '0 8px' }}
          onClick={(e) => { e.stopPropagation(); setShowPicker((v) => !v); }}
          title="Card color"
        >
          <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: accentColor, border: '1px solid #555' }} />
          <span style={{ fontSize: '10px', color: '#888' }}>Color</span>
        </button>
        {showPicker && (
          <div
            style={{
              position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
              marginTop: '4px',
              background: 'rgba(22, 22, 22, 0.98)', border: '1px solid #333',
              borderRadius: '8px', padding: '8px', zIndex: 200,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
              {CARD_COLORS.map((c) => (
                <button
                  key={c.accent}
                  onClick={() => { onColorChange(c.accent, deriveBg(c.accent)); setShowPicker(false); }}
                  title={c.label}
                  style={{
                    width: '22px', height: '22px', borderRadius: '4px', background: c.accent,
                    border: c.accent === accentColor ? '2px solid #fff' : '1px solid #444',
                    cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ width: '1px', height: '18px', background: '#333', margin: '0 2px', flexShrink: 0 }} />

      {/* Width presets */}
      <div style={{ display: 'flex', gap: '1px' }}>
        {WIDTH_PRESETS.map((p) => (
          <button
            key={p.label}
            style={{
              ...btnStyle, width: '24px', padding: 0,
              color: Math.abs(width - p.value) < 30 ? '#fff' : '#666',
              background: Math.abs(width - p.value) < 30 ? '#444' : 'transparent',
            }}
            onClick={() => onWidthChange(p.value)}
            title={`${p.label} (${p.value}px)`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
