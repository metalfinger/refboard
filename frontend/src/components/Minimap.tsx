import React, { useRef, useEffect, useCallback } from 'react';

interface MinimapItem {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  id: string;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MinimapProps {
  items: MinimapItem[];
  viewportBounds: Bounds;   // world-space visible area
  contentBounds: Bounds;    // world-space all-content bounds
  onNavigate: (worldX: number, worldY: number) => void;
}

const MAP_W = 180;
const MAP_H = 120;
const PADDING_RATIO = 0.1;

const TYPE_COLORS: Record<string, string> = {
  image: '#4a9eff',
  video: '#ff6b6b',
  text: '#69db7c',
  drawing: '#ffd43b',
  group: '#7950f2',
};

function getColor(type: string): string {
  return TYPE_COLORS[type] ?? '#888';
}

/** Compute the union of two bounding boxes. */
function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export default function Minimap({ items, viewportBounds, contentBounds, onNavigate }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Compute the mapping from world space to minimap pixel space.
  // Returns { offsetX, offsetY, scale } so that:
  //   minimapX = (worldX - offsetX) * scale
  //   minimapY = (worldY - offsetY) * scale
  const getMapping = useCallback(() => {
    const scene = unionBounds(contentBounds, viewportBounds);

    // Add 10% padding
    const padX = scene.w * PADDING_RATIO;
    const padY = scene.h * PADDING_RATIO;
    const padded: Bounds = {
      x: scene.x - padX,
      y: scene.y - padY,
      w: scene.w + padX * 2,
      h: scene.h + padY * 2,
    };

    // Avoid division by zero
    if (padded.w === 0 || padded.h === 0) {
      return { offsetX: padded.x, offsetY: padded.y, scale: 1 };
    }

    const scale = Math.min(MAP_W / padded.w, MAP_H / padded.h);
    return { offsetX: padded.x, offsetY: padded.y, scale };
  }, [contentBounds, viewportBounds]);

  // Convert minimap pixel coords to world coords
  const minimapToWorld = useCallback((mx: number, my: number): { wx: number; wy: number } => {
    const { offsetX, offsetY, scale } = getMapping();
    return {
      wx: mx / scale + offsetX,
      wy: my / scale + offsetY,
    };
  }, [getMapping]);

  // Handle pointer interaction (click / drag to navigate)
  const handlePointerEvent = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { wx, wy } = minimapToWorld(mx, my);
    onNavigate(wx, wy);
  }, [minimapToWorld, onNavigate]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    handlePointerEvent(e);
  }, [handlePointerEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    handlePointerEvent(e);
  }, [handlePointerEvent]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
  }, []);

  // Draw minimap
  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = MAP_W * dpr;
      canvas.height = MAP_H * dpr;
      ctx.scale(dpr, dpr);

      // Clear
      ctx.clearRect(0, 0, MAP_W, MAP_H);

      const { offsetX, offsetY, scale } = getMapping();

      const toX = (wx: number) => (wx - offsetX) * scale;
      const toY = (wy: number) => (wy - offsetY) * scale;

      // Draw items
      for (const item of items) {
        const rx = toX(item.x);
        const ry = toY(item.y);
        const rw = Math.max(item.w * scale, 2);
        const rh = Math.max(item.h * scale, 2);
        ctx.fillStyle = getColor(item.type);
        ctx.fillRect(rx, ry, rw, rh);
      }

      // Draw viewport frustum
      const vx = toX(viewportBounds.x);
      const vy = toY(viewportBounds.y);
      const vw = viewportBounds.w * scale;
      const vh = viewportBounds.h * scale;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(vx, vy, vw, vh);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx + 0.5, vy + 0.5, vw, vh);
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [items, viewportBounds, contentBounds, getMapping]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        width: MAP_W,
        height: MAP_H,
        background: 'rgba(20, 20, 20, 0.9)',
        border: '1px solid #333',
        borderRadius: 8,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 100,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
