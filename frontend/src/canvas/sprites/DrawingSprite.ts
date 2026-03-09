import { Graphics } from 'pixi.js';

/**
 * DrawingSprite — renders a freehand stroke from a flat points array.
 * Points stored as [x0, y0, x1, y1, ...] relative to the item's origin.
 *
 * Uses batched redraw during live drawing — accumulates points and redraws
 * on the next animation frame. This avoids expensive per-pointermove redraws
 * while keeping the stroke visually smooth.
 */
export class DrawingSprite extends Graphics {
  private _points: number[] = [];
  private _color: string;
  private _strokeWidth: number;
  private _rafId: number | null = null;
  private _dirty = false;

  constructor(points: number[], color: string, strokeWidth: number) {
    super();
    this._points = points;
    this._color = color;
    this._strokeWidth = strokeWidth;
    this._redraw();
  }

  get points(): number[] {
    return this._points;
  }

  /** Append a point during live drawing — batches redraw to next rAF. */
  addPoint(x: number, y: number): void {
    this._points.push(x, y);
    if (!this._dirty) {
      this._dirty = true;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._dirty = false;
        this._redraw();
      });
    }
  }

  /** Replace all points and redraw immediately. Used for scene load / sync. */
  setPoints(pts: number[]): void {
    this._points = pts;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
      this._dirty = false;
    }
    this._redraw();
  }

  private _redraw(): void {
    this.clear();
    const pts = this._points;
    if (pts.length < 4) return;

    this.setStrokeStyle({
      width: this._strokeWidth,
      color: this._color,
      cap: 'round',
      join: 'round',
    });

    this.moveTo(pts[0], pts[1]);

    // Use quadratic curve smoothing for 3+ points
    if (pts.length >= 6) {
      for (let i = 2; i < pts.length - 2; i += 2) {
        const mx = (pts[i] + pts[i + 2]) / 2;
        const my = (pts[i + 1] + pts[i + 3]) / 2;
        this.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
      }
      // Last segment
      this.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
    } else {
      this.lineTo(pts[2], pts[3]);
    }

    this.stroke();
  }

  override destroy(options?: any): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    super.destroy(options);
  }
}
