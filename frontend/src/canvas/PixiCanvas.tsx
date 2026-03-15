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
import { Application, extensions } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { GifAsset } from 'pixi.js/gif';
import { SceneManager, getItemWorldBounds, type SceneItem } from './SceneManager';
import { TextureManager } from './TextureManager';
import { ImageSprite } from './sprites/ImageSprite';
import { VideoSprite } from './sprites/VideoSprite';
import { AnimatedGifSprite } from './sprites/AnimatedGifSprite';
import { PdfPageSprite } from './sprites/PdfPageSprite';
import { SpringManager } from './spring';
import { convertFabricToV2 } from './scene-format';
import type { SceneData } from './scene-format';

// Register PixiJS GIF asset loader (once, at module level)
extensions.add(GifAsset);

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
  /** True while the initial scene is being loaded (items being created). */
  isSceneLoading: () => boolean;
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
    const sceneLoadingRef = useRef(false);
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
        // Manages GPU/memory budgets for both images and videos.
        // Distance-based priority: nearest to viewport center get resources first.

        const MAX_LOADED_TEXTURES = 60;   // max image textures in GPU
        const MAX_PLAYING_GIFS = 8;      // max GIFs actively animating
        const MAX_INITIALIZED_VIDEOS = 6; // max <video> elements (tier 1+)
        const MAX_POSTER_VIDEOS = 4;      // max poster textures in GPU (tier 2)

        let lastCullCheck = 0;
        // Track loaded resources so we can unload without scanning all items
        const loadedImages = new Set<string>();   // IDs of images with loaded textures
        const loadedVideos = new Set<string>();    // IDs of videos with init/poster/playing state
        app.ticker.add((ticker) => {
          lastCullCheck += ticker.deltaMS;
          if (lastCullCheck < 250) return;
          lastCullCheck = 0;

          const bounds = viewport.getVisibleBounds();
          const loadMargin = Math.max(bounds.width, bounds.height) * 0.5;
          const vcx = bounds.x + bounds.width / 2;
          const vcy = bounds.y + bounds.height / 2;

          const imageItems: { item: SceneItem; sprite: ImageSprite | AnimatedGifSprite | PdfPageSprite; dist: number; near: boolean }[] = [];
          const videoItems: { item: SceneItem; sprite: VideoSprite; dist: number; near: boolean }[] = [];

          // Spatial query: only check items within the extended viewport region
          const qx = bounds.x - loadMargin;
          const qy = bounds.y - loadMargin;
          const qw = bounds.width + loadMargin * 2;
          const qh = bounds.height + loadMargin * 2;
          const nearbyItems = scene.queryRegion(qx, qy, qw, qh);

          for (const item of nearbyItems) {
            const itemBounds = getItemWorldBounds(item);
            const cx = itemBounds.x + itemBounds.w / 2;
            const cy = itemBounds.y + itemBounds.h / 2;
            const dist = (cx - vcx) ** 2 + (cy - vcy) ** 2;

            if (item.type === 'image' && (item.displayObject instanceof ImageSprite || item.displayObject instanceof AnimatedGifSprite)) {
              imageItems.push({ item, sprite: item.displayObject, dist, near: true });
            } else if (item.type === 'pdf-page' && item.displayObject instanceof PdfPageSprite) {
              imageItems.push({ item, sprite: item.displayObject, dist, near: true });
            } else if (item.type === 'video' && item.displayObject instanceof VideoSprite) {
              videoItems.push({ item, sprite: item.displayObject, dist, near: true });
            }
          }

          // ---- Image + GIF texture budget management ----
          // Both static images and GIFs share the texture load budget.
          // GIFs additionally have a separate play budget (only nearest N animate).
          imageItems.sort((a, b) => a.dist - b.dist);
          const shouldLoadImage = new Set(
            imageItems.slice(0, MAX_LOADED_TEXTURES).map(i => i.item.id)
          );

          // Build GIF play budget: only nearest loaded GIFs should animate
          const gifItems = imageItems.filter(i => i.sprite instanceof AnimatedGifSprite);
          const shouldPlayGif = new Set(
            gifItems.slice(0, MAX_PLAYING_GIFS).map(i => i.item.id)
          );

          let imgLoadsThisTick = 0;
          for (const { item, sprite } of imageItems) {
            if (shouldLoadImage.has(item.id) && !sprite.loaded && imgLoadsThisTick < 3) {
              sprite.loadTexture();
              loadedImages.add(item.id);
              imgLoadsThisTick++;
            }
            // Manage GIF play/stop based on play budget
            if (sprite instanceof AnimatedGifSprite && sprite.loaded) {
              if (shouldPlayGif.has(item.id)) {
                sprite.play();
              } else {
                sprite.stop();
              }
            }
          }

          // Unload images that left the viewport (check tracked set, not all items)
          for (const id of loadedImages) {
            if (shouldLoadImage.has(id)) continue;
            const item = scene.items.get(id);
            if (!item) { loadedImages.delete(id); continue; }
            const sprite = item.displayObject;
            if ((sprite instanceof ImageSprite || sprite instanceof AnimatedGifSprite || sprite instanceof PdfPageSprite) && sprite.loaded) {
              sprite.unloadTexture();
            }
            loadedImages.delete(id);
          }

          // ---- Video budget management ----
          videoItems.sort((a, b) => a.dist - b.dist);

          // Determine budget sets (sorted by distance, nearest first)
          const shouldInit = new Set(
            videoItems.slice(0, MAX_INITIALIZED_VIDEOS).map(i => i.item.id)
          );
          const shouldPoster = new Set(
            videoItems.slice(0, MAX_POSTER_VIDEOS).map(i => i.item.id)
          );

          // Initialize nearest videos within budget
          let vidInitsThisTick = 0;
          for (const { item, sprite } of videoItems) {
            if (shouldInit.has(item.id) && !sprite.isInitialized && vidInitsThisTick < 2) {
              sprite.initVideo();
              loadedVideos.add(item.id);
              vidInitsThisTick++;
            }
            // Load posters within budget
            // Prefer server poster over client capture; upgrade if server poster becomes available
            if (shouldPoster.has(item.id)) {
              if (!sprite.hasPoster) {
                if (sprite.hasServerPoster) {
                  sprite.loadServerPoster();
                } else if (sprite.isInitialized) {
                  sprite.capturePoster();
                }
              } else if (sprite.hasServerPoster && !sprite.isServerPosterLoaded) {
                // Client poster exists but server poster now available — upgrade
                sprite.loadServerPoster();
              }
              loadedVideos.add(item.id);
            }
          }

          // Tear down videos that left the viewport (check tracked set)
          for (const id of loadedVideos) {
            if (shouldInit.has(id) || shouldPoster.has(id)) continue;
            const item = scene.items.get(id);
            if (!item) { loadedVideos.delete(id); continue; }
            const sprite = item.displayObject;
            if (!(sprite instanceof VideoSprite)) { loadedVideos.delete(id); continue; }

            if (sprite.isPlaying) sprite.onVisibilityChange(false);
            if (sprite.hasPoster && !sprite.isPlaying) sprite.destroyPoster();
            if (sprite.isInitialized && !sprite.isPlaying) sprite.teardownVideo();
            loadedVideos.delete(id);
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

        // -- WebGL context loss recovery ------------------------------------
        const canvas = app.canvas as HTMLCanvasElement;
        const onContextLost = (e: Event) => {
          e.preventDefault(); // allows context to be restored
          console.warn('[PixiCanvas] WebGL context lost — waiting for restore');
        };
        const onContextRestored = () => {
          console.warn('[PixiCanvas] WebGL context restored — reloading scene');
          // Re-load scene data so textures get re-uploaded to GPU
          if (sceneRef.current && initialLoadDone.current) {
            const data = sceneRef.current.serialize();
            sceneRef.current.loadScene(data);
          }
        };
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);
        (container as any).__pixiContextHandlers = { onContextLost, onContextRestored, canvas };

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

        const ctxHandlers = (container as any).__pixiContextHandlers;
        if (ctxHandlers) {
          ctxHandlers.canvas.removeEventListener('webglcontextlost', ctxHandlers.onContextLost);
          ctxHandlers.canvas.removeEventListener('webglcontextrestored', ctxHandlers.onContextRestored);
          delete (container as any).__pixiContextHandlers;
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
      sceneLoadingRef.current = true;
      sceneRef.current.loadScene(sceneData).then(() => {
        sceneLoadingRef.current = false;
        onChangeRef.current?.(); // trigger objectCount update
      });
    }, [canvasState, pixiReady]);

    // ── Space key for pan mode ────────────────────────────────────────

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'Space' || spaceHeld.current) return;
        const t = e.target as HTMLElement | null;
        if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;

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
        isSceneLoading: () => sceneLoadingRef.current,
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
