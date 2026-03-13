/**
 * MarkdownFormatToolbar — contextual toolbar for selected markdown cards.
 * Shows background color picker, width presets, and accent color picker.
 */

import React, { useState, useEffect } from 'react';

interface MarkdownFormatToolbarProps {
  x: number;
  y: number;
  bgColor: string;
  accentColor: string;
  width: number;
  onBgColorChange: (color: string) => void;
  onAccentColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
}

const PRESET_COLORS = [
  '#232336', '#1e1e2e', '#2a2a3a', '#1a2332', '#2a1a2a',
  '#1a2a1a', '#2a2a1a', '#333333', '#1a1a1a', '#3a2a42',
];

const ACCENT_COLORS = [
  '#7950f2', '#4dabf7', '#69db7c', '#ffd43b', '#ff6b6b',
  '#e64980', '#ffa94d', '#868e96', '#ffffff', '#f783ac',
];

const WIDTH_PRESETS = [
  { label: 'S', value: 300 },
  { label: 'M', value: 450 },
  { label: 'L', value: 650 },
];

export default function MarkdownFormatToolbar(props: MarkdownFormatToolbarProps) {
  const { x, y, bgColor, accentColor, width, onBgColorChange, onAccentColorChange, onWidthChange } = props;
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showAccentPicker, setShowAccentPicker] = useState(false);

  useEffect(() => {
    const onDown = () => { setShowBgPicker(false); setShowAccentPicker(false); };
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
      {/* Background color */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...btnStyle, width: '26px', padding: 0 }}
          onClick={(e) => { e.stopPropagation(); setShowBgPicker((v) => !v); setShowAccentPicker(false); }}
          title="Card background"
        >
          <div style={{ width: '14px', height: '14px', borderRadius: '3px', background: bgColor, border: '1px solid #555' }} />
        </button>
        {showBgPicker && (
          <div
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: '4px',
              background: 'rgba(22, 22, 22, 0.98)', border: '1px solid #333',
              borderRadius: '8px', padding: '8px', zIndex: 200,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { onBgColorChange(c); setShowBgPicker(false); }}
                  style={{
                    width: '22px', height: '22px', borderRadius: '4px', background: c,
                    border: c === bgColor ? '2px solid #4a90d9' : '1px solid #444',
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

      <div style={{ width: '1px', height: '18px', background: '#333', margin: '0 2px', flexShrink: 0 }} />

      {/* Accent color */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...btnStyle, width: '26px', padding: 0 }}
          onClick={(e) => { e.stopPropagation(); setShowAccentPicker((v) => !v); setShowBgPicker(false); }}
          title="Accent color"
        >
          <div style={{ width: '14px', height: '14px', borderRadius: '6px', background: accentColor, border: '1px solid #555' }} />
        </button>
        {showAccentPicker && (
          <div
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: '4px',
              background: 'rgba(22, 22, 22, 0.98)', border: '1px solid #333',
              borderRadius: '8px', padding: '8px', zIndex: 200,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { onAccentColorChange(c); setShowAccentPicker(false); }}
                  style={{
                    width: '22px', height: '22px', borderRadius: '4px', background: c,
                    border: c === accentColor ? '2px solid #4a90d9' : '1px solid #444',
                    cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
