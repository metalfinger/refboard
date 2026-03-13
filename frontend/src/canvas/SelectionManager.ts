/**
 * SelectionManager — click, shift-click, and rubber-band selection for scene items.
 *
 * Manages the selected set, rubber-band rectangle visual, hit testing,
 * and coordinates with TransformBox to show resize/rotate handles.
 */

import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { SceneManager, SceneItem, getItemWorldBounds } from './SceneManager';
import { TransformBox } from './TransformBox';
import { SnapGuides } from './SnapGuides';
import { ImageSprite } from './sprites/ImageSprite';
import { VideoSprite } from './sprites/VideoSprite';
import type { ImageObject } from './scene-format';
import { applyImageDisplayTransform } from './imageTransforms';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BAND_FILL = 0x4a90d9;
const BAND_FILL_ALPHA = 0.15;
const BAND_STROKE = 0x4a90d9;
const BAND_STROKE_ALPHA = 0.6;
const BAND_STROKE_WIDTH = 1;
const RUBBER_BAND_THRESHOLD = 5; // px in screen space before rubber band activates
const DRAG_THRESHOLD = 5;        // px in screen space before object drag activates

// ---------------------------------------------------------------------------
// SelectionManager
// ---------------------------------------------------------------------------

export class SelectionManager {
  readonly selectedIds: Set<string> = new Set();
  readonly transformBox: TransformBox;
  private _snapGuides: SnapGuides;

  private _viewport: Viewport;
  private _scene: SceneManager;
  private _overlay: Container;
  private _bandGfx: Graphics;
  private _onSelectionChange: ((ids: string[]) => void) | null = null;
  private _onItemTransform: ((item: SceneItem) => void) | null = null;
  private _onItemsTransform: ((items: SceneItem[]) => void) | null = null;
  private _onObjectDragEnd: ((ids: string[]) => void) | null = null;
  private _onViewportMoved: (() => void) | null = null;

  // Pointer state
  private _pointerDown = false;
  private _downScreenX = 0;
  private _downScreenY = 0;
  private _downWorldX = 0;
  private _downWorldY = 0;
  private _rubberBanding = false;
  private _hitItemOnDown: SceneItem | null = null;

  // Object drag state
  private _objectDragging = false;
  private _lastDragWorldX = 0;
  private _lastDragWorldY = 0;

  // Double-click detection
  private _lastClickTime = 0;
  private _lastClickItemId: string | null = null;
  private static readonly DOUBLE_CLICK_MS = 400;

  private _onDoubleClickText: ((item: SceneItem) => void) | null = null;
  private _onDoubleClickImage: ((item: SceneItem) => void) | null = null;

  private _enabled = true;

  get snapGuides(): SnapGuides { return this._snapGuides; }

  constructor(viewport: Viewport, scene: SceneManager) {
    this._viewport = viewport;
    this._scene = scene;

    // Overlay container (lives on top of everything in viewport)
    this._overlay = new Container();
    this._overlay.label = '__selection_overlay';
    viewport.addChild(this._overlay);

    // Rubber band graphic
    this._bandGfx = new Graphics();
    this._bandGfx.visible = false;
    this._overlay.addChild(this._bandGfx);

    // Transform box
    this.transformBox = new TransformBox();
    this.transformBox.setViewport(viewport);
    this._overlay.addChild(this.transformBox);

    // Snap guides
    this._snapGuides = new SnapGuides(scene, this._overlay);

    // Bind events on viewport
    viewport.on('pointerdown', this._onPointerDown, this);
    viewport.on('globalpointermove', this._onPointerMove, this);
    viewport.on('pointerup', this._onPointerUp, this);
    viewport.on('pointerupoutside', this._onPointerUp, this);

    // Redraw transform box on zoom so handles stay constant screen size
    this._onViewportMoved = () => {
      if (this.selectedIds.size > 0) {
        this.transformBox.update(this.getSelectedItems());
      }
    };
    viewport.on('moved', this._onViewportMoved);
  }

