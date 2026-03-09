import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

interface CursorData {
  userId: string;
  displayName: string;
  x: number;
  y: number;
  color: string;
}

const CURSOR_COLORS = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9',
  '#4dabf7', '#7950f2', '#e64980', '#20c997', '#ff922b',
];

function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

interface UserCursorsProps {
  socket: Socket | null;
  boardId: string;
  canvasTransform: number[];
}

export default function UserCursors({ socket, boardId, canvasTransform }: UserCursorsProps) {
  const [cursors, setCursors] = useState<Map<string, CursorData>>(new Map());

  useEffect(() => {
    if (!socket) return;

    function handleCursorMove(data: any) {
      const uid = data.userId || data.id;
      const name = data.displayName || data.userName || data.display_name || '';
      if (!uid) return;
      setCursors((prev) => {
        const next = new Map(prev);
        next.set(uid, { userId: uid, displayName: name, x: data.x, y: data.y, color: userColor(uid) });
        return next;
      });
    }

    function handleUserLeft(data: any) {
      const uid = data.userId || data.id;
      if (!uid) return;
      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });
    }

    socket.on('cursor:moved', handleCursorMove);
    socket.on('user:left', handleUserLeft);

    return () => {
      socket.off('cursor:moved', handleCursorMove);
      socket.off('user:left', handleUserLeft);
    };
  }, [socket]);

  if (cursors.size === 0) return null;

  const [zoom, , , , panX, panY] = canvasTransform.length >= 6
    ? canvasTransform
    : [1, 0, 0, 1, 0, 0];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {Array.from(cursors.values()).map((cursor) => {
        // Transform canvas coords to screen coords
        const screenX = cursor.x * zoom + panX;
        const screenY = cursor.y * zoom + panY;

        return (
          <div
            key={cursor.userId}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translate(-2px, -2px)',
              transition: 'left 0.1s, top 0.1s',
            }}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
              <path
                d="M1 1L6 18L8.5 10.5L15 8.5L1 1Z"
                fill={cursor.color}
                stroke="#000"
                strokeWidth="1"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                left: '14px',
                top: '14px',
                background: cursor.color,
                color: '#000',
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              {cursor.displayName}
            </div>
          </div>
        );
      })}
    </div>
  );
}
