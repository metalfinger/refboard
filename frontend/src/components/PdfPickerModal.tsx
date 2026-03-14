import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { getSocket } from '../socket';

interface PdfPickerModalProps {
  imageId: string;
  fileName: string;
  pageCount: number;
  dimensions: Array<{ w: number; h: number }>;
  boardId: string;
  onPlace: (selectedPages: number[]) => void;
  onCancel: () => void;
}

const MAX_SELECTIONS = 50;
const THUMB_BATCH = 20;
const GRID_COLS = 5;

export default function PdfPickerModal({
  imageId, fileName, pageCount, dimensions, boardId, onPlace, onCancel,
}: PdfPickerModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const [thumbsLoaded, setThumbsLoaded] = useState(0);
  const [requestedUpTo, setRequestedUpTo] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestingRef = useRef(false);

  // Request first batch of thumbnails on mount
  useEffect(() => {
    requestThumbnails(1, Math.min(THUMB_BATCH, pageCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for socket thumbnail events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (data: any) => {
      if (!data || data.imageId !== imageId) return;
      if (data.type === 'pdf-thumbnail' && data.status === 'done') {
        const page: number = data.pageNumber;
        const key: string = data.thumbAssetKey;
        if (page && key) {
          setThumbs(prev => {
            const next = new Map(prev);
            next.set(page, key);
            return next;
          });
          setThumbsLoaded(prev => prev + 1);
        }
      }
    };

    socket.on('media:job:update', handler);
    return () => { socket.off('media:job:update', handler); };
  }, [imageId]);

  const requestThumbnails = useCallback(async (from: number, to: number) => {
    if (requestingRef.current) return;
    if (from > pageCount) return;
    const clampedTo = Math.min(to, pageCount);
    if (clampedTo <= requestedUpTo) return;

    requestingRef.current = true;
    const pages: number[] = [];
    for (let p = Math.max(from, requestedUpTo + 1); p <= clampedTo; p++) pages.push(p);

    if (pages.length > 0) {
      try {
        await api.post(`/api/boards/${boardId}/pdf-thumbnails`, {
          imageId,
          pages,
        });
      } catch (err) {
        console.error('[PdfPickerModal] thumbnail request failed:', err);
      }
    }
    setRequestedUpTo(clampedTo);
    requestingRef.current = false;
  }, [boardId, imageId, pageCount, requestedUpTo]);

  // Lazy scroll loading — request next batch when near bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom && requestedUpTo < pageCount) {
      requestThumbnails(requestedUpTo + 1, requestedUpTo + THUMB_BATCH);
    }
  }, [requestThumbnails, requestedUpTo, pageCount]);

  const togglePage = (page: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(page)) {
        next.delete(page);
      } else if (next.size < MAX_SELECTIONS) {
        next.add(page);
      }
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set<number>();
    const max = Math.min(pageCount, MAX_SELECTIONS);
    for (let i = 1; i <= max; i++) all.add(i);
    setSelected(all);
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const handlePlace = () => {
    if (selected.size === 0) return;
    const sorted = Array.from(selected).sort((a, b) => a - b);
    onPlace(sorted);
  };

  // Build asset URL from key
  const thumbUrl = (key: string) => `/api/images/${key}`;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {pageCount} page{pageCount !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={smallBtnStyle} onClick={selectAll}>Select all</button>
            <button style={smallBtnStyle} onClick={deselectAll}>Deselect all</button>
          </div>
        </div>

        {/* Sub-header: loading counter */}
        <div style={{ padding: '4px 20px 8px', fontSize: 12, color: '#666' }}>
          Loading thumbnails... ({thumbsLoaded}/{pageCount})
        </div>

        {/* Scrollable thumbnail grid */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={gridContainerStyle}
        >
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gap: 8 }}>
            {Array.from({ length: pageCount }, (_, i) => {
              const page = i + 1;
              const dim = dimensions[i] || { w: 612, h: 792 };
              const aspect = dim.h / dim.w;
              const isSelected = selected.has(page);
              const thumbKey = thumbs.get(page);

              return (
                <div
                  key={page}
                  onClick={() => togglePage(page)}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: isSelected ? '2px solid #4a9eff' : '2px solid transparent',
                    background: '#1a1a1a',
                  }}
                >
                  <div style={{ paddingTop: `${aspect * 100}%`, position: 'relative' }}>
                    {thumbKey ? (
                      <img
                        src={thumbUrl(thumbKey)}
                        alt={`Page ${page}`}
                        style={{
                          position: 'absolute',
                          top: 0, left: 0, width: '100%', height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <div style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        background: '#2a2a2a',
                        animation: 'pdfPickerPulse 1.5s ease-in-out infinite',
                      }} />
                    )}
                  </div>
                  {/* Page number badge */}
                  <div style={{
                    position: 'absolute', bottom: 4, right: 4,
                    background: 'rgba(0,0,0,0.7)', color: '#ccc',
                    fontSize: 10, padding: '1px 5px', borderRadius: 3,
                  }}>
                    {page}
                  </div>
                  {/* Selection checkmark */}
                  {isSelected && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 20, height: 20, borderRadius: '50%',
                      background: '#4a9eff', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: '#fff',
                    }}>
                      ✓
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button style={cancelBtnStyle} onClick={onCancel}>Cancel</button>
          <button
            style={{
              ...placeBtnStyle,
              opacity: selected.size === 0 ? 0.4 : 1,
              cursor: selected.size === 0 ? 'default' : 'pointer',
            }}
            disabled={selected.size === 0}
            onClick={handlePlace}
          >
            Place {selected.size} page{selected.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>

      {/* Keyframe animation for pulsing placeholder */}
      <style>{`
        @keyframes pdfPickerPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

// Styles
const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.6)', zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const panelStyle: React.CSSProperties = {
  width: 700, maxHeight: '80vh', background: '#242424',
  borderRadius: 8, display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12,
  borderBottom: '1px solid #333',
};

const smallBtnStyle: React.CSSProperties = {
  background: '#333', border: 'none', color: '#ccc',
  padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
};

const gridContainerStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '8px 20px',
  minHeight: 0,
};

const footerStyle: React.CSSProperties = {
  padding: '12px 20px', borderTop: '1px solid #333',
  display: 'flex', justifyContent: 'flex-end', gap: 10,
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #555', color: '#aaa',
  padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};

const placeBtnStyle: React.CSSProperties = {
  background: '#4a9eff', border: 'none', color: '#fff',
  padding: '8px 20px', borderRadius: 4, fontSize: 13, fontWeight: 600,
};
