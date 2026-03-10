import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { AnnotationStore } from '../stores/annotationStore';
import type { SceneManager } from './SceneManager';

const PIN_RADIUS = 10;
const PIN_COLOR_OPEN = 0xee4444;
const PIN_COLOR_RESOLVED = 0x666666;

export class PinOverlay extends Container {
  private _pins = new Map<string, Graphics>();
  private _voteBadges: Graphics[] = [];
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _store: AnnotationStore;

  constructor(viewport: Viewport, scene: SceneManager, store: AnnotationStore) {
    super();
    this._viewport = viewport;
    this._scene = scene;
    this._store = store;
  }

  /** Call on every viewport moved/zoomed event and on store change */
  refresh(showResolved = false) {
    const scale = 1 / this._viewport.scale.x; // scale-independent size

    // Remove old pins + badges
    for (const gfx of this._pins.values()) gfx.destroy();
    for (const gfx of this._voteBadges) gfx.destroy();
    this._pins.clear();
    this._voteBadges = [];
    this.removeChildren();

    // ── Thread pins ──
    for (const thread of this._store.threads.values()) {
      if (thread.status === 'resolved' && !showResolved) continue;

      const item = this._scene.items.get(thread.object_id);
      if (!item || !item.displayObject) continue;

      const bounds = item.displayObject.getBounds();
      let wx: number, wy: number;

      if (thread.anchor_type === 'point' && thread.pin_x != null && thread.pin_y != null) {
        wx = bounds.x + thread.pin_x * bounds.width;
        wy = bounds.y + thread.pin_y * bounds.height;
      } else {
        // Object-level: top-right corner
        wx = bounds.x + bounds.width;
        wy = bounds.y;
      }

      const gfx = new Graphics();
      const r = PIN_RADIUS * scale;
      const color = thread.status === 'open' ? PIN_COLOR_OPEN : PIN_COLOR_RESOLVED;

      gfx.circle(0, 0, r);
      gfx.fill({ color, alpha: 0.9 });
      gfx.stroke({ color: 0xffffff, width: 1.5 * scale, alpha: 0.8 });
      gfx.position.set(wx, wy);

      // Count label
      if (thread.comment_count > 1) {
        const label = new Text({
          text: String(thread.comment_count),
          style: new TextStyle({
            fontSize: 9 * scale,
            fill: '#ffffff',
            fontWeight: 'bold',
          }),
        });
        label.anchor.set(0.5);
        gfx.addChild(label);
      }

      gfx.eventMode = 'static';
      gfx.cursor = 'pointer';
      (gfx as any)._threadId = thread.id;

      this._pins.set(thread.id, gfx);
      this.addChild(gfx);
    }

    // ── Vote badges ──
    for (const [objectId, voters] of this._store.votes) {
      if (voters.size === 0) continue;
      const item = this._scene.items.get(objectId);
      if (!item || !item.displayObject) continue;

      const bounds = item.displayObject.getBounds();
      const wx = bounds.x + bounds.width;
      const wy = bounds.y + bounds.height;

      const gfx = new Graphics();
      const pw = 24 * scale;
      const ph = 16 * scale;
      const pr = 4 * scale;
      gfx.roundRect(-pw / 2, -ph / 2, pw, ph, pr);
      gfx.fill({ color: 0x2a3a50, alpha: 0.9 });
      gfx.position.set(wx - 16 * scale, wy - 4 * scale);

      const label = new Text({
        text: `${voters.size}`,
        style: new TextStyle({ fontSize: 9 * scale, fill: '#4a9eff', fontWeight: 'bold' }),
      });
      label.anchor.set(0.5);
      gfx.addChild(label);
      this.addChild(gfx);
      this._voteBadges.push(gfx);
    }
  }

  getThreadIdAtPoint(worldX: number, worldY: number): string | null {
    for (const [threadId, gfx] of this._pins) {
      const dx = gfx.position.x - worldX;
      const dy = gfx.position.y - worldY;
      const hitRadius = PIN_RADIUS / this._viewport.scale.x;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return threadId;
      }
    }
    return null;
  }

  override destroy(options?: any) {
    for (const gfx of this._pins.values()) gfx.destroy();
    for (const gfx of this._voteBadges) gfx.destroy();
    this._pins.clear();
    this._voteBadges = [];
    super.destroy(options);
  }
}
