/**
 * TransformBox — resize handles around selected scene items.
 *
 * Shows 8 resize handles (corners + edge midpoints) around the combined
 * bounding rect of selected items. Each handle is draggable and applies
 * scale transforms to the items.
 */

import { Container, Graphics, FederatedPointerEvent, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { MarkdownSprite } from './sprites/MarkdownSprite';
import type { MarkdownObject } from './scene-format';
import { type SceneItem, getItemWorldBounds } from './SceneManager';
import type { SnapGuides } from './SnapGuides';
import { applyImageDisplayTransform } from './imageTransforms';
import type { ImageObject } from './scene-format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BORDER_COLOR = 0x4a90d9;
const BORDER_WIDTH = 1.5;
const HANDLE_SIZE = 8;
const HANDLE_FILL = 0xffffff;
const HANDLE_STROKE = 0x4a90d9;

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

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
  handleId: HandleId;
  startX: number;
  startY: number;
  origBounds: { x: number; y: number; w: number; h: number };
  origTransforms: Map<string, { sx: number; sy: number; angle: number; x: number; y: number; w: number; bounds: { x: number; y: number; w: number; h: number } }>;
}

// ---------------------------------------------------------------------------
// TransformBox
// ---------------------------------------------------------------------------

export class TransformBox extends Container {
  private _border: Graphics;
  private _handles: Map<HandleId, Graphics> = new Map();
  private _items: SceneItem[] = [];
  private _bounds = { x: 0, y: 0, w: 0, h: 0 };
  private _drag: DragState | null = null;
  private _viewport: Viewport | null = null;
  private _onItemTransform: ((item: SceneItem) => void) | null = null;
  private _onDragEnd: ((itemIds: string[]) => void) | null = null;
  private _snapGuides: SnapGuides | null = null;
  private _resizeConstraint: 'full' | 'horizontal' | 'none' = 'full';
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

    // Compute combined bounding rect via canonical getItemWorldBounds()
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
    const allSticky = items.length > 0 && items.every(i => i.type === 'sticky');
    const allMarkdown = items.length > 0 && items.every(i => i.type === 'markdown');
    this._resizeConstraint = allSticky ? 'none' : allMarkdown ? 'horizontal' : 'full';
    this._draw();
    this.visible = true;
  }

  // -- Drawing --------------------------------------------------------------

  private _draw(): void {
    const { x, y, w, h } = this._bounds;
    const zoom = this._viewport?.scale.x ?? 1;

    // Border — constant screen-width stroke
    this._border.clear();
    this._border.rect(x, y, w, h);
    this._border.stroke({ color: BORDER_COLOR, width: BORDER_WIDTH / zoom });

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
    };

    // Counter-scale handles so they stay the same screen size at any zoom
    const s = HANDLE_SIZE / zoom;
    const half = s / 2;

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

      const pos = positions[id];
      handle.clear();

      handle.rect(-half, -half, s, s);
      handle.fill(HANDLE_FILL);
      handle.stroke({ color: HANDLE_STROKE, width: 1 / zoom });

      handle.position.set(pos.px, pos.py);
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

  private _onHandleMove(e: FederatedPointerEvent): void {
    if (!this._drag) return;

    // Convert mouse position to world space
    const world = this._viewport!.toWorld(e.global.x, e.global.y);
    const { handleId, origBounds: ob, origTransforms } = this._drag;

    // Compute scale factors: new size / original size
    // Each handle has a fixed edge — the opposite side stays put
    const MIN = 0.05;
    let fx = 1; // horizontal scale multiplier
    let fy = 1; // vertical scale multiplier

    switch (handleId) {
      // --- Corner handles (proportional) ---
      case 'br': {
        // Fixed edge: top-left. New size = mouse - top-left.
        fx = Math.max(MIN, (world.x - ob.x) / ob.w);
        fy = Math.max(MIN, (world.y - ob.y) / ob.h);
        // Proportional: use average
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      case 'tl': {
        // Fixed edge: bottom-right
        const right = ob.x + ob.w;
        const bottom = ob.y + ob.h;
        fx = Math.max(MIN, (right - world.x) / ob.w);
        fy = Math.max(MIN, (bottom - world.y) / ob.h);
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      case 'tr': {
        // Fixed edge: bottom-left
        const bottom = ob.y + ob.h;
        fx = Math.max(MIN, (world.x - ob.x) / ob.w);
        fy = Math.max(MIN, (bottom - world.y) / ob.h);
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      case 'bl': {
        // Fixed edge: top-right
        const right = ob.x + ob.w;
        fx = Math.max(MIN, (right - world.x) / ob.w);
        fy = Math.max(MIN, (world.y - ob.y) / ob.h);
        const f = (fx + fy) / 2;
        fx = f; fy = f;
        break;
      }
      // --- Edge handles (proportional by default, hold Shift for free-form) ---
      case 'mr': {
        fx = Math.max(MIN, (world.x - ob.x) / ob.w);
        if (!e.shiftKey && this._resizeConstraint !== 'horizontal') fy = fx;
        break;
      }
      case 'ml': {
        const right = ob.x + ob.w;
        fx = Math.max(MIN, (right - world.x) / ob.w);
        if (!e.shiftKey) fy = fx;
        break;
      }
      case 'bc': {
        fy = Math.max(MIN, (world.y - ob.y) / ob.h);
        if (!e.shiftKey) fx = fy;
        break;
      }
      case 'tc': {
        const bottom = ob.y + ob.h;
        fy = Math.max(MIN, (bottom - world.y) / ob.h);
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
    const w = Math.round(bounds.w);
    const h = Math.round(bounds.h);
    this._dimLabel.text = `${w} \u00d7 ${h}`;
    this._dimLabel.scale.set(1 / zoom); // Stay fixed screen size

    // Position below bottom-right corner with offset
    const labelX = bounds.x + bounds.w;
    const labelY = bounds.y + bounds.h + 12 / zoom;
    this._dimLabel.anchor.set(1, 0); // right-aligned
    this._dimLabel.position.set(labelX, labelY);

    // Background pill
    const pad = 4 / zoom;
    const textW = this._dimLabel.width;
    const textH = this._dimLabel.height;
    this._dimLabelBg.clear();
    this._dimLabelBg.roundRect(
      labelX - textW - pad,
      labelY - pad / 2,
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
