/**
 * PresenceOverlay — renders colored selection borders for remote users.
 *
 * When another user selects items on the collaborative whiteboard, this overlay
 * draws thin colored outlines around those items on the local screen, with a
 * name-label pill above the first selected item.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneManager } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';

interface RemoteSelection {
  userId: string;
  displayName: string;
  color: number; // hex color, e.g. 0xff6600
  itemIds: string[];
}

export class PresenceOverlay {
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _container: Container;
  private _selections: Map<string, RemoteSelection> = new Map();
  private _graphics: Map<string, Graphics> = new Map(); // per-user graphics
  private _labels: Map<string, Text> = new Map(); // per-user name label
  private _rafId: number | null = null;

  constructor(viewport: Viewport, scene: SceneManager) {
    this._viewport = viewport;
    this._scene = scene;
    this._container = new Container();
    this._container.label = '__presence_overlay';
    this._container.eventMode = 'none';
    this._container.interactiveChildren = false;
    viewport.addChild(this._container);
  }

  /** Update a remote user's selection. Empty array = deselected. */
  updateSelection(userId: string, displayName: string, color: number, itemIds: string[]): void {
    if (itemIds.length === 0) {
      this._selections.delete(userId);
      this._cleanupUser(userId);
    } else {
      this._selections.set(userId, { userId, displayName, color, itemIds });
    }
    this._scheduleRedraw();
  }

  /** Remove a user entirely (they disconnected / left). */
  removeUser(userId: string): void {
    this._selections.delete(userId);
    this._cleanupUser(userId);
  }

  private _cleanupUser(userId: string): void {
    const gfx = this._graphics.get(userId);
    if (gfx) {
      gfx.destroy();
      this._graphics.delete(userId);
    }
    const label = this._labels.get(userId);
    if (label) {
      label.destroy();
      this._labels.delete(userId);
    }
  }

  private _scheduleRedraw(): void {
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._redraw();
    });
  }

  private _redraw(): void {
    const zoom = this._viewport.scale.x;

    for (const [userId, sel] of this._selections) {
      // Get or create graphics for this user
      let gfx = this._graphics.get(userId);
      if (!gfx) {
        gfx = new Graphics();
        gfx.label = `__presence_${userId}`;
        this._container.addChild(gfx);
        this._graphics.set(userId, gfx);
      }
      gfx.clear();

      // Get or create label
      let label = this._labels.get(userId);
      if (!label) {
        label = new Text({
          text: sel.displayName,
          style: new TextStyle({
            fontSize: 10,
            fontFamily: 'system-ui, sans-serif',
            fill: '#ffffff',
            fontWeight: '600',
          }),
        });
        label.label = `__presence_label_${userId}`;
        this._container.addChild(label);
        this._labels.set(userId, label);
      }
      label.text = sel.displayName;
      label.visible = false; // hide until we know where to place it
      label.scale.set(1 / zoom); // fixed screen-space size

      // Draw border around each selected item, track first bounds for label
      let firstBounds: { x: number; y: number; w: number; h: number } | null = null;

      for (const itemId of sel.itemIds) {
        const item = this._scene.getById(itemId);
        if (!item) continue;

        const b = getItemWorldBounds(item);

        const pad = 2 / zoom;
        gfx.rect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        gfx.stroke({ color: sel.color, width: 1.5 / zoom, alpha: 0.7 });

        if (!firstBounds) firstBounds = b;
      }

      // Position name-label pill above the first selected item
      if (firstBounds) {
        // Draw background pill first so text renders on top
        const labelOffsetY = 16 / zoom;
        const px = 3 / zoom;

        // We need label dimensions — make it visible and measure
        label.visible = true;
        label.position.set(firstBounds.x, firstBounds.y - labelOffsetY);

        const lw = label.width;
        const lh = label.height;

        gfx.roundRect(
          firstBounds.x - px,
          firstBounds.y - labelOffsetY - px / 2,
          lw + px * 2,
          lh + px,
          2 / zoom,
        );
        gfx.fill({ color: sel.color, alpha: 0.85 });
      }
    }

    // Clean up graphics/labels for users no longer in _selections
    for (const userId of this._graphics.keys()) {
      if (!this._selections.has(userId)) {
        this._cleanupUser(userId);
      }
    }
  }

  /** Call when items may have moved to keep borders in sync. */
  refresh(): void {
    if (this._selections.size > 0) this._redraw();
  }

  destroy(): void {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._container.destroy({ children: true });
    this._graphics.clear();
    this._labels.clear();
    this._selections.clear();
  }
}
