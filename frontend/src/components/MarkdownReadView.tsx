/**
 * MarkdownReadView — renders markdown content in read mode using
 * react-markdown + remark-gfm. Handles dark-theme styling and
 * clickable task checkboxes.
 */

import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { Element } from 'hast';
import {
  MD_HEADER_BG,
  MD_MAX_CONTENT_LENGTH,
  extractTitle,
} from '../canvas/markdownDefaults';

interface MarkdownReadViewProps {
  content: string;
  textColor: string;
  accentColor: string;
  bgColor: string;
  padding: number;
  name?: string;
  onCheckboxToggle?: (newContent: string) => void;
}

/** Check if the Nth checkbox (outside fenced code blocks) is checked. */
function isCheckboxChecked(content: string, index: number): boolean {
  let count = 0;
  let inCodeBlock = false;
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    if (/^\s*-\s*\[[ xX]\]/.test(line)) {
      if (count === index) return /^\s*-\s*\[[xX]\]/.test(line);
      count++;
    }
  }
  return false;
}

/** Toggle the Nth checkbox (outside fenced code blocks) in a markdown string. */
function toggleCheckbox(content: string, index: number): string {
  let count = 0;
  let inCodeBlock = false;

  return content.split('\n').map((line) => {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;

    const unchecked = /^(\s*-\s*)\[ \]/;
    const checked = /^(\s*-\s*)\[x\]/i;

    if (unchecked.test(line) || checked.test(line)) {
      if (count === index) {
        count++;
        if (unchecked.test(line)) {
          return line.replace(unchecked, '$1[x]');
        } else {
          return line.replace(checked, '$1[ ]');
        }
      }
      count++;
    }
    return line;
  }).join('\n');
}

export default function MarkdownReadView(props: MarkdownReadViewProps) {
  const { content, textColor, accentColor, bgColor: _bgColor, padding, name, onCheckboxToggle } = props;

  const displayContent = content.length > MD_MAX_CONTENT_LENGTH
    ? content.slice(0, MD_MAX_CONTENT_LENGTH) + '\n\n---\n*Content truncated*'
    : content;

  const title = name || extractTitle(content);

  const checkboxIndexRef = React.useRef(0);
  checkboxIndexRef.current = 0;

  const handleCheckboxClick = useCallback((idx: number) => {
    if (!onCheckboxToggle) return;
    const newContent = toggleCheckbox(content, idx);
    onCheckboxToggle(newContent);
  }, [content, onCheckboxToggle]);

  const containerStyle: React.CSSProperties = {
    color: textColor,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px',
    lineHeight: '1.6',
  };

  const headerStyle: React.CSSProperties = {
    padding: '7px 14px',
    background: MD_HEADER_BG,
    borderBottom: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    fontSize: '11px',
  };

  const bodyStyle: React.CSSProperties = {
    padding: `${padding}px`,
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: '13px' }}>📄</span>
        <span style={{ color: '#999', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ color: '#555', fontSize: '9px', background: '#333', padding: '1px 6px', borderRadius: '3px' }}>MD</span>
      </div>
      <div style={bodyStyle}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            h1: ({ children }) => <h1 style={{ color: '#fff', fontSize: '20px', fontWeight: 700, margin: '0 0 10px 0', lineHeight: 1.3 }}>{children}</h1>,
            h2: ({ children }) => <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 700, margin: '12px 0 8px 0', lineHeight: 1.3 }}>{children}</h2>,
            h3: ({ children }) => <h3 style={{ color: '#fff', fontSize: '14px', fontWeight: 700, margin: '10px 0 6px 0', lineHeight: 1.3 }}>{children}</h3>,
            p: ({ children }) => <p style={{ margin: '0 0 10px 0', color: textColor }}>{children}</p>,
            strong: ({ children }) => <strong style={{ color: '#fff' }}>{children}</strong>,
            em: ({ children }) => <em>{children}</em>,
            del: ({ children }) => <del style={{ color: '#888' }}>{children}</del>,
            blockquote: ({ children }) => (
              <blockquote style={{ borderLeft: `3px solid ${accentColor}`, paddingLeft: '14px', margin: '10px 0', color: '#999', fontStyle: 'italic' }}>
                {children}
              </blockquote>
            ),
            code: ({ className, children }) => {
              const isBlock = className?.startsWith('language-');
              if (isBlock) {
                const lang = className?.replace('language-', '') ?? '';
                return (
                  <div style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: '6px', margin: '10px 0', overflow: 'hidden' }}>
                    {lang && <div style={{ padding: '4px 14px', color: '#555', fontSize: '9px', borderBottom: '1px solid #333' }}>{lang}</div>}
                    <pre style={{ margin: 0, padding: '10px 14px', overflow: 'auto' }}>
                      <code style={{ fontFamily: "'Fira Code', Consolas, monospace", fontSize: '11px', color: '#b0b0b0' }}>{children}</code>
                    </pre>
                  </div>
                );
              }
              return <code style={{ background: '#1a1a2e', padding: '1px 5px', borderRadius: '3px', fontFamily: "'Fira Code', Consolas, monospace", fontSize: '12px' }}>{children}</code>;
            },
            ul: ({ children }) => <ul style={{ margin: '0 0 10px 0', paddingLeft: '18px' }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ margin: '0 0 10px 0', paddingLeft: '18px' }}>{children}</ol>,
            li: ({ children, node }) => {
              const hastNode = node as Element | undefined;
              const classList = hastNode?.properties?.className;
              const isTask = Array.isArray(classList)
                ? classList.includes('task-list-item')
                : typeof classList === 'string' && classList.includes('task-list-item');

              if (isTask) {
                const idx = checkboxIndexRef.current++;
                const checked = isCheckboxChecked(content, idx);
                return (
                  <li style={{ listStyle: 'none', marginLeft: '-18px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div
                      onClick={(e) => { e.stopPropagation(); handleCheckboxClick(idx); }}
                      style={{
                        width: '14px', height: '14px', borderRadius: '3px', cursor: 'pointer', flexShrink: 0,
                        pointerEvents: 'auto',
                        ...(checked
                          ? { background: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }
                          : { border: '1.5px solid #555' }),
                      }}
                    >
                      {checked && <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>}
                    </div>
                    <span style={checked ? { color: '#888', textDecoration: 'line-through' } : {}}>{children}</span>
                  </li>
                );
              }

              return <li style={{ marginBottom: '4px' }}>{children}</li>;
            },
            table: ({ children }) => (
              <table style={{ borderCollapse: 'collapse', width: '100%', margin: '10px 0', fontSize: '12px' }}>{children}</table>
            ),
            th: ({ children }) => (
              <th style={{ border: '1px solid #333', padding: '6px 10px', textAlign: 'left', background: '#2a2a42', color: '#ccc', fontWeight: 600 }}>{children}</th>
            ),
            td: ({ children }) => (
              <td style={{ border: '1px solid #333', padding: '6px 10px', color: textColor }}>{children}</td>
            ),
            hr: () => <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '14px 0' }} />,
            a: ({ children, href }) => <a href={href} style={{ color: accentColor }} target="_blank" rel="noopener noreferrer">{children}</a>,
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
