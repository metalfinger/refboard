/**
 * Tools — PixiJS version.
 *
 * SELECT/PAN are handled by the viewport (pixi-viewport) and SelectionManager.
 * PEN/TEXT/ERASER need PixiJS implementations.
 * For now, only SELECT and PAN are fully functional; PEN/TEXT/ERASER are stubs
 * that will be implemented when drawing support is added.
 */

import type { Viewport } from 'pixi-viewport';
import type { SceneManager } from './SceneManager';
import type { SelectionManager } from './SelectionManager';
import { DrawingSprite } from './sprites/DrawingSprite';
import type { DrawingObject } from './scene-format';
import { TextEditor } from './TextEditor';

export enum ToolType {
  SELECT = 'SELECT',
  PAN = 'PAN',
  PEN = 'PEN',
  TEXT = 'TEXT',
  ERASER = 'ERASER',
  STICKY = 'STICKY',
}

export interface ToolOptions {
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
}

const defaultOptions: ToolOptions = {
  color: '#ffffff',
  strokeWidth: 4,
  fontSize: 24,
};

type CleanupFn = (() => void) | null;

/**
 * Compute world-space size from a desired screen-space size.
 * Clamps to reasonable bounds to avoid extreme values.
 */
function screenToWorld(screenPx: number, zoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, screenPx / zoom));
}

export interface ToolContext {
  viewport: Viewport;
  scene: SceneManager;
  selection: SelectionManager;
  container: HTMLElement;
  onChange: () => void;
  /** Broadcast only specific changed elements (lightweight, for live drawing). */
  broadcastElements?: (ids: string[]) => void;
  /** Text editor instance for inline editing. */
  textEditor?: TextEditor;
  /** Switch back to select tool after placing text. */
  switchToSelect?: () => void;
  /** When true, destructive/creative tool clicks (TEXT, ERASER) are suppressed. */
  reviewMode?: boolean;
}

