import React from 'react';

interface SelectionToolbarProps {
  /** Screen-space position of the selection's top-center */
  x: number;
  y: number;
  count: number;
  onAlignLeft: () => void;
  onAlignCenterH: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignCenterV: () => void;
  onAlignBottom: () => void;
  onDistributeH: () => void;
  onDistributeV: () => void;
  onPack: () => void;
  onGrid: () => void;
  onRow: () => void;
  onColumn: () => void;
  onStack: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onGroup: () => void;
  onNormSize: () => void;
}

// Tiny SVG icons for each action
function IcoAlignL() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="2" y1="1" x2="2" y2="13" /><rect x="4" y="3" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="4" y="8" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.3" /></svg>;
}
function IcoAlignCH() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="7" y1="1" x2="7" y2="13" strokeDasharray="1.5 1.5" /><rect x="2" y="3" width="10" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="3.5" y="8" width="7" height="3" rx="0.5" fill="currentColor" opacity="0.3" /></svg>;
}
function IcoAlignR() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="12" y1="1" x2="12" y2="13" /><rect x="2" y="3" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="5" y="8" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.3" /></svg>;
}
function IcoAlignT() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="1" y1="2" x2="13" y2="2" /><rect x="3" y="4" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="8" y="4" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.3" /></svg>;
}
function IcoAlignCV() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="1" y1="7" x2="13" y2="7" strokeDasharray="1.5 1.5" /><rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="8" y="3.5" width="3" height="7" rx="0.5" fill="currentColor" opacity="0.3" /></svg>;
}
function IcoAlignB() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="1" y1="12" x2="13" y2="12" /><rect x="3" y="2" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="8" y="5" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.3" /></svg>;
}
function IcoDistH() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="3" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="5.5" y="3" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="10" y="3" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.3" /><path d="M4.5 7h1M9 7h1" strokeWidth="1" /></svg>;
}
function IcoDistV() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="1" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="3" y="5.5" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="3" y="10" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><path d="M7 4.5v1M7 9v1" strokeWidth="1" /></svg>;
}
function IcoPack() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="5" height="6" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="7" y="1" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="1" y="8" width="4" height="5" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="6" y="6" width="7" height="7" rx="0.5" fill="currentColor" opacity="0.2" /></svg>;
}
function IcoGrid() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="8" y="1" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="1" y="8" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="8" y="8" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.2" /></svg>;
}
function IcoRow() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="4" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="5.5" y="4" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="10" y="4" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.2" /></svg>;
}
function IcoCol() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="4" y="1" width="6" height="3" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="4" y="5.5" width="6" height="3" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="4" y="10" width="6" height="3" rx="0.5" fill="currentColor" opacity="0.2" /></svg>;
}
function IcoStack() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="2" width="10" height="10" rx="0.5" fill="currentColor" opacity="0.15" /><rect x="3" y="3" width="8" height="8" rx="0.5" fill="currentColor" opacity="0.15" /><rect x="4" y="4" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.2" /></svg>;
}
function IcoFlipH() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="7" y1="1" x2="7" y2="13" strokeDasharray="2 1" /><path d="M5 4H2L5 10V4Z" fill="currentColor" opacity="0.3" /><path d="M9 4H12L9 10V4Z" fill="currentColor" opacity="0.15" /></svg>;
}
function IcoFlipV() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="1" y1="7" x2="13" y2="7" strokeDasharray="2 1" /><path d="M4 5V2L10 5H4Z" fill="currentColor" opacity="0.3" /><path d="M4 9V12L10 9H4Z" fill="currentColor" opacity="0.15" /></svg>;
}
function IcoGroup() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="12" height="12" rx="1.5" strokeDasharray="2 1.5" /><rect x="3" y="3" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.25" /><rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.25" /></svg>;
}
function IcoNormSize() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="4" width="5" height="8" rx="0.5" fill="currentColor" opacity="0.2" /><rect x="8" y="2" width="5" height="10" rx="0.5" fill="currentColor" opacity="0.2" /><path d="M3.5 1v2M10.5 1v2" strokeLinecap="round" /><line x1="3.5" y1="1.5" x2="10.5" y2="1.5" strokeLinecap="round" /></svg>;
}

