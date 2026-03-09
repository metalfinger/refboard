import React, { useState, useRef, useEffect } from 'react';

const PRESET_COLORS = [
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff',
  '#00ffff', '#ffffff', '#000000', '#ff6600', '#9933ff',
];

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

const styles = {
  wrapper: {
    position: 'relative' as const,
    display: 'inline-block',
  },
  trigger: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    border: '2px solid #3d3d3d',
    cursor: 'pointer',
    padding: 0,
    outline: 'none',
  },
  popup: {
    position: 'absolute' as const,
    top: '36px',
    left: '0',
    background: '#2d2d2d',
    border: '1px solid #3d3d3d',
    borderRadius: '8px',
    padding: '10px',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '4px',
  },
  swatch: {
    width: '26px',
    height: '26px',
    borderRadius: '4px',
    border: '2px solid transparent',
    cursor: 'pointer',
    padding: 0,
    outline: 'none',
  },
  hexRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  hexLabel: {
    fontSize: '11px',
    color: '#888',
  },
  hexInput: {
    flex: 1,
    padding: '4px 6px',
    background: '#1a1a1a',
    border: '1px solid #3d3d3d',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontSize: '12px',
    fontFamily: 'monospace',
    outline: 'none',
    width: '80px',
  },
};

export default function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHexInput(color);
  }, [color]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleHexSubmit() {
    let hex = hexInput.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
      onChange(hex);
    }
  }

  return (
    <div ref={wrapperRef} style={styles.wrapper}>
      <button
        style={{ ...styles.trigger, background: color }}
        onClick={() => setOpen(!open)}
        title="Pick color"
      />
      {open && (
        <div style={styles.popup}>
          <div style={styles.grid}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                style={{
                  ...styles.swatch,
                  background: c,
                  borderColor: c === color ? '#4a9eff' : 'transparent',
                }}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                title={c}
              />
            ))}
          </div>
          <div style={styles.hexRow}>
            <span style={styles.hexLabel}>#</span>
            <input
              style={styles.hexInput}
              value={hexInput.replace('#', '')}
              onChange={(e) => setHexInput('#' + e.target.value)}
              onBlur={handleHexSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleHexSubmit();
              }}
              maxLength={8}
              placeholder="hex"
            />
          </div>
        </div>
      )}
    </div>
  );
}