export function activateTool(
  ctx: ToolContext,
  tool: ToolType,
  options: ToolOptions = {}
): CleanupFn {
  const opts = { ...defaultOptions, ...options };
  const { viewport, scene, selection, container } = ctx;

  // Reset cursor
  container.style.cursor = '';

  // Enable/disable SelectionManager based on tool
  selection.setEnabled(tool === ToolType.SELECT);

  switch (tool) {
    case ToolType.SELECT: {
      container.style.cursor = 'default';
      // SelectionManager handles click/rubber-band selection
      return null;
    }

    case ToolType.PAN: {
      container.style.cursor = 'grab';
      // Space+drag is handled by PixiCanvas; this just sets cursor
      return null;
    }

    case ToolType.TEXT: {
      container.style.cursor = 'text';

      const onClick = (e: PointerEvent) => {
        if (ctx.reviewMode) return; // Review mode suppresses text creation
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);

        const zoom = viewport.scale.x;
        const textData = {
          id: crypto.randomUUID(),
          type: 'text' as const,
          x: world.x,
          y: world.y,
          w: 200,
          h: 30,
          sx: 1,
          sy: 1,
          angle: 0,
          z: scene.nextZ(),
          opacity: 1,
          locked: false,
          name: '',
          visible: true,
          text: ' ', // placeholder — will be replaced by user input
          fontSize: screenToWorld(opts.fontSize!, zoom, 10, 72),
          fill: opts.color!,
          fontFamily: 'sans-serif',
        };

        scene._createItem(textData, true);
        scene._applyZOrder();
        ctx.broadcastElements?.([textData.id]);
        ctx.onChange();

        // Immediately open inline editor on the new text item
        const item = scene.getById(textData.id);
        if (item && ctx.textEditor) {
          // Find the canvas DOM container
          const canvasEl = container.querySelector('canvas');
          const domContainer = canvasEl?.parentElement ?? container;

          // Wait one frame so the click event settles before focusing textarea
          requestAnimationFrame(() => {
            ctx.textEditor!.startEditing(item, viewport, domContainer, () => {
              // If user saved empty text, remove the item
              const text = (item.data as any).text?.trim();
              if (!text) {
                scene.removeItem(item.id, true);
              }
              ctx.broadcastElements?.([item.id]);
              ctx.onChange();
            });
            // Clear placeholder so user types from scratch
            ctx.textEditor!.clearText();
          });
        }

        // Switch back to select tool after placing
        ctx.switchToSelect?.();

        // Remove handler after placing text
        container.removeEventListener('pointerdown', onClick);
      };

      container.addEventListener('pointerdown', onClick);
      return () => {
        container.removeEventListener('pointerdown', onClick);
      };
    }

    case ToolType.ERASER: {
      container.style.cursor = 'crosshair';
      // Clear any existing selection/transform box when switching to eraser
      selection.clear();
      selection.transformBox.update([]);

      const onClick = (e: PointerEvent) => {
        if (ctx.reviewMode) return; // Review mode suppresses eraser
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        const hit = selection._hitTest(world.x, world.y);
        if (hit) {
          selection.selectedIds.delete(hit.id);
          selection.transformBox.update([]);
          scene.removeItem(hit.id, true);
          ctx.onChange();
        }
      };

      container.addEventListener('pointerdown', onClick);
      return () => {
        container.removeEventListener('pointerdown', onClick);
      };
    }

    case ToolType.PEN: {
      container.style.cursor = 'crosshair';

      let drawing = false;
      let currentSprite: DrawingSprite | null = null;
      let originX = 0;
      let originY = 0;
      let itemId = '';
      let syncTimer: ReturnType<typeof setTimeout> | null = null;
      const SYNC_INTERVAL = 100; // ~10fps — lightweight element-only sync

      const scheduleLiveSync = () => {
        if (syncTimer) return;
        syncTimer = setTimeout(() => {
          syncTimer = null;
          if (!drawing) return;
          // Copy current points into item.data for serialization
          const item = scene.getById(itemId);
          if (item && currentSprite) {
            (item.data as DrawingObject).points = [...currentSprite.points];
          }
          // Send only the drawing element, not the entire scene
          ctx.broadcastElements?.([itemId]);
        }, SYNC_INTERVAL);
      };

      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        drawing = true;
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        originX = world.x;
        originY = world.y;

        itemId = crypto.randomUUID();
        const drawData: DrawingObject = {
          id: itemId,
          type: 'drawing',
          x: originX,
          y: originY,
          w: 1,
          h: 1,
          sx: 1,
          sy: 1,
          angle: 0,
          z: scene.nextZ(),
          opacity: 1,
          locked: false,
          name: '',
          visible: true,
          points: [0, 0],
          color: opts.color!,
          strokeWidth: opts.strokeWidth!,
        };

        scene._createItem(drawData, false);
        const item = scene.getById(itemId);
        if (item && item.displayObject instanceof DrawingSprite) {
          currentSprite = item.displayObject as DrawingSprite;
        }
        container.setPointerCapture(e.pointerId);
      };

      const onMove = (e: PointerEvent) => {
        if (!drawing || !currentSprite) return;
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        currentSprite.addPoint(world.x - originX, world.y - originY);
        scheduleLiveSync();
      };

      const onUp = () => {
        if (!drawing) return;
        drawing = false;
        if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }

        // Compute bounding box and normalize points so origin = top-left of stroke
        const item = scene.getById(itemId);
        if (item && currentSprite) {
          const pts = currentSprite.points;
          if (pts.length < 4) {
            scene.removeItem(itemId, false);
          } else {
            // Find bounds of all points
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < pts.length; i += 2) {
              minX = Math.min(minX, pts[i]);
              minY = Math.min(minY, pts[i + 1]);
              maxX = Math.max(maxX, pts[i]);
              maxY = Math.max(maxY, pts[i + 1]);
            }

            const sw = opts.strokeWidth!;
            // Shift all points so min = strokeWidth/2 (padding for stroke)
            const normalized: number[] = [];
            for (let i = 0; i < pts.length; i += 2) {
              normalized.push(pts[i] - minX + sw / 2);
              normalized.push(pts[i + 1] - minY + sw / 2);
            }

            // Update origin to account for the shift
            item.data.x = originX + minX - sw / 2;
            item.data.y = originY + minY - sw / 2;
            item.data.w = Math.max(maxX - minX + sw, 1);
            item.data.h = Math.max(maxY - minY + sw, 1);
            (item.data as DrawingObject).points = normalized;

            // Redraw with normalized points and reposition
            currentSprite.setPoints(normalized);
            item.displayObject.position.set(item.data.x, item.data.y);
          }
        }

        currentSprite = null;
        scene._applyZOrder();
        ctx.onChange();
      };

      container.addEventListener('pointerdown', onDown);
      container.addEventListener('pointermove', onMove);
      container.addEventListener('pointerup', onUp);
      return () => {
        if (syncTimer) clearTimeout(syncTimer);
        container.removeEventListener('pointerdown', onDown);
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerup', onUp);
      };
    }

    case ToolType.STICKY: {
      container.style.cursor = 'crosshair';

      const onClick = (e: PointerEvent) => {
        if (ctx.reviewMode) return;
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);

        const zoom = viewport.scale.x;
        const cardW = screenToWorld(220, zoom, 120, 400);
        const cardH = screenToWorld(66, zoom, 40, 200);
        const stickyData = {
          id: crypto.randomUUID(),
          type: 'sticky' as const,
          x: world.x - cardW / 2,
          y: world.y - cardH / 2,
          w: cardW,
          h: cardH,  // will be auto-computed by StickySprite
          sx: 1,
          sy: 1,
          angle: 0,
          z: scene.nextZ(),
          opacity: 1,
          locked: false,
          name: '',
          visible: true,
          text: '',
          fontSize: screenToWorld(opts.fontSize!, zoom, 10, 48),
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: '#ffd43b',     // default yellow
          textColor: '#1a1a1a',
          padding: 16,
          cornerRadius: 8,
        };

        scene._createItem(stickyData, true);
        scene._applyZOrder();
        ctx.broadcastElements?.([stickyData.id]);
        ctx.onChange();

        // Immediately open text editor on the new sticky
        const item = scene.getById(stickyData.id);
        if (item && ctx.textEditor) {
          const canvasEl = container.querySelector('canvas');
          const domContainer = canvasEl?.parentElement ?? container;

          // Wait one frame so the click event settles before focusing textarea
          requestAnimationFrame(() => {
            ctx.textEditor!.startEditing(item, viewport, domContainer, () => {
              // Cleanup rule — fires on BOTH save and cancel (stopEditing always calls _onChange):
              //   - new sticky + cancel/blur with empty text => remove (no blank notes left behind)
              //   - new sticky + save with empty text => remove
              //   - existing sticky + cancel => text already restored to original by stopEditing, no removal
              const text = (item.data as any).text?.trim();
              if (!text) {
                scene.removeItem(item.id, true);
              }
              ctx.broadcastElements?.([item.id]);
              ctx.onChange();
            });
            ctx.textEditor!.clearText();
          });
        }

        ctx.switchToSelect?.();
        container.removeEventListener('pointerdown', onClick);
      };

      container.addEventListener('pointerdown', onClick);
      return () => {
        container.removeEventListener('pointerdown', onClick);
      };
    }

    default:
      return null;
  }
}

export const toolShortcuts: Record<string, ToolType> = {
  v: ToolType.SELECT,
  h: ToolType.PAN,
  p: ToolType.PEN,
  t: ToolType.TEXT,
  s: ToolType.STICKY,
  '1': ToolType.SELECT,
  '2': ToolType.PAN,
  '3': ToolType.PEN,
  '4': ToolType.TEXT,
  '5': ToolType.STICKY,
};
