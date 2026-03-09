/**
 * SnapGuides — alignment snap guides for drag/resize operations (like Figma).
 *
 * Shows thin magenta guide lines when edges or centers of dragged items
 * align with other items on the canvas, and returns snap corrections.
 */

import { Container, Graphics } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { SceneManager, getItemWorldBounds } from './SceneManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNAP_THRESHOLD = 4; // pixels in screen space (subtle, not aggressive)
const GUIDE_COLOR = 0xff4081;
const GUIDE_PADDING = 20; // world-space extension beyond bounds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapEdge {
  axis: 'x' | 'y';
  value: number;
  min: number;
  max: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapEdge[];
}

// ---------------------------------------------------------------------------
// SnapGuides
// ---------------------------------------------------------------------------

export class SnapGuides {
  private _scene: SceneManager;
  private _gfx: Graphics;

  /** Cached candidate edges from non-selected items. */
  private _candidatesX: { value: number; min: number; max: number }[] = [];
  private _candidatesY: { value: number; min: number; max: number }[] = [];

  constructor(scene: SceneManager, parent: Container) {
    this._scene = scene;
    this._gfx = new Graphics();
    this._gfx.label = '__snap_guides';
    parent.addChild(this._gfx);
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  /** Cache candidate edges from all visible, unlocked, non-selected top-level items. */
  beginSession(excludeIds: Set<string>): void {
    this._candidatesX = [];
    this._candidatesY = [];

    for (const item of this._scene.getTopLevelItems()) {
      if (excludeIds.has(item.id)) continue;
      if (item.data.locked || !item.data.visible) continue;

      const { x, y, w, h } = getItemWorldBounds(item);
      const right = x + w;
      const bottom = y + h;
      const cx = x + w / 2;
      const cy = y + h / 2;

      // X-axis edges: left, center, right
      this._candidatesX.push({ value: x, min: y, max: bottom });
      this._candidatesX.push({ value: cx, min: y, max: bottom });
      this._candidatesX.push({ value: right, min: y, max: bottom });

      // Y-axis edges: top, center, bottom
      this._candidatesY.push({ value: y, min: x, max: right });
      this._candidatesY.push({ value: cy, min: x, max: right });
      this._candidatesY.push({ value: bottom, min: x, max: right });
    }
  }

  /** Clear cached edges and guide lines. */
  endSession(): void {
    this._candidatesX = [];
    this._candidatesY = [];
    this._gfx.clear();
  }

  // -----------------------------------------------------------------------
  // Snap computation
  // -----------------------------------------------------------------------

  /**
   * Compare 6 edges of the selection bounds against cached candidates.
   * Returns correction deltas and guide lines to draw.
   */
  computeSnap(
    bounds: { x: number; y: number; w: number; h: number },
    viewport: Viewport,
  ): SnapResult {
    const scale = viewport.scale.x;
    const threshold = SNAP_THRESHOLD / scale;

    const { x, y, w, h } = bounds;
    const right = x + w;
    const bottom = y + h;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Selection edges for each axis
    const selEdgesX = [x, cx, right];
    const selEdgesY = [y, cy, bottom];

    // Selection extent ranges (for guide line extension)
    const selMinY = y;
    const selMaxY = bottom;
    const selMinX = x;
    const selMaxX = right;

    let bestDx = Infinity;
    let bestGuideX: SnapEdge | null = null;

    // Find closest X match
    for (const selVal of selEdgesX) {
      for (const cand of this._candidatesX) {
        const diff = cand.value - selVal;
        if (Math.abs(diff) < Math.abs(bestDx)) {
          bestDx = diff;
          const gMin = Math.min(selMinY, cand.min) - GUIDE_PADDING;
          const gMax = Math.max(selMaxY, cand.max) + GUIDE_PADDING;
          bestGuideX = { axis: 'x', value: cand.value, min: gMin, max: gMax };
        }
      }
    }

    let bestDy = Infinity;
    let bestGuideY: SnapEdge | null = null;

    // Find closest Y match
    for (const selVal of selEdgesY) {
      for (const cand of this._candidatesY) {
        const diff = cand.value - selVal;
        if (Math.abs(diff) < Math.abs(bestDy)) {
          bestDy = diff;
          const gMin = Math.min(selMinX, cand.min) - GUIDE_PADDING;
          const gMax = Math.max(selMaxX, cand.max) + GUIDE_PADDING;
          bestGuideY = { axis: 'y', value: cand.value, min: gMin, max: gMax };
        }
      }
    }

    const guides: SnapEdge[] = [];
    const dx = Math.abs(bestDx) <= threshold && bestGuideX ? bestDx : 0;
    const dy = Math.abs(bestDy) <= threshold && bestGuideY ? bestDy : 0;

    if (dx !== 0 && bestGuideX) guides.push(bestGuideX);
    if (dy !== 0 && bestGuideY) guides.push(bestGuideY);

    return { dx, dy, guides };
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  /** Draw guide lines; line width compensates for viewport zoom. */
  drawGuides(guides: SnapEdge[], viewport: Viewport): void {
    this._gfx.clear();

    if (guides.length === 0) return;

    const lineWidth = 1 / viewport.scale.x;

    for (const g of guides) {
      this._gfx.moveTo(
        g.axis === 'x' ? g.value : g.min,
        g.axis === 'x' ? g.min : g.value,
      );
      this._gfx.lineTo(
        g.axis === 'x' ? g.value : g.max,
        g.axis === 'x' ? g.max : g.value,
      );
    }

    this._gfx.stroke({ color: GUIDE_COLOR, width: lineWidth });
  }
}
