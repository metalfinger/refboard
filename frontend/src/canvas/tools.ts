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
import { Text, TextStyle } from 'pixi.js';

export enum ToolType {
  SELECT = 'SELECT',
  PAN = 'PAN',
  PEN = 'PEN',
  TEXT = 'TEXT',
  ERASER = 'ERASER',
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

export interface ToolContext {
  viewport: Viewport;
  scene: SceneManager;
  selection: SelectionManager;
  container: HTMLElement;
  onChange: () => void;
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
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);

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
          text: 'Type here',
          fontSize: opts.fontSize!,
          fill: opts.color!,
          fontFamily: 'sans-serif',
        };

        scene._createItem(textData, true);
        scene._applyZOrder();
        ctx.onChange();

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

      const onClick = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        const hit = selection._hitTest(world.x, world.y);
        if (hit) {
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
      // Drawing mode stub — will be implemented later
      return null;
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
  e: ToolType.ERASER,
  '1': ToolType.SELECT,
  '2': ToolType.PAN,
  '3': ToolType.PEN,
  '4': ToolType.TEXT,
  '5': ToolType.ERASER,
};