  /** Enable/disable selection interaction (disable during draw/text/eraser tools). */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this._pointerDown = false;
      this._rubberBanding = false;
      this._bandGfx.visible = false;
    }
  }

  // -- Public API -----------------------------------------------------------

  set onSelectionChange(fn: (ids: string[]) => void) {
    this._onSelectionChange = fn;
  }

  /** Called during drag with each moved item for live sync broadcast. */
  set onItemTransform(fn: (item: SceneItem) => void) {
    this._onItemTransform = fn;
  }

  /** Called during drag with ALL moved items for batched sync broadcast. */
  set onItemsTransform(fn: (items: SceneItem[]) => void) {
    this._onItemsTransform = fn;
  }

  /** Called when object drag ends (for persist/save/spatial refresh). */
  set onObjectDragEnd(fn: (ids: string[]) => void) {
    this._onObjectDragEnd = fn;
  }

  /** Called on double-click of a text item (for inline editing). */
  set onDoubleClickText(fn: (item: SceneItem) => void) {
    this._onDoubleClickText = fn;
  }

  /** Called on double-click of an image item (zoom-to-fit). */
  set onDoubleClickImage(fn: (item: SceneItem) => void) {
    this._onDoubleClickImage = fn;
  }

  /** Select only this item, deselecting everything else. */
  selectOnly(id: string): void {
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this._emitChange();
  }

  /** Toggle an item in/out of the selection. */
  toggle(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this._emitChange();
  }

  /** Select all unlocked, visible items. */
  selectAll(): void {
    this.selectedIds.clear();
    for (const item of this._scene.getTopLevelItems()) {
      if (!item.data.locked && item.data.visible) {
        this.selectedIds.add(item.id);
      }
    }
    this._emitChange();
  }

  /** Clear the entire selection. */
  clear(): void {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this._emitChange();
  }

  /** Return the SceneItems for the current selection. */
  getSelectedItems(): SceneItem[] {
    const items: SceneItem[] = [];
    for (const id of this.selectedIds) {
      const item = this._scene.getById(id);
      if (item) items.push(item);
    }
    return items;
  }

  // -- Hit Testing ----------------------------------------------------------

  /** Check all scene items in reverse z-order; return first whose world bounds contain (wx, wy). */
  _hitTest(wx: number, wy: number): SceneItem | null {
    const all = this._scene.getTopLevelItems();
    // Sort by z descending (topmost first)
    all.sort((a, b) => b.data.z - a.data.z);

    for (const item of all) {
      if (item.data.locked) continue;
      if (!item.data.visible) continue;

      const { x: ix, y: iy, w: iw, h: ih } = getItemWorldBounds(item);

      if (ix <= wx && wx <= ix + iw && iy <= wy && wy <= iy + ih) {
        return item;
      }
    }
    return null;
  }

  // -- Pointer Handlers -----------------------------------------------------

  private _onPointerDown(e: FederatedPointerEvent): void {
    if (!this._enabled) return;
    // Only handle primary button
    if (e.button !== 0) return;

    const world = this._viewport.toWorld(e.global.x, e.global.y);
    this._pointerDown = true;
    this._downScreenX = e.global.x;
    this._downScreenY = e.global.y;
    this._downWorldX = world.x;
    this._downWorldY = world.y;
    this._rubberBanding = false;

    this._hitItemOnDown = this._hitTest(world.x, world.y);

    if (this._hitItemOnDown) {
      // Clicked on an object
      const item = this._hitItemOnDown;
      if (e.shiftKey) {
        this.toggle(item.id);
      } else if (!this.selectedIds.has(item.id)) {
        this.selectOnly(item.id);
      }
      // If already selected and no shift, keep selection (for potential drag)
    }
    // Empty space click handling deferred to pointerup (to distinguish from rubber band)
  }

  private _onPointerMove(e: FederatedPointerEvent): void {
    if (!this._pointerDown) return;

    const dx = e.global.x - this._downScreenX;
    const dy = e.global.y - this._downScreenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Object drag: clicked on a selected item
    if (this._hitItemOnDown && this.selectedIds.has(this._hitItemOnDown.id)) {
      if (!this._objectDragging && dist >= DRAG_THRESHOLD) {
        this._objectDragging = true;
        this._lastDragWorldX = this._downWorldX;
        this._lastDragWorldY = this._downWorldY;

        // Pause viewport drag so object drag works
        this._viewport.plugins.pause('drag');

        // Lift shadow + spring scale on all selected image sprites
        this._applyLift();

        // Snap guides disabled — users found it annoying
        // this._snapGuides.beginSession(this.selectedIds);
      }

      if (this._objectDragging) {
        const currentWorld = this._viewport.toWorld(e.global.x, e.global.y);
        let ddx = currentWorld.x - this._lastDragWorldX;
        let ddy = currentWorld.y - this._lastDragWorldY;
        this._lastDragWorldX = currentWorld.x;
        this._lastDragWorldY = currentWorld.y;

        // Compute combined bounds of selected items after applying delta
        const selected = this.getSelectedItems();
        const prospective = this._getSelectionBounds(selected);
        prospective.x += ddx;
        prospective.y += ddy;

        // Snap guides disabled
        // const snap = this._snapGuides.computeSnap(prospective, this._viewport);
        // ddx += snap.dx;
        // ddy += snap.dy;
        // this._snapGuides.drawGuides(snap.guides, this._viewport);

        // Move all selected items by corrected delta and broadcast all together
        for (const item of selected) {
          item.data.x += ddx;
          item.data.y += ddy;
          if (item.type === 'image') {
            applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
          } else {
            item.displayObject.x = item.data.x;
            item.displayObject.y = item.data.y;
          }
        }
        if (this._onItemsTransform) {
          this._onItemsTransform(selected);
        } else if (this._onItemTransform) {
          for (const item of selected) this._onItemTransform(item);
        }
        this.transformBox.update(selected);
      }
      return;
    }

    // Rubber band: clicked on empty space
    if (this._hitItemOnDown) return;

    if (!this._rubberBanding && dist >= RUBBER_BAND_THRESHOLD) {
      this._rubberBanding = true;
      // Pause viewport drag so rubber band works
      this._viewport.plugins.pause('drag');
    }

    if (this._rubberBanding) {
      const currentWorld = this._viewport.toWorld(e.global.x, e.global.y);
      this._drawRubberBand(this._downWorldX, this._downWorldY, currentWorld.x, currentWorld.y);
    }
  }

  private _onPointerUp(e: FederatedPointerEvent): void {
    if (!this._pointerDown) return;
    this._pointerDown = false;

    if (this._objectDragging) {
      // End object drag — drop shadow + spring scale back
      this._applyDrop();
      // this._snapGuides.endSession();
      this._objectDragging = false;

      // Resume viewport drag
      this._viewport.plugins.resume('drag');

      // Notify change (positions updated)
      this._emitChange();
      this._onObjectDragEnd?.(Array.from(this.selectedIds));
    } else if (this._rubberBanding) {
      // Finish rubber band selection
      const currentWorld = this._viewport.toWorld(e.global.x, e.global.y);
      this._finishRubberBand(this._downWorldX, this._downWorldY, currentWorld.x, currentWorld.y, e.shiftKey);
      this._bandGfx.clear();
      this._bandGfx.visible = false;
      this._rubberBanding = false;

      // Resume viewport drag
      this._viewport.plugins.resume('drag');
    } else if (!this._hitItemOnDown) {
      // Clicked on empty space without dragging → deselect all
      if (!e.shiftKey) {
        this.clear();
      }
    } else if (this._hitItemOnDown && !this._objectDragging) {
      // Click (no drag) on an item — check for double-click
      const now = Date.now();
      const item = this._hitItemOnDown;
      if (
        this._lastClickItemId === item.id &&
        now - this._lastClickTime < SelectionManager.DOUBLE_CLICK_MS
      ) {
        // Double-click detected
        if (item.displayObject instanceof VideoSprite) {
          item.displayObject.togglePlayPause();
        } else if (item.type === 'text' || item.type === 'sticky') {
          this._onDoubleClickText?.(item);
        } else if (item.type === 'image' || item.type === 'drawing') {
          this._onDoubleClickImage?.(item);
        }
        this._lastClickTime = 0;
        this._lastClickItemId = null;
      } else {
        this._lastClickTime = now;
        this._lastClickItemId = item.id;
      }
    }

    this._hitItemOnDown = null;
  }

  // -- Drag Shadow Lift / Drop ----------------------------------------------

  /** Lift shadows on selected items for drag. */
  private _applyLift(): void {
    for (const item of this.getSelectedItems()) {
      const obj = item.displayObject;
      if (obj instanceof ImageSprite || obj instanceof VideoSprite) {
        obj.liftShadow();
      }
    }
  }

  /** Drop shadows on selected items after drag. */
  private _applyDrop(): void {
    for (const item of this.getSelectedItems()) {
      const obj = item.displayObject;
      if (obj instanceof ImageSprite || obj instanceof VideoSprite) {
        obj.dropShadow();
      }
    }
  }

  // -- Rubber Band ----------------------------------------------------------

  private _drawRubberBand(x1: number, y1: number, x2: number, y2: number): void {
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);

    this._bandGfx.clear();
    this._bandGfx.rect(rx, ry, rw, rh);
    this._bandGfx.fill({ color: BAND_FILL, alpha: BAND_FILL_ALPHA });
    this._bandGfx.stroke({ color: BAND_STROKE, width: BAND_STROKE_WIDTH, alpha: BAND_STROKE_ALPHA });
    this._bandGfx.visible = true;
  }

  private _finishRubberBand(
    x1: number, y1: number, x2: number, y2: number, additive: boolean,
  ): void {
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);

    if (!additive) {
      this.selectedIds.clear();
    }

    for (const item of this._scene.getTopLevelItems()) {
      if (item.data.locked || !item.data.visible) continue;

      const { x: ix, y: iy, w: iw, h: ih } = getItemWorldBounds(item);

      // Check intersection between rubber band rect and item world bounds
      const intersects =
        rx < ix + iw &&
        rx + rw > ix &&
        ry < iy + ih &&
        ry + rh > iy;

      if (intersects) {
        this.selectedIds.add(item.id);
      }
    }

    this._emitChange();
  }

  // -- Selection Bounds Helper -----------------------------------------------

  /** Compute the combined world bounding rect of the given items. */
  private _getSelectionBounds(items: SceneItem[]): { x: number; y: number; w: number; h: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of items) {
      const { x, y, w, h } = getItemWorldBounds(item);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // -- Change Notification --------------------------------------------------

  private _emitChange(): void {
    const items = this.getSelectedItems();
    this.transformBox.update(items);
    this._onSelectionChange?.(Array.from(this.selectedIds));
  }

  // -- Cleanup --------------------------------------------------------------

  destroy(): void {
    this._viewport.off('pointerdown', this._onPointerDown, this);
    this._viewport.off('globalpointermove', this._onPointerMove, this);
    this._viewport.off('pointerup', this._onPointerUp, this);
    this._viewport.off('pointerupoutside', this._onPointerUp, this);
    if (this._onViewportMoved) this._viewport.off('moved', this._onViewportMoved);
    this._overlay.destroy({ children: true });
  }
}