interface BtnDef {
  icon: React.FC;
  label: string;
  shortcut: string;
  onClick: () => void;
  minItems?: number;
}

export default function SelectionToolbar(props: SelectionToolbarProps) {
  const { x, y, count } = props;

  const groups: { label: string; items: BtnDef[] }[] = [
    {
      label: 'Align',
      items: [
        { icon: IcoAlignL, label: 'Align left', shortcut: 'Ctrl+\u2190', onClick: props.onAlignLeft },
        { icon: IcoAlignCH, label: 'Align center H', shortcut: 'Ctrl+Alt+H', onClick: props.onAlignCenterH },
        { icon: IcoAlignR, label: 'Align right', shortcut: 'Ctrl+\u2192', onClick: props.onAlignRight },
        { icon: IcoAlignT, label: 'Align top', shortcut: 'Ctrl+\u2191', onClick: props.onAlignTop },
        { icon: IcoAlignCV, label: 'Align center V', shortcut: 'Ctrl+Alt+V', onClick: props.onAlignCenterV },
        { icon: IcoAlignB, label: 'Align bottom', shortcut: 'Ctrl+\u2193', onClick: props.onAlignBottom },
      ],
    },
    {
      label: 'Distribute',
      items: [
        { icon: IcoDistH, label: 'Distribute H', shortcut: 'Ctrl+Shift+H', onClick: props.onDistributeH, minItems: 3 },
        { icon: IcoDistV, label: 'Distribute V', shortcut: 'Ctrl+Shift+V', onClick: props.onDistributeV, minItems: 3 },
      ],
    },
    {
      label: 'Arrange',
      items: [
        { icon: IcoPack, label: 'Pack', shortcut: 'Ctrl+Shift+P', onClick: props.onPack },
        { icon: IcoGrid, label: 'Grid', shortcut: '', onClick: props.onGrid },
        { icon: IcoRow, label: 'Row', shortcut: '', onClick: props.onRow },
        { icon: IcoCol, label: 'Column', shortcut: '', onClick: props.onColumn },
        { icon: IcoStack, label: 'Stack', shortcut: 'Ctrl+Alt+S', onClick: props.onStack },
      ],
    },
    {
      label: 'Transform',
      items: [
        { icon: IcoFlipH, label: 'Flip H', shortcut: 'Alt+Shift+H', onClick: props.onFlipH },
        { icon: IcoFlipV, label: 'Flip V', shortcut: 'Alt+Shift+V', onClick: props.onFlipV },
        { icon: IcoGroup, label: 'Group', shortcut: 'Ctrl+G', onClick: props.onGroup },
        { icon: IcoNormSize, label: 'Same size', shortcut: '', onClick: props.onNormSize },
      ],
    },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y - 8,
        transform: 'translate(-50%, -100%)',
        display: 'flex',
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
      {groups.map((group, gi) => (
        <React.Fragment key={group.label}>
          {gi > 0 && (
            <div style={{ width: '1px', background: '#333', margin: '2px 2px', flexShrink: 0 }} />
          )}
          <div style={{ display: 'flex', gap: '1px' }}>
            {group.items.map((btn) => {
              const disabled = (btn.minItems ?? 2) > count;
              const Icon = btn.icon;
              return (
                <button
                  key={btn.label}
                  onClick={btn.onClick}
                  disabled={disabled}
                  title={btn.shortcut ? `${btn.label} (${btn.shortcut})` : btn.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '26px',
                    height: '26px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '5px',
                    color: disabled ? '#444' : '#999',
                    cursor: disabled ? 'default' : 'pointer',
                    padding: 0,
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled) {
                      e.currentTarget.style.background = '#333';
                      e.currentTarget.style.color = '#fff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = disabled ? '#444' : '#999';
                  }}
                >
                  <Icon />
                </button>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
