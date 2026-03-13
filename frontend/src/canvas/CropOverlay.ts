/**
 * CropOverlay — interactive crop handles over an image.
 *
 * Shows a crop rectangle with 8 drag handles and a dimmed area outside.
 * The overlay is positioned in world-space as a child of the viewport.
 * All crop values are normalized 0-1 relative to the image's natural dimensions.
 */

import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneItem } from './SceneManager';
import type { ImageObject, CropRect } from './scene-format';

const HANDLE_SIZE = 8;
const HANDLE_FILL = 0xffffff;
const HANDLE_STROKE = 0x4a90d9;
const BORDER_COLOR = 0x4a90d9;
const DIM_ALPHA = 0.6;
const MIN_CROP = 0.05; // minimum 5% of image in each dimension

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

export class CropOverlay extends Container {
  private _item: SceneItem | null = null;
  private _viewport: Viewport;
  private _dim: Graphics;
  private _border: Graphics;
  private _handles = new Map<HandleId, Graphics>();
  private _crop: CropRect = { x: 0, y: 0, w: 1, h: 1 };
  private _drag: { handleId: HandleId; startCrop: CropRect } | null = null;
  private _onConfirm: ((item: SceneItem, crop: CropRect) => void) | null = null;
  private _onCancel: (() => void) | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  // Bound references for dynamic event registration
  private _boundMove: ((e: FederatedPointerEvent) => void) | null = null;
  private _boundUp: (() => void) | null = null;

