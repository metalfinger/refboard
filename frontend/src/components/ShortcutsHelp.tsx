import React, { useEffect } from 'react';
import { ShortcutDef, formatShortcut } from '../canvas/shortcuts';

interface ShortcutsHelpProps {
  shortcuts: ShortcutDef[];
  onClose: () => void;
}

const categoryLabels: Record<string, string> = {
  alignment: 'Alignment & Distribution',
  normalize: 'Normalize',
  arrangement: 'Arrangement',
  image: 'Image Manipulation',
  navigation: 'Navigation',
  editing: 'Editing',
  view: 'View',
  tools: 'Tools',
};

const categoryOrder = ['editing', 'alignment', 'normalize', 'arrangement', 'image', 'navigation', 'view', 'tools'];

// Deduplicate shortcuts that share the same description (e.g. redo via Ctrl+Y and Ctrl+Shift+Z)
function dedupe(defs: ShortcutDef[]): ShortcutDef[] {
  const seen = new Set<string>();
  return defs.filter((d) => {
    // Keep the first occurrence by description+category, skip duplicates like zoom-in-plus
    const key = `${d.category}:${d.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function ShortcutsHelp({ shortcuts, onClose }: ShortcutsHelpProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || (e.key === '/' && e.shiftKey) || e.key === 'F1') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Additional tool shortcuts not in registry
  const toolShortcuts = [
    { keys: 'V / 1', description: 'Select tool' },
    { keys: 'P / 3', description: 'Draw tool' },
    { keys: 'T / 4', description: 'Text tool' },
    { keys: 'S / 5', description: 'Sticky note tool' },
    { keys: 'Space + drag', description: 'Pan canvas' },
    { keys: 'Scroll', description: 'Zoom' },
    { keys: 'Middle click + drag', description: 'Pan canvas' },
  ];

  const deduped = dedupe(shortcuts);
  const grouped = categoryOrder
    .map((cat) => ({
      category: cat,
      label: categoryLabels[cat] || cat,
      items: deduped.filter((s) => s.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#141414', border: '1px solid #222', borderRadius: '16px',
          width: '100%', maxWidth: '720px', maxHeight: '85vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 16px', borderBottom: '1px solid #1e1e1e', flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#e0e0e0', letterSpacing: '-0.3px' }}>
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: '6px',
              color: '#888', padding: '4px 12px', cursor: 'pointer', fontSize: '11px',
            }}
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px 24px' }}>
          {/* Tool shortcuts (hardcoded since they use a different system) */}
          <SectionHeader label="Tools" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
            {toolShortcuts.map((s) => (
              <ShortcutRow key={s.keys} keys={s.keys} description={s.description} />
            ))}
          </div>

          {/* Registry shortcuts */}
          {grouped.map((g) => (
            <React.Fragment key={g.category}>
              <SectionHeader label={g.label} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
                {g.items.map((s) => (
                  <ShortcutRow key={s.id} keys={formatShortcut(s)} description={s.description} />
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: '10px', fontWeight: 700, color: '#4a9eff', letterSpacing: '0.8px',
      textTransform: 'uppercase', padding: '16px 0 6px', borderBottom: '1px solid #1a1a1a',
      marginBottom: '4px',
    }}>
      {label}
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string; description: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '5px 8px', borderRadius: '4px',
    }}>
      <span style={{ fontSize: '12px', color: '#aaa' }}>{description}</span>
      <kbd style={{
        fontSize: '10px', color: '#777', background: '#1a1a1a',
        border: '1px solid #2a2a2a', borderRadius: '4px',
        padding: '2px 8px', fontFamily: 'inherit', whiteSpace: 'nowrap',
        marginLeft: '12px',
      }}>
        {keys}
      </kbd>
    </div>
  );
}
