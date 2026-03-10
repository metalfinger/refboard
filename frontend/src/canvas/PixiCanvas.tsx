/**
 * PixiCanvas — main React component wrapping PixiJS v8 + pixi-viewport.
 *
 * Drop-in replacement for FabricCanvas.tsx. Manages the Application lifecycle,
 * viewport (pan/zoom), scene loading, and exposes an imperative handle for
 * parent components.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
  useState,
} from 'react';
import { Application } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { SceneManager, getItemWorldBounds } from './SceneManager';
import { TextureManager } from './TextureManager';
import { SpringManager } from './spring';
import { convertFabricToV2 } from './scene-format';
import type { SceneData } from './scene-format';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PixiCanvasHandle {
  getViewport: () => Viewport | null;
  getScene: () => SceneManager | null;
  getApp: () => Application | null;
  fitAll: () => void;
  getZoom: () => number;
  setZoom: (zoom: number) => void;
}

export interface PixiCanvasProps {
  canvasState?: string | object | null;
  currentTool: string;
  boardId?: string;
  onChange?: () => void;
}

// ---------------------------------------------------------------------------
// Viewport persistence helpers
// ---------------------------------------------------------------------------

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

function vpStorageKey(boardId: string): string {
  return `refboard:viewport:${boardId}`;
}

function loadViewportState(boardId: string): ViewportState | null {
  try {
    const raw = localStorage.getItem(vpStorageKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.scale === 'number'
    ) {
      return parsed as ViewportState;
    }
  } catch {
    // ignore malformed data
  }
  return null;
}

function saveViewportState(boardId: string, vp: Viewport): void {
  const center = vp.center;
  const state: ViewportState = {
    x: center.x,
    y: center.y,
    scale: vp.scale.x,
  };
  try {
    localStorage.setItem(vpStorageKey(boardId), JSON.stringify(state));
  } catch {
    // storage full — not critical
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PixiCanvas = forwardRef<PixiCanvasHandle, PixiCanvasProps>(
  function PixiCanvas({ canvasState, currentTool, boardId, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const viewportRef = useRef<Viewport | null>(null);
    const sceneRef = useRef<SceneManager | null>(null);
    const initialLoadDone = useRef(false);
    const spaceHeld = useRef(false);
    const onChangeRef = useRef(onChange);
    const [pixiReady, setPixiReady] = useState(false);

    // Keep onChange ref current without re-running effects
    onChangeRef.current = onChange;

    // ── Initialization (runs once) ────────────────────────────────────

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let destroyed = false;
      const app = new Application();
      const textures = new TextureManager();
      const springs = new SpringManager();

      (async () => {
        await app.init({
          backgroundAlpha: 0,
          resizeTo: container,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio,
          preserveDrawingBuffer: true,
        });

        if (destroyed) {
          app.destroy(true, { children: true });
          return;
        }

        container.appendChild(app.canvas as HTMLCanvasElement);

        // -- Viewport -------------------------------------------------------

        const viewport = new Viewport({
          screenWidth: container.clientWidth,
          screenHeight: container.clientHeight,
          worldWidth: 4000,
          worldHeight: 4000,
          events: app.renderer.events,
        });

        viewport
          .drag({ mouseButtons: 'middle' })
          .pinch()
          .wheel({ smooth: 5, percent: 0.08 })
          .decelerate({ friction: 0.92 })
          .clampZoom({ minScale: 0.1, maxScale: 5 });

        app.stage.addChild(viewport);

        // -- Scene Manager ---------------------------------------------------

        const scene = new SceneManager(viewport, textures, springs);
        scene.onChange = () => onChangeRef.current?.();

        // -- Spring ticker ---------------------------------------------------

        app.ticker.add((ticker) => {
          springs.tick(ticker.deltaMS / 1000);
        });

        // -- Visibility culling ticker (runs every 200ms, not every frame) --

        let lastCullCheck = 0;
        app.ticker.add((ticker) => {
          lastCullCheck += ticker.deltaMS;
          if (lastCullCheck < 200) return;
          lastCullCheck = 0;

          const bounds = viewport.getVisibleBounds();
          const margin = 200;

          for (const item of scene.getAllItems()) {
            if (item.type === 'video' && 'onVisibilityChange' in item.displayObject) {
              const { x: ix, y: iy, w: iw, h: ih } = getItemWorldBounds(item);
              const inView =
                ix + iw > bounds.x - margin &&
                ix < bounds.x + bounds.width + margin &&
                iy + ih > bounds.y - margin &&
                iy < bounds.y + bounds.height + margin;
              (item.displayObject as any).onVisibilityChange(inView);
            }
          }
        });

        // -- Store refs ------------------------------------------------------

        appRef.current = app;
        viewportRef.current = viewport;
        sceneRef.current = scene;

        // -- Viewport persistence --------------------------------------------

        if (boardId) {
          const saved = loadViewportState(boardId);
          if (saved) {
            viewport.scale.set(saved.scale);
            viewport.moveCenter(saved.x, saved.y);
          }

          viewport.on('moved', () => {
            saveViewportState(boardId, viewport);
          });
        }

        // -- ResizeObserver --------------------------------------------------

        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
              app.renderer.resize(width, height);
              viewport.resize(width, height);
            }
          }
        });
        ro.observe(container);

        // Store observer for cleanup
        (container as any).__pixiRO = ro;

        // Signal that PixiJS is ready for scene loading
        setPixiReady(true);

        // -- Prevent Ctrl+wheel browser zoom on canvas -----------------------
        const preventBrowserZoom = (e: WheelEvent) => {
          if (e.ctrlKey) {
            e.preventDefault();
          }
        };
        container.addEventListener('wheel', preventBrowserZoom, { passive: false });
        (container as any).__pixiWheelHandler = preventBrowserZoom;
      })();

      // -- Cleanup ---------------------------------------------------------

      return () => {
        destroyed = true;

        const ro = (container as any).__pixiRO as ResizeObserver | undefined;
        if (ro) {
          ro.disconnect();
          delete (container as any).__pixiRO;
        }

        const wheelHandler = (container as any).__pixiWheelHandler;
        if (wheelHandler) {
          container.removeEventListener('wheel', wheelHandler);
          delete (container as any).__pixiWheelHandler;
        }

        textures.clear();

        if (appRef.current) {
          appRef.current.destroy(true, { children: true });
        }

        appRef.current = null;
        viewportRef.current = null;
        sceneRef.current = null;
        initialLoadDone.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Initial canvas state load ─────────────────────────────────────

    useEffect(() => {
      if (initialLoadDone.current) return;
      if (!canvasState || !sceneRef.current) return;

      // canvasState may be a JSON string or already-parsed object
      let parsed: any;
      if (typeof canvasState === 'string') {
        try {
          parsed = JSON.parse(canvasState);
        } catch {
          return;
        }
      } else {
        parsed = canvasState;
      }

      let sceneData: SceneData;
      if (parsed.v === 2) {
        sceneData = parsed as SceneData;
      } else {
        sceneData = convertFabricToV2(parsed);
      }

      initialLoadDone.current = true;
      sceneRef.current.loadScene(sceneData, false);
    }, [canvasState, pixiReady]);

    // ── Space key for pan mode ────────────────────────────────────────

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'Space' || spaceHeld.current) return;
        if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

        spaceHeld.current = true;
        const vp = viewportRef.current;
        if (!vp) return;

        e.preventDefault();
        vp.plugins.remove('drag');
        vp.drag({ mouseButtons: 'left' });
        const container = containerRef.current;
        if (container) container.style.cursor = 'grab';
      };

      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code !== 'Space') return;

        spaceHeld.current = false;
        const vp = viewportRef.current;
        if (!vp) return;

        vp.plugins.remove('drag');
        vp.drag({ mouseButtons: 'middle' });
        const container = containerRef.current;
        if (container) container.style.cursor = '';
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    }, []);

    // ── Imperative handle ─────────────────────────────────────────────

    const fitAll = useCallback(() => {
      const vp = viewportRef.current;
      const scene = sceneRef.current;
      if (!vp || !scene) return;

      const items = scene.getAllItems();
      if (items.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const item of items) {
        const { x: ix, y: iy, w: iw, h: ih } = getItemWorldBounds(item);
        if (ix < minX) minX = ix;
        if (iy < minY) minY = iy;
        if (ix + iw > maxX) maxX = ix + iw;
        if (iy + ih > maxY) maxY = iy + ih;
      }

      const padding = 40;
      const contentW = maxX - minX + padding * 2;
      const contentH = maxY - minY + padding * 2;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const scaleX = vp.screenWidth / contentW;
      const scaleY = vp.screenHeight / contentH;
      const targetScale = Math.min(scaleX, scaleY, 5);

      vp.animate({
        position: { x: centerX, y: centerY },
        scale: targetScale,
        time: 300,
        ease: 'easeOutQuad',
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getViewport: () => viewportRef.current,
        getScene: () => sceneRef.current,
        getApp: () => appRef.current,
        fitAll,
        getZoom: () => viewportRef.current?.scale.x ?? 1,
        setZoom: (zoom: number) => {
          const vp = viewportRef.current;
          if (!vp) return;
          vp.animate({
            scale: zoom,
            time: 150,
            ease: 'easeOutQuad',
          });
        },
      }),
      [fitAll],
    );

    // ── Render ────────────────────────────────────────────────────────

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      />
    );
  },
);

export default PixiCanvas;
