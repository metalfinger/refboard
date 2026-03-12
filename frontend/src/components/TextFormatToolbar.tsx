import React, { useState, useRef, useEffect } from 'react';

type StickyTextSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';

const STICKY_SIZES: StickyTextSize[] = ['S', 'M', 'L', 'XL', 'XXL'];
const STICKY_SIZE_MAP: Record<StickyTextSize, number> = { S: 20, M: 28, L: 36, XL: 48, XXL: 60 };
const STICKY_WIDTH_MAP: Record<StickyTextSize, number> = { S: 200, M: 260, L: 320, XL: 400, XXL: 480 };
const STICKY_SIZE_VALUES = Object.values(STICKY_SIZE_MAP);

function nearestStickySize(fontSize: number): StickyTextSize {
  let best: StickyTextSize = 'M';
  let bestDist = Infinity;
  for (const size of STICKY_SIZES) {
    const dist = Math.abs(fontSize - STICKY_SIZE_MAP[size]);
    if (dist < bestDist) { bestDist = dist; best = size; }
  }
  return best;
}

/** Snap a raw fontSize to the nearest preset. Returns { fontSize, width }. */
export function snapToStickyPreset(fontSize: number): { fontSize: number; width: number } {
  let best: StickyTextSize = 'M';
  let bestDist = Infinity;
  for (const size of STICKY_SIZES) {
    const dist = Math.abs(fontSize - STICKY_SIZE_MAP[size]);
    if (dist < bestDist) { bestDist = dist; best = size; }
  }
  return { fontSize: STICKY_SIZE_MAP[best], width: STICKY_WIDTH_MAP[best] };
}

/** Get the width for a given sticky text size preset. */
export function getStickyWidthForSize(fontSize: number): number {
  const size = nearestStickySize(fontSize);
  return STICKY_WIDTH_MAP[size];
}

interface TextFormatToolbarProps {
  kind: 'text' | 'sticky';
  x: number;
  y: number;
  fontFamily: string;
  /** Text color (both text and sticky). */
  fill: string;
  /** Note background color (sticky only). */
  noteFill?: string;
  /** Current sticky fontSize (for S/M/L toggle). */
  stickyFontSize?: number;
  position?: 'above' | 'below';
  onFontFamilyChange: (family: string) => void;
  onFillChange: (color: string) => void;
  /** Called when sticky note background color changes. */
  onNoteFillChange?: (color: string) => void;
  /** Called when sticky text size preset changes. */
  onStickySizeChange?: (fontSize: number) => void;
}

const FONT_FAMILIES = [
  'sans-serif',
  'serif',
  'monospace',
  'Arial',
  'Georgia',
  'Courier New',
  'Impact',
  'Comic Sans MS',
];

const PRESET_COLORS = [
  '#ffffff', '#000000', '#ff6b6b', '#ffa94d', '#ffd43b',
  '#69db7c', '#4dabf7', '#7950f2', '#e64980', '#868e96',
];