  constructor(viewport: Viewport) {
    super();
    this._viewport = viewport;
    this.label = '__crop_overlay';
    this.visible = false;
    this.eventMode = 'static';

    // Dim overlay (darkens area outside crop)
    this._dim = new Graphics();
    this._dim.eventMode = 'none';
    this.addChild(this._dim);

    // Crop border
    this._border = new Graphics();
    this._border.eventMode = 'none';
    this.addChild(this._border);

    // Create handles — only pointerdown on each handle
    const ids: HandleId[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
    const cursors: Record<HandleId, string> = {
      tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize',
      tc: 'ns-resize', bc: 'ns-resize', ml: 'ew-resize', mr: 'ew-resize',
    };
    for (const id of ids) {
      const h = new Graphics();
      h.eventMode = 'static';
      h.cursor = cursors[id];
      h.on('pointerdown', (e: FederatedPointerEvent) => this._onDown(e, id));
      this._handles.set(id, h);
      this.addChild(h);
    }
  }

  set onConfirm(fn: (item: SceneItem, crop: CropRect) => void) { this._onConfirm = fn; }
  set onCancel(fn: () => void) { this._onCancel = fn; }

  /** Start cropping the given image item. */
  start(item: SceneItem): void {
    if (item.type !== 'image') return;
    this._item = item;
    const imgData = item.data as ImageObject;
    this._crop = imgData.crop ? { ...imgData.crop } : { x: 0, y: 0, w: 1, h: 1 };
    this.visible = true;
    // Ensure overlay renders on top of all scene items
    if (this.parent) {
      this.parent.setChildIndex(this, this.parent.children.length - 1);
    }
    this._draw();

    // Key bindings
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); this.confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  /** Confirm the crop and apply it. */
  confirm(): void {
    if (!this._item) return;
    const item = this._item;
    const crop = { ...this._crop };
    const isFullImage = crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
    this._cleanup();
    this._onConfirm?.(item, isFullImage ? { x: 0, y: 0, w: 1, h: 1 } : crop);
  }

  /** Cancel cropping — restore original state. */
  cancel(): void {
    this._cleanup();
    this._onCancel?.();
  }

  get isActive(): boolean { return this._item !== null; }

  /** Clean up all state and listeners. Safe to call multiple times. */
  private _cleanup(): void {
    this._removeDragListeners();
    this._item = null;
    this._drag = null;
    this.visible = false;
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }

  /** Override destroy to ensure cleanup runs. */
  override destroy(options?: any): void {
    this._cleanup();
    super.destroy(options);
  }

  private _draw(): void {
    if (!this._item) return;
    const data = this._item.data;
    const zoom = this._viewport.scale.x;
    const viewCrop = this._getViewCrop();

    // Image world rect
    const ix = data.x;
    const iy = data.y;
    const iw = data.w * data.sx;
    const ih = data.h * data.sy;

    // Crop rect in world space
    const cx = ix + viewCrop.x * iw;
    const cy = iy + viewCrop.y * ih;
    const cw = viewCrop.w * iw;
    const ch = viewCrop.h * ih;

    // Dim: draw 4 rectangles around the crop area
    this._dim.clear();
    if (cy > iy) {
      this._dim.rect(ix, iy, iw, cy - iy);
      this._dim.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }
    const cropBottom = cy + ch;
    if (cropBottom < iy + ih) {
      this._dim.rect(ix, cropBottom, iw, iy + ih - cropBottom);
      this._dim.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }
    if (cx > ix) {
      this._dim.rect(ix, cy, cx - ix, ch);
      this._dim.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }
    const cropRight = cx + cw;
    if (cropRight < ix + iw) {
      this._dim.rect(cropRight, cy, ix + iw - cropRight, ch);
      this._dim.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }

    // Border around crop area
    this._border.clear();
    this._border.rect(cx, cy, cw, ch);
    this._border.stroke({ color: BORDER_COLOR, width: 1.5 / zoom });

    // Rule of thirds lines
    const thirdW = cw / 3;
    const thirdH = ch / 3;
    for (let i = 1; i <= 2; i++) {
      this._border.moveTo(cx + thirdW * i, cy);
      this._border.lineTo(cx + thirdW * i, cy + ch);
      this._border.moveTo(cx, cy + thirdH * i);
      this._border.lineTo(cx + cw, cy + thirdH * i);
    }
    this._border.stroke({ color: 0xffffff, width: 0.5 / zoom, alpha: 0.3 });

    // Position handles
    const positions: Record<HandleId, { px: number; py: number }> = {
      tl: { px: cx, py: cy },
      tc: { px: cx + cw / 2, py: cy },
      tr: { px: cx + cw, py: cy },
      ml: { px: cx, py: cy + ch / 2 },
      mr: { px: cx + cw, py: cy + ch / 2 },
      bl: { px: cx, py: cy + ch },
      bc: { px: cx + cw / 2, py: cy + ch },
      br: { px: cx + cw, py: cy + ch },
    };

    const s = HANDLE_SIZE / zoom;
    const half = s / 2;
    for (const [id, handle] of this._handles) {
      const pos = positions[id];
      handle.clear();
      handle.rect(-half, -half, s, s);
      handle.fill(HANDLE_FILL);
      handle.stroke({ color: HANDLE_STROKE, width: 1 / zoom });
      handle.position.set(pos.px, pos.py);
    }
  }

  // -- Handle drag (single handler, registered dynamically) --

  private _onDown(e: FederatedPointerEvent, id: HandleId): void {
    e.stopPropagation();
    this._drag = { handleId: id, startCrop: this._getViewCrop() };

    // Register move/up on the stage (single handler, not per-handle)
    this._removeDragListeners();
    this._boundMove = (ev: FederatedPointerEvent) => this._onMove(ev);
    this._boundUp = () => this._onUp();
    const stage = this._viewport.parent;
    if (stage) {
      stage.on('globalpointermove', this._boundMove);
      stage.on('pointerup', this._boundUp);
      stage.on('pointerupoutside', this._boundUp);
    }
  }

  private _removeDragListeners(): void {
    const stage = this._viewport.parent;
    if (stage) {
      if (this._boundMove) stage.off('globalpointermove', this._boundMove);
      if (this._boundUp) {
        stage.off('pointerup', this._boundUp);
        stage.off('pointerupoutside', this._boundUp);
      }
    }
    this._boundMove = null;
    this._boundUp = null;
  }

  private _onMove(e: FederatedPointerEvent): void {
    if (!this._drag || !this._item) return;

    const data = this._item.data;
    const iw = data.w * data.sx;
    const ih = data.h * data.sy;
    const world = this._viewport.toWorld(e.global.x, e.global.y);

    const nx = (world.x - data.x) / iw;
    const ny = (world.y - data.y) / ih;

    const { handleId, startCrop: sc } = this._drag;
    const crop = { ...sc };

    switch (handleId) {
      case 'tl':
        crop.x = Math.max(0, Math.min(nx, sc.x + sc.w - MIN_CROP));
        crop.y = Math.max(0, Math.min(ny, sc.y + sc.h - MIN_CROP));
        crop.w = sc.x + sc.w - crop.x;
        crop.h = sc.y + sc.h - crop.y;
        break;
      case 'tr':
        crop.w = Math.max(MIN_CROP, Math.min(1 - sc.x, nx - sc.x));
        crop.y = Math.max(0, Math.min(ny, sc.y + sc.h - MIN_CROP));
        crop.h = sc.y + sc.h - crop.y;
        break;
      case 'bl':
        crop.x = Math.max(0, Math.min(nx, sc.x + sc.w - MIN_CROP));
        crop.w = sc.x + sc.w - crop.x;
        crop.h = Math.max(MIN_CROP, Math.min(1 - sc.y, ny - sc.y));
        break;
      case 'br':
        crop.w = Math.max(MIN_CROP, Math.min(1 - sc.x, nx - sc.x));
        crop.h = Math.max(MIN_CROP, Math.min(1 - sc.y, ny - sc.y));
        break;
      case 'tc':
        crop.y = Math.max(0, Math.min(ny, sc.y + sc.h - MIN_CROP));
        crop.h = sc.y + sc.h - crop.y;
        break;
      case 'bc':
        crop.h = Math.max(MIN_CROP, Math.min(1 - sc.y, ny - sc.y));
        break;
      case 'ml':
        crop.x = Math.max(0, Math.min(nx, sc.x + sc.w - MIN_CROP));
        crop.w = sc.x + sc.w - crop.x;
        break;
      case 'mr':
        crop.w = Math.max(MIN_CROP, Math.min(1 - sc.x, nx - sc.x));
        break;
    }

    this._setViewCrop(crop);
    this._draw();
  }

  private _onUp(): void {
    this._drag = null;
    this._removeDragListeners();
  }

  private _getViewCrop(): CropRect {
    if (!this._item) return { ...this._crop };
    const data = this._item.data as ImageObject;
    return {
      x: data.flipX ? 1 - (this._crop.x + this._crop.w) : this._crop.x,
      y: data.flipY ? 1 - (this._crop.y + this._crop.h) : this._crop.y,
      w: this._crop.w,
      h: this._crop.h,
    };
  }

  private _setViewCrop(viewCrop: CropRect): void {
    if (!this._item) {
      this._crop = { ...viewCrop };
      return;
    }
    const data = this._item.data as ImageObject;
    this._crop = {
      x: data.flipX ? 1 - (viewCrop.x + viewCrop.w) : viewCrop.x,
      y: data.flipY ? 1 - (viewCrop.y + viewCrop.h) : viewCrop.y,
      w: viewCrop.w,
      h: viewCrop.h,
    };
  }
}
