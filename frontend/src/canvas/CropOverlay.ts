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
import { getImageViewRectWorldCorners, imageViewPointToWorld, worldToImageViewPoint } from './imageTransforms';

const HANDLE_SIZE = 8;
const HANDLE_FILL = 0xffffff;
const HANDLE_STROKE = 0x4a90d9;
const BORDER_COLOR = 0x4a90d9;
const DIM_ALPHA = 0.6;
const MIN_CROP = 0.05; // minimum 5% of image in each dimension

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';
type DragMode = HandleId | 'move';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class CropOverlay extends Container {
  private _item: SceneItem | null = null;
  private _viewport: Viewport;
  private _dim: Graphics;
  private _cropHitArea: Graphics;
  private _border: Graphics;
  private _handles = new Map<HandleId, Graphics>();
  private _crop: CropRect = { x: 0, y: 0, w: 1, h: 1 };
  private _drag: { mode: DragMode; startCrop: CropRect; startPoint: { x: number; y: number } } | null = null;
  private _onConfirm: ((item: SceneItem, crop: CropRect) => void) | null = null;
  private _onCancel: (() => void) | null = null;
  private _onStateChange: ((active: boolean) => void) | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _domMove: ((e: PointerEvent) => void) | null = null;
  private _domUp: ((e: PointerEvent) => void) | null = null;

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

    this._cropHitArea = new Graphics();
    this._cropHitArea.eventMode = 'static';
    this._cropHitArea.cursor = 'move';
    this._cropHitArea.on('pointerdown', (e: FederatedPointerEvent) => this._onDown(e, 'move'));
    this.addChild(this._cropHitArea);

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
  set onStateChange(fn: (active: boolean) => void) { this._onStateChange = fn; }

  /** Start cropping the given image item. */
  start(item: SceneItem): void {
    if (item.type !== 'image') return;
    this._item = item;
    const imgData = item.data as ImageObject;
    this._crop = imgData.crop ? { ...imgData.crop } : { x: 0, y: 0, w: 1, h: 1 };
    this._viewport.plugins.pause('drag');
    this.visible = true;
    this._onStateChange?.(true);
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
    this._removeDomDragListeners();
    this._viewport.plugins.resume('drag');
    this._item = null;
    this._drag = null;
    this.visible = false;
    this._onStateChange?.(false);
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
    const data = this._item.data as ImageObject;
    const zoom = this._viewport.scale.x;
    const viewCrop = this._getViewCrop();
    const fullCorners = getImageViewRectWorldCorners(data, { x: 0, y: 0, w: 1, h: 1 });
    const cropCorners = getImageViewRectWorldCorners(data, viewCrop);

    // Dim: draw 4 rectangles around the crop area
    this._dim.clear();
    const dimQuads = [
      [fullCorners[0], fullCorners[1], cropCorners[1], cropCorners[0]],
      [fullCorners[1], fullCorners[2], cropCorners[2], cropCorners[1]],
      [fullCorners[2], fullCorners[3], cropCorners[3], cropCorners[2]],
      [fullCorners[3], fullCorners[0], cropCorners[0], cropCorners[3]],
    ];
    for (const quad of dimQuads) {
      this._drawPolygon(this._dim, quad);
      this._dim.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }

    // Border around crop area
    this._cropHitArea.clear();
    this._drawPolygon(this._cropHitArea, cropCorners);
    this._cropHitArea.fill({ color: 0xffffff, alpha: 0.001 });

    this._border.clear();
    this._drawPolygon(this._border, cropCorners);
    this._border.stroke({ color: BORDER_COLOR, width: 1.5 / zoom });

    // Rule of thirds lines
    for (let i = 1; i <= 2; i++) {
      const verticalX = viewCrop.x + (viewCrop.w * i) / 3;
      const horizontalY = viewCrop.y + (viewCrop.h * i) / 3;
      const vStart = imageViewPointToWorld(data, verticalX, viewCrop.y);
      const vEnd = imageViewPointToWorld(data, verticalX, viewCrop.y + viewCrop.h);
      const hStart = imageViewPointToWorld(data, viewCrop.x, horizontalY);
      const hEnd = imageViewPointToWorld(data, viewCrop.x + viewCrop.w, horizontalY);
      this._border.moveTo(vStart.x, vStart.y);
      this._border.lineTo(vEnd.x, vEnd.y);
      this._border.moveTo(hStart.x, hStart.y);
      this._border.lineTo(hEnd.x, hEnd.y);
    }
    this._border.stroke({ color: 0xffffff, width: 0.5 / zoom, alpha: 0.3 });

    // Position handles
    const positions: Record<HandleId, { px: number; py: number }> = {
      tl: { px: cropCorners[0].x, py: cropCorners[0].y },
      tc: this._toHandlePosition(imageViewPointToWorld(data, viewCrop.x + viewCrop.w / 2, viewCrop.y)),
      tr: { px: cropCorners[1].x, py: cropCorners[1].y },
      ml: this._toHandlePosition(imageViewPointToWorld(data, viewCrop.x, viewCrop.y + viewCrop.h / 2)),
      mr: this._toHandlePosition(imageViewPointToWorld(data, viewCrop.x + viewCrop.w, viewCrop.y + viewCrop.h / 2)),
      bl: { px: cropCorners[3].x, py: cropCorners[3].y },
      bc: this._toHandlePosition(imageViewPointToWorld(data, viewCrop.x + viewCrop.w / 2, viewCrop.y + viewCrop.h)),
      br: { px: cropCorners[2].x, py: cropCorners[2].y },
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

  private _onDown(e: FederatedPointerEvent, mode: DragMode): void {
    if (!this._item) return;
    e.stopPropagation();
    if ('preventDefault' in e.nativeEvent && typeof e.nativeEvent.preventDefault === 'function') {
      e.nativeEvent.preventDefault();
    }
    const data = this._item.data as ImageObject;
    const world = this._viewport.toWorld(e.global.x, e.global.y);
    const viewPoint = worldToImageViewPoint(data, world.x, world.y);
    this._drag = {
      mode,
      startCrop: this._getViewCrop(),
      startPoint: { x: clamp01(viewPoint.x), y: clamp01(viewPoint.y) },
    };
    this._removeDomDragListeners();
    this._domMove = (ev: PointerEvent) => this._onDomMove(ev);
    this._domUp = () => this._onUp();
    window.addEventListener('pointermove', this._domMove);
    window.addEventListener('pointerup', this._domUp, { once: true });
    window.addEventListener('pointercancel', this._domUp, { once: true });
  }

  private _onMoveScreen(screenX: number, screenY: number): void {
    if (!this._drag || !this._item) return;

    const data = this._item.data as ImageObject;
    const world = this._viewport.toWorld(screenX, screenY);
    const viewPoint = worldToImageViewPoint(data, world.x, world.y);
    const nx = clamp01(viewPoint.x);
    const ny = clamp01(viewPoint.y);

    const { mode, startCrop: sc, startPoint } = this._drag;
    const crop = { ...sc };

    if (mode === 'move') {
      crop.x = Math.max(0, Math.min(1 - sc.w, sc.x + (nx - startPoint.x)));
      crop.y = Math.max(0, Math.min(1 - sc.h, sc.y + (ny - startPoint.y)));
      this._setViewCrop(crop);
      this._draw();
      return;
    }

    switch (mode) {
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

  private _onDomMove(e: PointerEvent): void {
    const point = this._clientToCanvasPoint(e.clientX, e.clientY);
    if (!point) return;
    this._onMoveScreen(point.x, point.y);
  }

  private _onUp(): void {
    this._drag = null;
    this._removeDomDragListeners();
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

  private _drawPolygon(graphics: Graphics, points: Array<{ x: number; y: number }>): void {
    if (points.length === 0) return;
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      graphics.lineTo(points[i].x, points[i].y);
    }
    graphics.closePath();
  }

  private _toHandlePosition(point: { x: number; y: number }): { px: number; py: number } {
    return { px: point.x, py: point.y };
  }

  private _removeDomDragListeners(): void {
    if (this._domMove) {
      window.removeEventListener('pointermove', this._domMove);
      this._domMove = null;
    }
    if (this._domUp) {
      window.removeEventListener('pointerup', this._domUp);
      window.removeEventListener('pointercancel', this._domUp);
      this._domUp = null;
    }
  }

  private _clientToCanvasPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const domElement = (this._viewport as any)?.options?.events?.domElement as HTMLCanvasElement | undefined;
    if (!domElement) return null;
    const rect = domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (clientX - rect.left) * (domElement.width / rect.width),
      y: (clientY - rect.top) * (domElement.height / rect.height),
    };
  }
}
