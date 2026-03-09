import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Canvas, FabricImage, FabricObject } from 'fabric';
import { suppressBroadcasts, resumeBroadcasts } from './sync';

export interface FabricCanvasHandle {
  getCanvas: () => Canvas | null;
  fitAll: () => void;
  getZoom: () => number;
  setZoom: (zoom: number) => void;
}

interface FabricCanvasProps {
  canvasState?: string | null;
  currentTool: string;
  onChange?: () => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

const FabricCanvas = forwardRef<FabricCanvasHandle, FabricCanvasProps>(
  ({ canvasState, currentTool, onChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const isPanning = useRef(false);
    const lastPanPoint = useRef<{ x: number; y: number } | null>(null);
    const spaceHeld = useRef(false);
    const initialLoadDone = useRef(false);

    // Initialize Fabric canvas
    useEffect(() => {
      if (!canvasElRef.current || fabricRef.current) return;

      const container = containerRef.current!;
      const width = container.clientWidth;
      const height = container.clientHeight;

      const canvas = new Canvas(canvasElRef.current, {
        width,
        height,
        backgroundColor: '#1e1e1e',
        selection: true,
        selectionColor: 'rgba(74, 158, 255, 0.15)',
        selectionBorderColor: '#4a9eff',
        selectionLineWidth: 1,
        preserveObjectStacking: true,
      });

      fabricRef.current = canvas;

      // Handle resize
      const observer = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        canvas.setDimensions({ width: w, height: h });
        canvas.requestRenderAll();
      });
      observer.observe(container);

      // Middle-mouse pan
      canvas.on('mouse:down', (e: any) => {
        if (e.e.button === 1 || (spaceHeld.current && e.e.button === 0)) {
          isPanning.current = true;
          lastPanPoint.current = { x: e.e.clientX, y: e.e.clientY };
          canvas.defaultCursor = 'grabbing';
          canvas.upperCanvasEl.style.cursor = 'grabbing';
          e.e.preventDefault();
        }
      });

      canvas.on('mouse:move', (e: any) => {
        if (!isPanning.current || !lastPanPoint.current) return;
        const vpt = canvas.viewportTransform!;
        vpt[4] += e.e.clientX - lastPanPoint.current.x;
        vpt[5] += e.e.clientY - lastPanPoint.current.y;
        lastPanPoint.current = { x: e.e.clientX, y: e.e.clientY };
        canvas.requestRenderAll();
      });

      canvas.on('mouse:up', () => {
        if (isPanning.current) {
          isPanning.current = false;
          lastPanPoint.current = null;
          if (!spaceHeld.current) {
            canvas.defaultCursor = 'default';
            canvas.upperCanvasEl.style.cursor = 'default';
          }
        }
      });

      // Scroll zoom — zooms toward cursor (like Figma/PureRef)
      // Normalizes deltaY across mice, trackpads, and browsers for consistent feel
      canvas.on('mouse:wheel', (opt: any) => {
        const e = opt.e as WheelEvent;
        e.preventDefault();
        e.stopPropagation();

        // Normalize delta: mice send large values (~100), trackpads send small (~1-5)
        // Clamp to ±1 and apply a fixed zoom factor per "step" for predictable UX
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 40;    // DOM_DELTA_LINE → px
        if (e.deltaMode === 2) delta *= 800;   // DOM_DELTA_PAGE → px

        // Use sign + magnitude clamping for consistent zoom speed
        const direction = Math.sign(delta);
        const ZOOM_STEP = 0.08; // 8% per step — smooth but responsive
        let zoom = canvas.getZoom();
        zoom *= 1 - direction * ZOOM_STEP;
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

        // Zoom toward cursor position (industry standard)
        const point = canvas.getScenePoint(e);
        canvas.zoomToPoint(point, zoom);
        canvas.requestRenderAll();
      });

      // Space key for pan
      function onKeyDown(e: KeyboardEvent) {
        if (e.code === 'Space' && !spaceHeld.current && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          spaceHeld.current = true;
          canvas.defaultCursor = 'grab';
          canvas.upperCanvasEl.style.cursor = 'grab';
        }
      }

      function onKeyUp(e: KeyboardEvent) {
        if (e.code === 'Space') {
          spaceHeld.current = false;
          if (currentTool !== 'PAN') {
            canvas.defaultCursor = 'default';
            canvas.upperCanvasEl.style.cursor = 'default';
          }
        }
      }

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      // Notify parent of changes
      const changeEvents = ['object:added', 'object:modified', 'object:removed', 'path:created'];
      const changeHandler = () => {
        onChange?.();
      };
      changeEvents.forEach((evt) => canvas.on(evt as any, changeHandler));

      return () => {
        observer.disconnect();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        changeEvents.forEach((evt) => canvas.off(evt as any, changeHandler));
        canvas.dispose();
        fabricRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load initial canvas state
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || initialLoadDone.current) return;
      if (!canvasState) return;

      initialLoadDone.current = true;

      let parsed: any;
      try {
        parsed = typeof canvasState === 'string' ? JSON.parse(canvasState) : canvasState;
      } catch {
        return;
      }

      if (!parsed || (!parsed.objects && !parsed.version)) return;

      // Ensure all images in the JSON have crossOrigin set BEFORE Fabric loads them.
      // Without this, the underlying <img> elements load without CORS headers,
      // tainting the canvas and breaking toCanvasElement/toDataURL/toBlob.
      if (parsed.objects) {
        (parsed.objects as any[]).forEach((obj: any) => {
          if (obj.type === 'image') {
            obj.crossOrigin = 'anonymous';
          }
          // Handle images inside groups
          if (obj.type === 'group' && obj.objects) {
            (obj.objects as any[]).forEach((child: any) => {
              if (child.type === 'image') {
                child.crossOrigin = 'anonymous';
              }
            });
          }
        });
      }

      // Suppress socket broadcasts during initial load — prevents flooding
      // other clients with object:add events for objects they already have
      suppressBroadcasts();
      canvas.loadFromJSON(parsed).then(() => {
        canvas.requestRenderAll();
        // Small delay to ensure all deferred events have fired before resuming
        setTimeout(() => resumeBroadcasts(), 100);
      }).catch((err: Error) => {
        console.error('Failed to load canvas state:', err);
        resumeBroadcasts();
      });
    }, [canvasState]);

    const fitAll = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();
      if (objects.length === 0) {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.requestRenderAll();
        return;
      }

      // Get bounding rect of all objects
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      objects.forEach((obj) => {
        const bound = obj.getBoundingRect();
        minX = Math.min(minX, bound.left);
        minY = Math.min(minY, bound.top);
        maxX = Math.max(maxX, bound.left + bound.width);
        maxY = Math.max(maxY, bound.top + bound.height);
      });

      const objWidth = maxX - minX;
      const objHeight = maxY - minY;
      if (objWidth === 0 || objHeight === 0) return;

      const padding = 40;
      const canvasW = canvas.width!;
      const canvasH = canvas.height!;
      const scaleX = (canvasW - padding * 2) / objWidth;
      const scaleY = (canvasH - padding * 2) / objHeight;
      const zoom = Math.min(scaleX, scaleY, MAX_ZOOM);

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      canvas.setViewportTransform([
        zoom, 0, 0, zoom,
        canvasW / 2 - cx * zoom,
        canvasH / 2 - cy * zoom,
      ]);
      canvas.requestRenderAll();
    }, []);

    useImperativeHandle(ref, () => ({
      getCanvas: () => fabricRef.current,
      fitAll,
      getZoom: () => fabricRef.current?.getZoom() ?? 1,
      setZoom: (zoom: number) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const center = canvas.getCenterPoint();
        canvas.zoomToPoint(center, Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)));
        canvas.requestRenderAll();
      },
    }), [fitAll]);

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          background: '#1e1e1e',
        }}
      >
        <canvas ref={canvasElRef} />
      </div>
    );
  }
);

FabricCanvas.displayName = 'FabricCanvas';

export default FabricCanvas;
