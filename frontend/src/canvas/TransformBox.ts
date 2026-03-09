/**
 * TransformBox — resize/rotate handles around selected scene items.
 *
 * Shows 8 resize handles (corners + edge midpoints) + 1 rotation handle
 * around the combined bounding rect of selected items.
 * Each handle is draggable and applies scale/rotation transforms to the items.
 */

import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import type { SceneItem } from './SceneManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BORDER_COLOR = 0x4a90d9;
const BORDER_WIDTH = 1.5;
const HANDLE_SIZE = 8;
const HANDLE_FILL = 0xffffff;
const HANDLE_STROKE = 0x4a90d9;
const ROTATE_COLOR = 0x55aa55;
const ROTATE_OFFSET = 25;
const ROTATE_RADIUS = 5;

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'rot';

const HANDLE_CURSORS: Record<HandleId, string> = {
  tl: 'nwse-resize',
  tr: 'nesw-resize',
  bl: 'nesw-resize',
  br: 'nwse-resize',
  tc: 'ns-resize',
  bc: 'ns-resize',
  ml: 'ew-resize',
  mr: 'ew-resize',
  rot: 'grab',
};

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

interface DragState {
  handleId: HandleId;
  startX: number;
  startY: number;
  origTransforms: Map<string, { sx: number; sy: number; angle: number; x: number; y: number }>;
}

// ---------------------------------------------------------------------------
// TransformBox
// ---------------------------------------------------------------------------

export class TransformBox extends Container {
  private _border: Graphics;
  private _handles: Map<HandleId, Graphics> = new Map();
  private _rotateLine: Graphics;
  private _items: SceneItem[] = [];
  private _bounds = { x: 0, y: 0, w: 0, h: 0 };
  private _drag: DragState | null = null;

  constructor() {
    super();
    this.label = '__transform_box';
    this.visible = false;

    // Border
    this._border = new Graphics();
    this.addChild(this._border);

    // Rotate stem line
    this._rotateLine = new Graphics();
    this.addChild(this._rotateLine);

    // Create all handles
    const ids: HandleId[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br', 'rot'];
    for (const id of ids) {
      const handle = new Graphics();
      handle.eventMode = 'static';
      handle.cursor = HANDLE_CURSORS[id];
      handle.label = `handle_${id}`;

      handle.on('pointerdown', (e: FederatedPointerEvent) => this._onHandleDown(e, id));
      handle.on('globalpointermove', (e: FederatedPointerEvent) => this._onHandleMove(e));
      handle.on('pointerup', () => this._onHandleUp());
      handle.on('pointerupoutside', () => this._onHandleUp());

      this._handles.set(id, handle);
      this.addChild(handle);
    }
  }

  // -- Public API -----------------------------------------------------------

  /** Update the transform box to wrap the given items. Hides if empty. */
  update(items: SceneItem[]): void {
    this._items = items;

    if (items.length === 0) {
      this.visible = false;
      return;
    }

    // Compute combined bounding rect in world space
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of items) {
      const b = item.displayObject.getBounds();
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }

    this._bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    this._draw();
    this.visible = true;
  }

  // -- Drawing --------------------------------------------------------------

  private _draw(): void {
    const { x, y, w, h } = this._bounds;

    // Border
    this._border.clear();
    this._border.rect(x, y, w, h);
    this._border.stroke({ color: BORDER_COLOR, width: BORDER_WIDTH });

    // Rotate line (from top-center up to rotate handle)
    this._rotateLine.clear();
    this._rotateLine.moveTo(x + w / 2, y);
    this._rotateLine.lineTo(x + w / 2, y - ROTATE_OFFSET);
    this._rotateLine.stroke({ color: BORDER_COLOR, width: 1 });

    // Position handles
    const cx = x + w / 2;
    const cy = y + h / 2;

    const positions: Record<HandleId, { px: number; py: number }> = {
      tl: { px: x, py: y },
      tc: { px: cx, py: y },
      tr: { px: x + w, py: y },
      ml: { px: x, py: cy },
      mr: { px: x + w, py: cy },
      bl: { px: x, py: y + h },
      bc: { px: cx, py: y + h },
      br: { px: x + w, py: y + h },
      rot: { px: cx, py: y - ROTATE_OFFSET },
    };

    for (const [id, handle] of this._handles) {
      const pos = positions[id];
      handle.clear();

      if (id === 'rot') {
        // Green circle for rotation
        handle.circle(0, 0, ROTATE_RADIUS);
        handle.fill(ROTATE_COLOR);
        handle.stroke({ color: HANDLE_STROKE, width: 1 });
      } else {
        // White square with blue stroke for resize
        const half = HANDLE_SIZE / 2;
        handle.rect(-half, -half, HANDLE_SIZE, HANDLE_SIZE);
        handle.fill(HANDLE_FILL);
        handle.stroke({ color: HANDLE_STROKE, width: 1 });
      }

      handle.position.set(pos.px, pos.py);
    }
  }