export default function TextFormatToolbar(props: TextFormatToolbarProps) {
  const { kind, x, y, fontFamily, fill, noteFill, stickyFontSize, position = 'above', onFontFamilyChange, onFillChange, onNoteFillChange, onStickySizeChange } = props;
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showNoteFillPicker, setShowNoteFillPicker] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const onDown = () => { setShowFontMenu(false); setShowColorPicker(false); setShowNoteFillPicker(false); };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '26px',
    background: 'transparent',
    border: 'none',
    borderRadius: '5px',
    color: '#999',
    cursor: 'pointer',
    padding: '0 6px',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    whiteSpace: 'nowrap',
    transition: 'all 0.1s',
  };

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.background = '#333';
      e.currentTarget.style.color = '#fff';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = '#999';
    },
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y - 8,
        transform: position === 'below' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        display: 'flex',
        alignItems: 'center',
        gap: '1px',
        padding: '3px',
        background: 'rgba(22, 22, 22, 0.96)',
        border: '1px solid #333',
        borderRadius: '10px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        zIndex: 100,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* S/M/L text size toggle (sticky only) */}
      {kind === 'sticky' && onStickySizeChange && (<>
        {STICKY_SIZES.map((size) => {
          const active = nearestStickySize(stickyFontSize || 14) === size;
          return (
            <button
              key={size}
              style={{
                ...btnStyle,
                minWidth: size.length > 2 ? '32px' : '24px',
                padding: '0 3px',
                fontSize: '10px',
                fontWeight: active ? 700 : 400,
                color: active ? '#fff' : '#666',
                background: active ? '#333' : 'transparent',
              }}
              onClick={() => onStickySizeChange(STICKY_SIZE_MAP[size])}
              title={`${STICKY_SIZE_MAP[size]}px text`}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#666'; } }}
            >
              {size}
            </button>
          );
        })}
        <div style={{ width: '1px', height: '18px', background: '#333', margin: '0 2px', flexShrink: 0 }} />
      </>)}

      {/* Font family dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...btnStyle, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis' }}
          onClick={(e) => { e.stopPropagation(); setShowFontMenu((v) => !v); setShowColorPicker(false); }}
          title="Font family"
          {...hoverHandlers}
        >
          {fontFamily}
        </button>
        {showFontMenu && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              background: 'rgba(22, 22, 22, 0.98)',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '4px',
              minWidth: '120px',
              zIndex: 200,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {FONT_FAMILIES.map((f) => (
              <button
                key={f}
                onClick={() => { onFontFamilyChange(f); setShowFontMenu(false); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 8px',
                  background: f === fontFamily ? '#333' : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: f === fontFamily ? '#fff' : '#999',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontFamily: f,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = f === fontFamily ? '#333' : 'transparent';
                  e.currentTarget.style.color = f === fontFamily ? '#fff' : '#999';
                }}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '18px', background: '#333', margin: '0 2px', flexShrink: 0 }} />

      {/* Text color */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...btnStyle, width: '26px', padding: 0 }}
          onClick={(e) => { e.stopPropagation(); setShowColorPicker((v) => !v); setShowFontMenu(false); setShowNoteFillPicker(false); }}
          title="Text color"
          {...hoverHandlers}
        >
          <div style={{ width: '14px', height: '14px', borderRadius: '3px', background: fill, border: '1px solid #555' }} />
        </button>
        {showColorPicker && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'rgba(22, 22, 22, 0.98)',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '8px',
              zIndex: 200,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '8px' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { onFillChange(c); setShowColorPicker(false); }}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '4px',
                    background: c,
                    border: c === fill ? '2px solid #4a90d9' : '1px solid #444',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <input
              ref={colorInputRef}
              type="color"
              value={fill}
              onChange={(e) => { onFillChange(e.target.value); }}
              style={{ width: '100%', height: '24px', border: 'none', background: 'transparent', cursor: 'pointer' }}
            />
          </div>
        )}
      </div>

      {/* Note fill color (sticky only) */}
      {kind === 'sticky' && noteFill != null && onNoteFillChange && (<>
        <div style={{ width: '1px', height: '18px', background: '#333', margin: '0 2px', flexShrink: 0 }} />
        <div style={{ position: 'relative' }}>
          <button
            style={{ ...btnStyle, width: '26px', padding: 0 }}
            onClick={(e) => { e.stopPropagation(); setShowNoteFillPicker((v) => !v); setShowFontMenu(false); setShowColorPicker(false); }}
            title="Note color"
            {...hoverHandlers}
          >
            <div style={{ width: '14px', height: '14px', borderRadius: '6px', background: noteFill, border: '1px solid #555' }} />
          </button>
          {showNoteFillPicker && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                background: 'rgba(22, 22, 22, 0.98)',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '8px',
                zIndex: 200,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '8px' }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { onNoteFillChange(c); setShowNoteFillPicker(false); }}
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      background: c,
                      border: c === noteFill ? '2px solid #4a90d9' : '1px solid #444',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              <input
                type="color"
                value={noteFill}
                onChange={(e) => { onNoteFillChange(e.target.value); }}
                style={{ width: '100%', height: '24px', border: 'none', background: 'transparent', cursor: 'pointer' }}
              />
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}
