/**
 * textSharpness — zoom-bucket-aware text rendering.
 *
 * Tracks the viewport zoom level and groups it into discrete buckets.
 * When the bucket changes, visible text/sticky sprites are re-rasterized
 * at the new resolution for crisp rendering. Small zoom movements within
 * the same bucket are ignored to avoid unnecessary texture churn.
 *
 * This does NOT mutate scene data (fontSize stays stable).
 * It only changes the render resolution of text textures.
 */

import type { Viewport } from 'pixi-viewport';
import type { SceneManager, SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import { TextSprite } from './sprites/TextSprite';
import { StickySprite } from './sprites/StickySprite';

/**
 * Map continuous zoom to discrete bucket.
 * Fewer buckets = fewer re-rasterizations = better perf.
 */
export function getTextZoomBucket(scale: number): number {
  if (scale < 0.4) return 0.5;
  if (scale < 0.75) return 0.75;
  if (scale < 1.25) return 1;
  if (scale < 1.75) return 1.5;
  if (scale < 2.5) return 2;
  return 3;
}

export class TextSharpnessManager {
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _currentBucket = 1;

  constructor(viewport: Viewport, scene: SceneManager) {
    this._viewport = viewport;
    this._scene = scene;
    this._currentBucket = getTextZoomBucket(viewport.scale.x);
    // Apply initial bucket to all existing text/sticky items
    this._refreshAll();
  }

  /**
   * Call on viewport zoom/move. Returns true if bucket changed.
   */
  check(): boolean {
    const bucket = getTextZoomBucket(this._viewport.scale.x);
    if (bucket === this._currentBucket) return false;
    this._currentBucket = bucket;
    this._refreshVisible();
    return true;
  }

  /**
   * Apply current zoom bucket to a single item.
   * Call this when a new text/sticky sprite is created.
   */
  applyToItem(item: SceneItem): void {
    if (item.displayObject instanceof TextSprite) {
      item.displayObject.setZoomBucket(this._currentBucket);
    } else if (item.displayObject instanceof StickySprite) {
      item.displayObject.setZoomBucket(this._currentBucket);
    }
  }

  /** Refresh all text/sticky items (used on initial setup). */
  private _refreshAll(): void {
    const bucket = this._currentBucket;
    for (const item of this._scene.getAllItems()) {
      if (item.type !== 'text' && item.type !== 'sticky') continue;
      if (item.displayObject instanceof TextSprite) {
        item.displayObject.setZoomBucket(bucket);
      } else if (item.displayObject instanceof StickySprite) {
        item.displayObject.setZoomBucket(bucket);
      }
    }
  }

  /** Refresh visible text/sticky items at current bucket (on zoom change). */
  private _refreshVisible(): void {
    const bucket = this._currentBucket;
    const items = this._scene.getAllItems();
    const vb = this._getViewportWorldBounds();

    for (const item of items) {
      if (item.type !== 'text' && item.type !== 'sticky') continue;
      // Skip off-screen items
      if (vb && !this._intersects(item, vb)) continue;

      if (item.displayObject instanceof TextSprite) {
        item.displayObject.setZoomBucket(bucket);
      } else if (item.displayObject instanceof StickySprite) {
        item.displayObject.setZoomBucket(bucket);
      }
    }
  }

  /** Get viewport bounds in world coordinates. */
  private _getViewportWorldBounds(): { x: number; y: number; w: number; h: number } | null {
    const vp = this._viewport;
    if (!vp.screenWidth || !vp.screenHeight) return null;
    const tl = vp.toWorld(0, 0);
    const br = vp.toWorld(vp.screenWidth, vp.screenHeight);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }

  /** Check if item intersects viewport bounds (with margin). Uses world bounds for group children. */
  private _intersects(item: SceneItem, vb: { x: number; y: number; w: number; h: number }): boolean {
    const margin = 200; // world-space margin to include near-screen items
    const { x: ix, y: iy, w: iw, h: ih } = getItemWorldBounds(item);
    return (
      ix + iw >= vb.x - margin &&
      iy + ih >= vb.y - margin &&
      ix <= vb.x + vb.w + margin &&
      iy <= vb.y + vb.h + margin
    );
  }

  /** Current bucket value (for initial setup of new items). */
  get currentBucket(): number {
    return this._currentBucket;
  }

  destroy(): void {
    // nothing to clean up currently
  }
}
