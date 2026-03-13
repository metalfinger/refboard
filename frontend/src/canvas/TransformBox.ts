/**
 * TransformBox — resize and rotation handles around selected scene items.
 *
 * Shows 8 resize handles (corners + edge midpoints) around the combined
 * bounding rect of selected items, plus corner rotation grips offset slightly
 * outward. All interactions derive from the same visible-bounds geometry so
 * crop/flip/rotate stay aligned.
 */

import { Container, Graphics, FederatedPointerEvent, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { MarkdownSprite } from './sprites/MarkdownSprite';
import type { MarkdownObject } from './scene-format';
import { type SceneItem, getItemWorldBounds } from './SceneManager';
import type { SnapGuides } from './SnapGuides';
import { applyImageDisplayTransform, getImageVisibleLocalRect } from './imageTransforms';
import type { ImageObject } from './scene-format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BORDER_COLOR = 0x4a90d9;
const BORDER_WIDTH = 1.5;
const HANDLE_SIZE = 8;
const ROTATE_HANDLE_SIZE = 10;
const ROTATE_HANDLE_OFFSET = 16;
const HANDLE_FILL = 0xffffff;
const HANDLE_STROKE = 0x4a90d9;
const ROTATE_HANDLE_FILL = 0x4a90d9;

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';
type RotateHandleId = 'tl' | 'tr' | 'bl' | 'br';

const HANDLE_CURSORS: Record<HandleId, string> = {
  tl: 'nwse-resize',
  tr: 'nesw-resize',
  bl: 'nesw-resize',
  br: 'nwse-resize',
  tc: 'ns-resize',
  bc: 'ns-resize',
  ml: 'ew-resize',
  mr: 'ew-resize',
};

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

interface DragState {
  mode: 'resize' | 'rotate';
  handleId: HandleId;
  startX: number;
  startY: number;
  origBounds: { x: number; y: number; w: number; h: number };
  origTransforms: Map<string, { sx: number; sy: number; angle: number; x: number; y: number; w: number; bounds: { x: number; y: number; w: number; h: number } }>;
  centerX?: number;
  centerY?: number;
  startAngleDeg?: number;
}

// ---------------------------------------------------------------------------
// TransformBox
// ---------------------------------------------------------------------------

export class TransformBox extends Container {
  private _border: Graphics;
  private _handles: Map<HandleId, Graphics> = new Map();
  private _rotateHandles: Map<RotateHandleId, Graphics> = new Map();
  private _items: SceneItem[] = [];
  private _bounds = { x: 0, y: 0, w: 0, h: 0 };
  private _drag: DragState | null = null;
  private _viewport: Viewport | null = null;
  private _onItemTransform: ((item: SceneItem) => void) | null = null;
  private _onDragEnd: ((itemIds: string[]) => void) | null = null;
  private _snapGuides: SnapGuides | null = null;
  private _resizeConstraint: 'full' | 'horizontal' | 'none' = 'full';
  /** Only images (and videos) support rotation. */
  private _rotateAllowed = true;
  /** Rotation angle of the transform box itself (matches single item rotation). */
  private _selectionAngle = 0;
  /** Center of the rotated transform box in world space. */
  private _rotatedCenter = { x: 0, y: 0 };
  private _dimLabel!: Text;
  private _dimLabelBg!: Graphics;

  set onItemTransform(fn: (item: SceneItem) => void) {
    this._onItemTransform = fn;
  }

  /** Called when resize/rotate drag ends — use to persist/sync final state. */
  set onDragEnd(fn: (itemIds: string[]) => void) {
    this._onDragEnd = fn;
  }

  setSnapGuides(sg: SnapGuides): void {
    this._snapGuides = sg;
  }

  constructor() {
    super();
    this.label = '__transform_box';
    this.visible = false;

    // Border
    this._border = new Graphics();
    this.addChild(this._border);


    // Dimension label (shown during resize)
    this._dimLabel = new Text({
      text: '',
      style: new TextStyle({
        fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fill: '#ffffff',
        fontWeight: '500',
      }),
    });
    this._dimLabel.visible = false;
    this._dimLabel.label = '__dim_label';

    this._dimLabelBg = new Graphics();
    this._dimLabelBg.visible = false;
    this._dimLabelBg.label = '__dim_label_bg';

    this.addChild(this._dimLabelBg);
    this.addChild(this._dimLabel);

    // Create all handles
    const ids: HandleId[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
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

    const rotateIds: RotateHandleId[] = ['tl', 'tr', 'bl', 'br'];
    for (const id of rotateIds) {
      const handle = new Graphics();
      handle.eventMode = 'static';
      handle.cursor = 'grab';
      handle.label = `rotate_handle_${id}`;

      handle.on('pointerdown', (e: FederatedPointerEvent) => this._onRotateHandleDown(e, id));
      handle.on('globalpointermove', (e: FederatedPointerEvent) => this._onHandleMove(e));
      handle.on('pointerup', () => this._onHandleUp());
      handle.on('pointerupoutside', () => this._onHandleUp());

      this._rotateHandles.set(id, handle);
      this.addChild(handle);
    }
  }

  // -- Public API -----------------------------------------------------------

  /** Set the viewport reference for zoom-aware drag calculations. */
  setViewport(viewport: Viewport): void {
    this._viewport = viewport;
  }

  /** Update the transform box to wrap the given items. Hides if empty. */
  update(items: SceneItem[]): void {
    this._items = items;

    // Hide dimension label when not actively dragging
    if (!this._drag) {
      this._dimLabel.visible = false;
      this._dimLabelBg.visible = false;
    }

    if (items.length === 0) {
      this.visible = false;
      return;
    }

    const allSticky = items.length > 0 && items.every(i => i.type === 'sticky');
    const allMarkdown = items.length > 0 && items.every(i => i.type === 'markdown');
    this._resizeConstraint = allSticky ? 'none' : allMarkdown ? 'horizontal' : 'full';
    // Only allow rotation for image/video selections
    const ROTATABLE_TYPES = new Set(['image', 'video']);
    this._rotateAllowed = items.length > 0 && items.every(i => ROTATABLE_TYPES.has(i.type));

    // Single rotated item: use the item's local rect so the transform box
    // wraps the unrotated shape and we rotate the box itself.
    const singleItem = items.length === 1 ? items[0] : null;
    const itemAngle = singleItem?.data.angle ?? 0;

    if (singleItem && Math.abs(itemAngle) > 0.01) {
      this._selectionAngle = itemAngle;
      // Compute the item's local (unrotated) visible rect in world units
      let localW: number;
      let localH: number;
      if (singleItem.type === 'image') {
        const vis = getImageVisibleLocalRect(singleItem.data as ImageObject);
        localW = vis.w * Math.abs(singleItem.data.sx);
        localH = vis.h * Math.abs(singleItem.data.sy);
      } else {
        localW = singleItem.data.w * Math.abs(singleItem.data.sx);
        localH = singleItem.data.h * Math.abs(singleItem.data.sy);
      }
      // Get the AABB to find the center (center is invariant under rotation)
      const aabb = getItemWorldBounds(singleItem);
      const cx = aabb.x + aabb.w / 2;
      const cy = aabb.y + aabb.h / 2;
      this._rotatedCenter = { x: cx, y: cy };
      // Bounds in local (unrotated) space, centered on world center
      this._bounds = { x: cx - localW / 2, y: cy - localH / 2, w: localW, h: localH };
    } else {
      this._selectionAngle = 0;
      // Multi-selection or unrotated: use axis-aligned world bounds
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
      this._bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      this._rotatedCenter = { x: minX + (maxX - minX) / 2, y: minY + (maxY - minY) / 2 };
    }

    this._draw();
    this.visible = true;
  }

  // -- Drawing --------------------------------------------------------------

  /** Rotate a point around a center by an angle in degrees. */
  private _rotatePoint(px: number, py: number, cx: number, cy: number, angleDeg: number): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = px - cx;
    const dy = py - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  private _draw(): void {
    const { x, y, w, h } = this._bounds;
    const zoom = this._viewport?.scale.x ?? 1;
    const angle = this._selectionAngle;
    const rcx = this._rotatedCenter.x;
    const rcy = this._rotatedCenter.y;

    // Border — constant screen-width stroke
    this._border.clear();
    if (Math.abs(angle) > 0.01) {
      // Draw rotated rectangle as a polygon
      const tl = this._rotatePoint(x, y, rcx, rcy, angle);
      const tr = this._rotatePoint(x + w, y, rcx, rcy, angle);
      const br = this._rotatePoint(x + w, y + h, rcx, rcy, angle);
      const bl = this._rotatePoint(x, y + h, rcx, rcy, angle);
      this._border.moveTo(tl.x, tl.y);
      this._border.lineTo(tr.x, tr.y);
      this._border.lineTo(br.x, br.y);
      this._border.lineTo(bl.x, bl.y);
      this._border.closePath();
      this._border.stroke({ color: BORDER_COLOR, width: BORDER_WIDTH / zoom });
    } else {
      this._border.rect(x, y, w, h);
      this._border.stroke({ color: BORDER_COLOR, width: BORDER_WIDTH / zoom });
    }

    // Position handles (in local bounds space, then rotated)
    const cx = x + w / 2;
    const cy = y + h / 2;

    const localPositions: Record<HandleId, { x: number; y: number }> = {
      tl: { x, y },
      tc: { x: cx, y },
      tr: { x: x + w, y },
      ml: { x, y: cy },
      mr: { x: x + w, y: cy },
      bl: { x, y: y + h },
      bc: { x: cx, y: y + h },
      br: { x: x + w, y: y + h },
    };

    // Counter-scale handles so they stay the same screen size at any zoom
    const s = HANDLE_SIZE / zoom;
    const half = s / 2;
    const rotateSize = ROTATE_HANDLE_SIZE / zoom;
    const rotateHalf = rotateSize / 2;
    const rotateOffset = ROTATE_HANDLE_OFFSET / zoom;

    for (const [id, handle] of this._handles) {
      // No resize handles for sticky-only selections (fixed width, auto height)
      if (this._resizeConstraint === 'none') {
        handle.visible = false;
        handle.eventMode = 'none';
        continue;
      }
      if (this._resizeConstraint === 'horizontal' && id !== 'mr') {
        handle.visible = false;
        handle.eventMode = 'none';
        continue;
      }
      handle.visible = true;
      handle.eventMode = 'static';

      const lp = localPositions[id];
      const pos = Math.abs(angle) > 0.01
        ? this._rotatePoint(lp.x, lp.y, rcx, rcy, angle)
        : lp;
      handle.clear();

      handle.rect(-half, -half, s, s);
      handle.fill(HANDLE_FILL);
      handle.stroke({ color: HANDLE_STROKE, width: 1 / zoom });

      handle.position.set(pos.x, pos.y);
      handle.rotation = (angle * Math.PI) / 180;
    }

    const localRotatePositions: Record<RotateHandleId, { x: number; y: number }> = {
      tl: { x: x - rotateOffset, y: y - rotateOffset },
      tr: { x: x + w + rotateOffset, y: y - rotateOffset },
      bl: { x: x - rotateOffset, y: y + h + rotateOffset },
      br: { x: x + w + rotateOffset, y: y + h + rotateOffset },
    };

    for (const [id, handle] of this._rotateHandles) {
      if (!this._rotateAllowed) {
        handle.visible = false;
        handle.eventMode = 'none';
        continue;
      }
      handle.visible = true;
      handle.eventMode = 'static';
      handle.clear();
      handle.circle(0, 0, rotateHalf);
      handle.fill({ color: ROTATE_HANDLE_FILL, alpha: 0.9 });
      handle.stroke({ color: HANDLE_FILL, width: 1 / zoom });
      const lp = localRotatePositions[id];
      const pos = Math.abs(angle) > 0.01
        ? this._rotatePoint(lp.x, lp.y, rcx, rcy, angle)
        : lp;
      handle.position.set(pos.x, pos.y);
    }
  }

  // -- Handle drag ----------------------------------------------------------

  private _onHandleDown(e: FederatedPointerEvent, id: HandleId): void {
    e.stopPropagation();

    const origTransforms = new Map<string, { sx: number; sy: number; angle: number; x: number; y: number; w: number; bounds: { x: number; y: number; w: number; h: number } }>();
    for (const item of this._items) {
      origTransforms.set(item.id, {
        sx: item.data.sx,
        sy: item.data.sy,
        angle: item.data.angle,
        x: item.data.x,
        y: item.data.y,
        w: item.data.w,
        bounds: getItemWorldBounds(item),
      });
    }

    this._drag = {
      mode: 'resize',
      handleId: id,
      startX: e.global.x,
      startY: e.global.y,
      origBounds: { ...this._bounds },
      origTransforms,
    };

    // Snap guides disabled
    // const itemIds = new Set(this._items.map((it) => it.id));
    // this._snapGuides?.beginSession(itemIds);
  }

  private _onRotateHandleDown(e: FederatedPointerEvent, id: RotateHandleId): void {
    e.stopPropagation();
    if (!this._rotateAllowed) return;

    const origTransforms = new Map<string, { sx: number; sy: number; angle: number; x: number; y: number; w: number; bounds: { x: number; y: number; w: number; h: number } }>();
    for (const item of this._items) {
      origTransforms.set(item.id, {
        sx: item.data.sx,
        sy: item.data.sy,
        angle: item.data.angle,
        x: item.data.x,
        y: item.data.y,
        w: item.data.w,
        bounds: getItemWorldBounds(item),
      });
    }

    const centerX = this._bounds.x + this._bounds.w / 2;
    const centerY = this._bounds.y + this._bounds.h / 2;
    const world = this._viewport!.toWorld(e.global.x, e.global.y);
    const startAngleDeg = Math.atan2(world.y - centerY, world.x - centerX) * (180 / Math.PI);

    this._drag = {
      mode: 'rotate',
      handleId: id,
      startX: e.global.x,
      startY: e.global.y,
      origBounds: { ...this._bounds },
      origTransforms,
      centerX,
      centerY,
      startAngleDeg,
    };
  }

  private _onHandleMove(e: FederatedPointerEvent): void {
    if (!this._drag) return;

    // Convert mouse position to world space
    const world = this._viewport!.toWorld(e.global.x, e.global.y);
    const { mode, handleId, origBounds: ob, origTransforms } = this._drag;

    if (mode === 'rotate') {
      const centerX = this._drag.centerX ?? (ob.x + ob.w / 2);
      const centerY = this._drag.centerY ?? (ob.y + ob.h / 2);
      const startAngleDeg = this._drag.startAngleDeg ?? 0;
      let currentAngleDeg = Math.atan2(world.y - centerY, world.x - centerX) * (180 / Math.PI);
      let deltaDeg = currentAngleDeg - startAngleDeg;
      if (e.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;

      const rad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      for (const item of this._items) {
        const orig = origTransforms.get(item.id);
        if (!orig) continue;

        const origBounds = orig.bounds;
        const itemCenterX = origBounds.x + origBounds.w / 2;
        const itemCenterY = origBounds.y + origBounds.h / 2;
        const dx = itemCenterX - centerX;
        const dy = itemCenterY - centerY;
        const nextCenterX = centerX + dx * cos - dy * sin;
        const nextCenterY = centerY + dx * sin + dy * cos;

        item.data.x = orig.x;
        item.data.y = orig.y;
        item.data.sx = orig.sx;
        item.data.sy = orig.sy;
        item.data.angle = ((orig.angle + deltaDeg) % 360 + 360) % 360;

        if (item.type === 'image') {
          applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
        } else {
          item.displayObject.position.set(item.data.x, item.data.y);
          item.displayObject.scale.set(item.data.sx, item.data.sy);
          item.displayObject.angle = item.data.angle;
        }

        const currentBounds = getItemWorldBounds(item);
        item.data.x += nextCenterX - (currentBounds.x + currentBounds.w / 2);
        item.data.y += nextCenterY - (currentBounds.y + currentBounds.h / 2);

        if (item.type === 'image') {
          applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
        } else {
          item.displayObject.position.set(item.data.x, item.data.y);
          item.displayObject.scale.set(item.data.sx, item.data.sy);
          item.displayObject.angle = item.data.angle;
        }

        this._onItemTransform?.(item);
      }

      this.update(this._items);
      return;
    }

    // If the transform box is rotated, project mouse into the local
    // (unrotated) coordinate system so the scale math stays correct.
    let localMouse = { x: world.x, y: world.y };
    if (Math.abs(this._selectionAngle) > 0.01) {
      localMouse = this._rotatePoint(world.x, world.y, this._rotatedCenter.x, this._rotatedCenter.y, -this._selectionAngle);
    }

    // Compute scale factors: new size / original size
    // Each handle has a fixed edge — the opposite side stays put
    const MIN = 0.05;
    let fx = 1; // horizontal scale multiplier
    let fy = 1; // vertical scale multiplier

    switch (handleId) {
      // --- Corner handles (proportional) ---
      case 'br': {
        // Fixed edge: top-left. New size = mouse - top-left.
        fx = Math.max(MIN, (localMouse.x - ob.x) / ob.w);
        fy = Math.max(MIN, (localMouse.y - ob.y) / ob.h);
        // Proportional: use average
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      case 'tl': {
        // Fixed edge: bottom-right
        const right = ob.x + ob.w;
        const bottom = ob.y + ob.h;
        fx = Math.max(MIN, (right - localMouse.x) / ob.w);
        fy = Math.max(MIN, (bottom - localMouse.y) / ob.h);
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      case 'tr': {
        // Fixed edge: bottom-left
        const bottom = ob.y + ob.h;
        fx = Math.max(MIN, (localMouse.x - ob.x) / ob.w);
        fy = Math.max(MIN, (bottom - localMouse.y) / ob.h);
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      case 'bl': {
        // Fixed edge: top-right
        const right = ob.x + ob.w;
        fx = Math.max(MIN, (right - localMouse.x) / ob.w);
        fy = Math.max(MIN, (localMouse.y - ob.y) / ob.h);
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      // --- Edge handles (proportional by default, hold Shift for free-form) ---
      case 'mr': {
        fx = Math.max(MIN, (localMouse.x - ob.x) / ob.w);
        if (!e.shiftKey && this._resizeConstraint !== 'horizontal') fy = fx;
        break;
      }
      case 'ml': {
        const right = ob.x + ob.w;
        fx = Math.max(MIN, (right - localMouse.x) / ob.w);
        if (!e.shiftKey) fy = fx;
        break;
      }
      case 'bc': {
        fy = Math.max(MIN, (localMouse.y - ob.y) / ob.h);
        if (!e.shiftKey) fx = fy;
        break;
      }
      case 'tc': {
        const bottom = ob.y + ob.h;
        fy = Math.max(MIN, (bottom - localMouse.y) / ob.h);
        if (!e.shiftKey) fx = fy;
        break;
      }
    }

    // Compute the anchor point (fixed edge of bounding box)
    let anchorX = ob.x; // default: top-left is fixed (br, mr, bc handles)
    let anchorY = ob.y;
    switch (handleId) {
      case 'tl': anchorX = ob.x + ob.w; anchorY = ob.y + ob.h; break;
      case 'tc': anchorY = ob.y + ob.h; break;
      case 'tr': anchorX = ob.x; anchorY = ob.y + ob.h; break;
      case 'ml': anchorX = ob.x + ob.w; break;
      case 'bl': anchorX = ob.x + ob.w; anchorY = ob.y; break;
      // br, mr, bc: anchor is top-left (default)
    }

    for (const item of this._items) {
      const orig = origTransforms.get(item.id);
      if (!orig) continue;

      if (item.type === 'markdown') {
        // Markdown cards: convert scale factor to width change, keep sx/sy at 1.
        const newW = Math.min(800, Math.max(250, orig.w * fx));
        item.data.w = newW;
        item.data.sx = 1;
        item.data.sy = 1;
        item.displayObject.scale.set(1, 1);
        item.data.x = orig.x;
        item.data.y = orig.y;
        item.displayObject.position.set(item.data.x, item.data.y);
        if (item.displayObject instanceof MarkdownSprite) {
          item.displayObject.updateFromData(item.data as MarkdownObject);
        }
        this._onItemTransform?.(item);
        continue; // Skip normal sx/sy scaling
      }

      if (item.type === 'image') {
        const obounds = orig.bounds;
        const nextVisibleX = anchorX + (obounds.x - anchorX) * fx;
        const nextVisibleY = anchorY + (obounds.y - anchorY) * fy;
        item.data.x = orig.x;
        item.data.y = orig.y;
        item.data.sx = orig.sx * fx;
        item.data.sy = orig.sy * fy;
        applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
        const currentBounds = getItemWorldBounds(item);
        item.data.x += nextVisibleX - currentBounds.x;
        item.data.y += nextVisibleY - currentBounds.y;
        applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
      } else {
        // Reposition as a unit: scale each item's offset from the anchor point
        item.data.x = anchorX + (orig.x - anchorX) * fx;
        item.data.y = anchorY + (orig.y - anchorY) * fy;
        item.data.sx = orig.sx * fx;
        item.data.sy = orig.sy * fy;
        item.displayObject.scale.set(item.data.sx, item.data.sy);
        item.displayObject.position.set(item.data.x, item.data.y);
      }
      this._onItemTransform?.(item);
    }

    this.update(this._items);

    // Snap guides disabled
    // if (this._snapGuides && this._viewport) {
    //   const snap = this._snapGuides.computeSnap(this._bounds, this._viewport);
    //   ...
    // }

    // Show dimension label
    const bounds = this._bounds;
    const zoom = this._viewport?.scale.x ?? 1;
    const dimW = Math.round(bounds.w);
    const dimH = Math.round(bounds.h);
    this._dimLabel.text = `${dimW} \u00d7 ${dimH}`;
    this._dimLabel.scale.set(1 / zoom); // Stay fixed screen size

    // Position below bottom-right corner with offset (rotated if needed)
    let labelAnchorX = bounds.x + bounds.w;
    let labelAnchorY = bounds.y + bounds.h + 12 / zoom;
    if (Math.abs(this._selectionAngle) > 0.01) {
      const rotated = this._rotatePoint(labelAnchorX, labelAnchorY, this._rotatedCenter.x, this._rotatedCenter.y, this._selectionAngle);
      labelAnchorX = rotated.x;
      labelAnchorY = rotated.y;
    }
    this._dimLabel.anchor.set(1, 0); // right-aligned
    this._dimLabel.position.set(labelAnchorX, labelAnchorY);

    // Background pill
    const pad = 4 / zoom;
    const textW = this._dimLabel.width;
    const textH = this._dimLabel.height;
    this._dimLabelBg.clear();
    this._dimLabelBg.roundRect(
      labelAnchorX - textW - pad,
      labelAnchorY - pad / 2,
      textW + pad * 2,
      textH + pad,
      3 / zoom,
    );
    this._dimLabelBg.fill({ color: 0x1a1a1a, alpha: 0.9 });

    this._dimLabel.visible = true;
    this._dimLabelBg.visible = true;
  }

  private _onHandleUp(): void {
    if (this._drag) {
      this._drag = null;
      this._dimLabel.visible = false;
      this._dimLabelBg.visible = false;
      // this._snapGuides?.endSession();
      // Notify that drag ended — persist/sync the final state
      this._onDragEnd?.(this._items.map(i => i.id));
    }
  }
}
