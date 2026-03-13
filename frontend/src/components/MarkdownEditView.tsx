/**
 * MarkdownEditView — BlockNote editor in a side panel.
 * Lazy-loaded on first double-click via dynamic import().
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { MD_BLOCKNOTE_DARK_CSS } from '../canvas/markdownStyles';

interface MarkdownEditViewProps {
  initialContent: string;
  accentColor: string;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

export default function MarkdownEditView(props: MarkdownEditViewProps) {
  const { initialContent, accentColor, onSave, onCancel } = props;
  const savedRef = useRef(false);

  // Inject BlockNote dark theme CSS overrides (once)
  useEffect(() => {
    const id = 'bn-dark-theme-overrides';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = MD_BLOCKNOTE_DARK_CSS;
      document.head.appendChild(style);
    }
  }, []);

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
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [doSave, doCancel]);

  return (
    <div
      data-markdown-edit
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        background: '#1a1a2e',
        borderBottom: `2px solid ${accentColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ color: '#ccc', fontSize: '12px', fontWeight: 500 }}>Markdown Editor</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: '10px' }}>Esc cancel · Ctrl+Enter save</span>
          <button
            onClick={doCancel}
            style={{
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #444',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={doSave}
            style={{
              background: accentColor,
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Done
          </button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <BlockNoteView editor={editor} theme="dark" />
      </div>
    </div>
  );
}