  // -- Handle drag ----------------------------------------------------------

  private _onHandleDown(e: FederatedPointerEvent, id: HandleId): void {
    e.stopPropagation();

    const origTransforms = new Map<string, { sx: number; sy: number; angle: number; x: number; y: number }>();
    for (const item of this._items) {
      origTransforms.set(item.id, {
        sx: item.data.sx,
        sy: item.data.sy,
        angle: item.data.angle,
        x: item.data.x,
        y: item.data.y,
      });
    }

    this._drag = {
      handleId: id,
      startX: e.global.x,
      startY: e.global.y,
      origTransforms,
    };
  }

  private _onHandleMove(e: FederatedPointerEvent): void {
    if (!this._drag) return;

    const dx = e.global.x - this._drag.startX;
    const dy = e.global.y - this._drag.startY;
    const { handleId, origTransforms } = this._drag;

    for (const item of this._items) {
      const orig = origTransforms.get(item.id);
      if (!orig) continue;

      switch (handleId) {
        case 'br': {
          // Proportional scale
          const factor = 1 + (dx + dy) / 500;
          const clampedFactor = Math.max(0.1, factor);
          item.data.sx = orig.sx * clampedFactor;
          item.data.sy = orig.sy * clampedFactor;
          break;
        }
        case 'mr': {
          // Horizontal scale only
          const factor = 1 + dx / 500;
          item.data.sx = orig.sx * Math.max(0.1, factor);
          break;
        }
        case 'bc': {
          // Vertical scale only
          const factor = 1 + dy / 500;
          item.data.sy = orig.sy * Math.max(0.1, factor);
          break;
        }
        case 'tl': {
          // Proportional scale + reposition (opposite corner stays fixed)
          const factor = 1 - (dx + dy) / 500;
          const clampedFactor = Math.max(0.1, factor);
          item.data.sx = orig.sx * clampedFactor;
          item.data.sy = orig.sy * clampedFactor;
          // Shift position so bottom-right stays fixed
          const dw = (item.data.sx - orig.sx) * (item.data.w ?? 0);
          const dh = (item.data.sy - orig.sy) * (item.data.h ?? 0);
          item.data.x = orig.x - dw;
          item.data.y = orig.y - dh;
          break;
        }
        case 'rot': {
          // Rotation based on horizontal drag
          item.data.angle = orig.angle + dx * 0.5;
          break;
        }
        // Other handles: simple proportional for now
        case 'tr': {
          const factor = 1 + (dx - dy) / 500;
          item.data.sx = orig.sx * Math.max(0.1, factor);
          item.data.sy = orig.sy * Math.max(0.1, factor);
          break;
        }
        case 'bl': {
          const factor = 1 + (-dx + dy) / 500;
          item.data.sx = orig.sx * Math.max(0.1, factor);
          item.data.sy = orig.sy * Math.max(0.1, factor);
          break;
        }
        case 'tc': {
          const factor = 1 - dy / 500;
          item.data.sy = orig.sy * Math.max(0.1, factor);
          item.data.y = orig.y + dy;
          break;
        }
        case 'ml': {
          const factor = 1 - dx / 500;
          item.data.sx = orig.sx * Math.max(0.1, factor);
          item.data.x = orig.x + dx;
          break;
        }
      }

      // Apply to display object
      item.displayObject.scale.set(item.data.sx, item.data.sy);
      item.displayObject.angle = item.data.angle;
      item.displayObject.position.set(item.data.x, item.data.y);
    }

    // Redraw transform box around new bounds
    this.update(this._items);
  }

  private _onHandleUp(): void {
    this._drag = null;
  }
}
