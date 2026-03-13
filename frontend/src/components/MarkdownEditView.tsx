/**
 * MarkdownEditView — BlockNote editor wrapper for markdown card edit mode.
 * Lazy-loaded on first double-click via dynamic import().
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteViewRaw } from '@blocknote/react';
import '@blocknote/react/style.css';

interface MarkdownEditViewProps {
  initialContent: string;
  accentColor: string;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

// Markdown conversion is built into the BlockNote editor instance:
// - editor.tryParseMarkdownToBlocks(md) — markdown → blocks
// - editor.blocksToMarkdownLossy(blocks) — blocks → markdown
// No separate @blocknote/xl-markdown package needed.

export default function MarkdownEditView(props: MarkdownEditViewProps) {
  const { initialContent, accentColor, onSave, onCancel } = props;
  const savedRef = useRef(false);

  const editor = useCreateBlockNote({
    domAttributes: {
      editor: {
        'data-theme': 'dark',
      },
    },
  });

  // Initialize editor content from markdown
  useEffect(() => {
    const blocks = editor.tryParseMarkdownToBlocks(initialContent);
    editor.replaceBlocks(editor.document, blocks);
  }, []); // Only on mount

  const doSave = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    const md = editor.blocksToMarkdownLossy(editor.document);
    onSave(md);
  }, [editor, onSave]);

  const doCancel = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    onCancel();
  }, [onCancel]);

  // Ctrl+Enter to save, Escape to cancel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        doSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        doCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true); // capture phase
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [doSave, doCancel]);

  // Click outside to save
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-markdown-edit]')) {
        doSave();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onClick);
    }, 200);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onClick);
    };
  }, [doSave]);

  // Header with Done/Cancel controls
  const headerStyle: React.CSSProperties = {
    padding: '7px 14px',
    background: '#2a2a42',
    borderBottom: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '11px',
  };

  return (
    <div
      data-markdown-edit
      style={{
        border: `1.5px solid ${accentColor}`,
        borderRadius: '10px',
        overflow: 'hidden',
        boxShadow: `0 4px 24px ${accentColor}33`,
      }}
    >
      <div style={headerStyle}>
        <span style={{ color: '#ccc' }}>Editing</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: '10px' }}>Esc cancel</span>
          <button
            onClick={doSave}
            style={{
              background: accentColor,
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '3px 10px',
              fontSize: '10px',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
      <div style={{ minHeight: '100px' }}>
        <BlockNoteViewRaw editor={editor} theme="dark" />
      </div>
    </div>
  );
}
