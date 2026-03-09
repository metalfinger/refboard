/**
 * SelectionManager — click, shift-click, and rubber-band selection for scene items.
 *
 * Manages the selected set, rubber-band rectangle visual, hit testing,
 * and coordinates with TransformBox to show resize/rotate handles.
 */

import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { SceneManager, SceneItem } from './SceneManager';
import { TransformBox } from './TransformBox';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BAND_FILL = 0x4a90d9;
const BAND_FILL_ALPHA = 0.15;
const BAND_STROKE = 0x4a90d9;
const BAND_STROKE_ALPHA = 0.6;
const BAND_STROKE_WIDTH = 1;
const RUBBER_BAND_THRESHOLD = 5; // px in screen space before rubber band activates

// ---------------------------------------------------------------------------
// SelectionManager
// ---------------------------------------------------------------------------

export class SelectionManager {
  readonly selectedIds: Set<string> = new Set();
  readonly transformBox: TransformBox;

  private _viewport: Viewport;
  private _scene: SceneManager;
  private _overlay: Container;
  private _bandGfx: Graphics;
  private _onSelectionChange: ((ids: string[]) => void) | null = null;

  // Pointer state
  private _pointerDown = false;
  private _downScreenX = 0;
  private _downScreenY = 0;
  private _downWorldX = 0;
  private _downWorldY = 0;
  private _rubberBanding = false;
  private _hitItemOnDown: SceneItem | null = null;

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
    this._overlay.addChild(this.transformBox);

    // Bind events on viewport
    viewport.on('pointerdown', this._onPointerDown, this);
    viewport.on('globalpointermove', this._onPointerMove, this);
    viewport.on('pointerup', this._onPointerUp, this);
    viewport.on('pointerupoutside', this._onPointerUp, this);
  }

  // -- Public API -----------------------------------------------------------

  set onSelectionChange(fn: (ids: string[]) => void) {
    this._onSelectionChange = fn;
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
    for (const item of this._scene.getAllItems()) {
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

  /** Check all scene items in reverse z-order; return first whose bounds contain (wx, wy). */
  _hitTest(wx: number, wy: number): SceneItem | null {
    const all = this._scene.getAllItems();
    // Sort by z descending (topmost first)
    all.sort((a, b) => b.data.z - a.data.z);

    for (const item of all) {
      if (item.data.locked) continue;
      if (!item.data.visible) continue;

      const bounds = item.displayObject.getBounds();
      if (
        bounds.x <= wx &&
        wx <= bounds.x + bounds.width &&
        bounds.y <= wy &&
        wy <= bounds.y + bounds.height
      ) {
        return item;
      }
    }
    return null;
  }

  // -- Pointer Handlers -----------------------------------------------------

  private _onPointerDown(e: FederatedPointerEvent): void {
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

    // If we clicked on an object, don't start rubber banding
    if (this._hitItemOnDown) return;

    const dx = e.global.x - this._downScreenX;
    const dy = e.global.y - this._downScreenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

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

    if (this._rubberBanding) {
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
    }

    this._hitItemOnDown = null;
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

    for (const item of this._scene.getAllItems()) {
      if (item.data.locked || !item.data.visible) continue;

      const bounds = item.displayObject.getBounds();

      // Check intersection (not containment) between rubber band rect and item bounds
      const intersects =
        rx < bounds.x + bounds.width &&
        rx + rw > bounds.x &&
        ry < bounds.y + bounds.height &&
        ry + rh > bounds.y;

      if (intersects) {
        this.selectedIds.add(item.id);
      }
    }

    this._emitChange();
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
    this._overlay.destroy({ children: true });
  }
}
