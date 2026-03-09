import { Graphics } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';

interface LaserPoint {
  x: number;
  y: number;
  t: number;
}

export class LaserPointer {
  private _gfx: Graphics;
  private _viewport: Viewport;
  private _points: LaserPoint[] = [];
  private _active = false;
  private _rafId: number | null = null;
  private _color: number;
  private _fadeMs = 2000;
  private _maxPoints = 200;

  // Remote user lasers
  private _remoteGfx: Map<string, Graphics> = new Map();
  private _remotePoints: Map<string, LaserPoint[]> = new Map();

  constructor(viewport: Viewport, color: number = 0xff4444) {
    this._viewport = viewport;
    this._color = color;
    this._gfx = new Graphics();
    this._gfx.label = '__laser_local';
    viewport.addChild(this._gfx);
  }

  get isActive(): boolean {
    return this._active;
  }

  /** Begin recording trail, start render loop */
  start(): void {
    this._active = true;
    if (this._rafId === null) {
      this._tick();
    }
  }

  /** Stop recording, let trail fade naturally, stop loop when empty */
  stop(): void {
    this._active = false;
    // Render loop continues until all points have faded
  }

  /** Add a local laser point with current timestamp */
  addPoint(worldX: number, worldY: number): void {
    this._points.push({ x: worldX, y: worldY, t: performance.now() });
    if (this._points.length > this._maxPoints) {
      this._points.shift();
    }
  }

  /** Add points from a remote user's laser */
  addRemotePoints(
    userId: string,
    points: { x: number; y: number }[],
    color: number,
  ): void {
    const now = performance.now();

    if (!this._remoteGfx.has(userId)) {
      const gfx = new Graphics();
      gfx.label = `__laser_remote_${userId}`;
      this._viewport.addChild(gfx);
      this._remoteGfx.set(userId, gfx);
    }

    let arr = this._remotePoints.get(userId);
    if (!arr) {
      arr = [];
      this._remotePoints.set(userId, arr);
    }

    // Store color on the graphics object for rendering
    const gfx = this._remoteGfx.get(userId)!;
    (gfx as any)._laserColor = color;

    for (const p of points) {
      arr.push({ x: p.x, y: p.y, t: now });
    }
    if (arr.length > this._maxPoints) {
      arr.splice(0, arr.length - this._maxPoints);
    }

    // Ensure render loop is running
    if (this._rafId === null) {
      this._tick();
    }
  }

  /** Remove a remote user's laser entirely */
  removeRemote(userId: string): void {
    const gfx = this._remoteGfx.get(userId);
    if (gfx) {
      gfx.clear();
      gfx.destroy();
      this._remoteGfx.delete(userId);
    }
    this._remotePoints.delete(userId);
  }

  /** rAF-driven render loop */
  private _tick = (): void => {
    this._render();

    // Check if there's anything left to draw
    const hasLocal = this._points.length > 0;
    let hasRemote = false;
    for (const [, pts] of this._remotePoints) {
      if (pts.length > 0) {
        hasRemote = true;
        break;
      }
    }

    if (hasLocal || hasRemote || this._active) {
      this._rafId = requestAnimationFrame(this._tick);
    } else {
      this._rafId = null;
    }
  };

  private _render(): void {
    const now = performance.now();
    const scale = this._viewport.scale.x || 1;
    const lineWidth = 3 / scale;

    // --- Local laser ---
    this._prunePoints(this._points, now);
    this._drawTrail(this._gfx, this._points, this._color, lineWidth, now);

    // --- Remote lasers ---
    for (const [userId, pts] of this._remotePoints) {
      this._prunePoints(pts, now);
      const gfx = this._remoteGfx.get(userId);
      if (!gfx) continue;
      const color = (gfx as any)._laserColor ?? 0xff4444;
      this._drawTrail(gfx, pts, color, lineWidth, now);

      // Clean up empty remote lasers
      if (pts.length === 0) {
        gfx.clear();
        // Don't destroy — they may send more points
      }
    }
  }

  private _prunePoints(points: LaserPoint[], now: number): void {
    while (points.length > 0 && now - points[0].t > this._fadeMs) {
      points.shift();
    }
  }

  private _drawTrail(
    gfx: Graphics,
    points: LaserPoint[],
    color: number,
    lineWidth: number,
    now: number,
  ): void {
    gfx.clear();
    if (points.length < 2) return;

    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const age = now - p1.t;
      const alpha = Math.max(0, 1 - age / this._fadeMs);
      if (alpha <= 0) continue;

      gfx.setStrokeStyle({ width: lineWidth, color, alpha, cap: 'round', join: 'round' });
      gfx.moveTo(p0.x, p0.y);
      gfx.lineTo(p1.x, p1.y);
      gfx.stroke();
    }
  }

  /** Clean up all resources */
  destroy(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._active = false;
    this._points.length = 0;

    this._gfx.clear();
    this._gfx.destroy();

    for (const [, gfx] of this._remoteGfx) {
      gfx.clear();
      gfx.destroy();
    }
    this._remoteGfx.clear();
    this._remotePoints.clear();
  }
}
