import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { AnnotationStore } from '../stores/annotationStore';
import type { SceneManager } from './SceneManager';
import { getAuthorColorHex, getAuthorInitial } from '../utils/authorColors';

const PIN_RADIUS = 12;
const PIN_COLOR_RESOLVED = 0x555555;

// Tail direction: 225° (down-left) in standard math coords.
// In PixiJS screen coords (+y down), 225° maps to:
//   cos(225°) = -√2/2  (left)
//   sin(225°) = +√2/2  (down, because +y is down in screen space)
// So the circle center is offset UP-RIGHT from the anchor tip:
//   cx_offset = +r * √2/2,  cy_offset = -r * √2/2
const SIN45 = Math.SQRT1_2; // √2/2 ≈ 0.7071

/**
 * Draws a Figma-style teardrop pin whose tip lands at (0, 0).
 * The circle body is offset up-right; the tail points down-left to (0,0).
 *
 * @param gfx     Graphics object (drawn in its own local space, tip = origin)
 * @param r       Pin radius (already scaled to world space)
 * @param color   Fill color (0xRRGGBB)
 * @param alpha   Fill alpha
 */
function drawTeardrop(gfx: Graphics, r: number, color: number, alpha: number): void {
  // Circle center relative to tip
  const cx = r * SIN45;
  const cy = -r * SIN45;

  // Half-angle of the tail aperture from the tip (in radians).
  // Controls how wide/sharp the tail looks. ~20° gives a nice taper.
  const tailHalfAngle = (20 * Math.PI) / 180;

  // Angle from circle center toward tip = 225° in screen coords
  const tipAngle = (225 * Math.PI) / 180;

  // The two "wing" angles on the circle where the tail edges start
  const wingAngle1 = tipAngle - tailHalfAngle;
  const wingAngle2 = tipAngle + tailHalfAngle;

  // Build the teardrop as a single filled path:
  // start at wing1 on circle → arc around (the "long way" CCW past top) → wing2 → line to tip → close
  gfx.moveTo(cx + r * Math.cos(wingAngle1), cy + r * Math.sin(wingAngle1));
  // Arc from wingAngle1 to wingAngle2 going CCW (counterclockwise = increasing angle in screen space)
  // "long way" means going through the top of the circle (not through 225°).
  // In PixiJS, arc() takes (cx, cy, r, startAngle, endAngle, anticlockwise).
  // We want the arc that does NOT pass through 225°, so go anticlockwise from wingAngle1 to wingAngle2.
  gfx.arc(cx, cy, r, wingAngle1, wingAngle2, true);
  gfx.lineTo(0, 0); // tip at anchor
  gfx.closePath();
  gfx.fill({ color, alpha });
}

export class PinOverlay extends Container {
  private _pins = new Map<string, Container>();
  private _pool: Container[] = [];
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _store: AnnotationStore;

  constructor(viewport: Viewport, scene: SceneManager, store: AnnotationStore) {
    super();
    this._viewport = viewport;
    this._scene = scene;
    this._store = store;
  }

  private _acquire(): Container {
    const c = this._pool.pop() || new Container();
    c.removeChildren();
    c.visible = true;
    c.eventMode = 'none';
    c.cursor = 'default';
    return c;
  }

  private _release(c: Container) {
    c.visible = false;
    this._pool.push(c);
  }

  /** Call on every viewport moved/zoomed event and on store change */
  refresh(showResolved = false) {
    const scale = 1 / this._viewport.scale.x;

    // Return current pins to pool
    for (const c of this._pins.values()) this._release(c);
    this._pins.clear();

    const r = PIN_RADIUS * scale;

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
        // Default: top-right corner of object bounds
        wx = bounds.x + bounds.width;
        wy = bounds.y;
      }

      const isResolved = thread.status === 'resolved';
      const fillColor = isResolved ? PIN_COLOR_RESOLVED : getAuthorColorHex(thread.created_by);
      const fillAlpha = isResolved ? 0.5 : 1.0;

      // Container whose origin = anchor tip
      const pin = this._acquire();
      pin.position.set(wx, wy);
      pin.eventMode = 'static';
      pin.cursor = 'pointer';
      (pin as any)._threadId = thread.id;

      // ── Teardrop body ──
      const gfx = new Graphics();
      drawTeardrop(gfx, r, fillColor, fillAlpha);
      // White stroke around the circle part only (drawn as a separate circle stroke)
      gfx.circle(r * SIN45, -r * SIN45, r);
      gfx.stroke({ color: 0xffffff, width: 1.5 * scale, alpha: isResolved ? 0.4 : 0.85 });
      pin.addChild(gfx);

      // ── Author initial ──
      const authorName = thread.comments[0]?.author_name ?? '';
      const initial = getAuthorInitial(authorName);
      const initialText = new Text({
        text: initial,
        style: new TextStyle({
          fontSize: r * 1.1,
          fill: '#ffffff',
          fontWeight: 'bold',
          fontFamily: 'Inter, system-ui, sans-serif',
        }),
      });
      initialText.anchor.set(0.5);
      // Center on the circle body
      initialText.position.set(r * SIN45, -r * SIN45);
      pin.addChild(initialText);

      // ── Pin number label (#N) ──
      const pinNum = this._store.getPinNumber(thread.id);
      const numLabel = new Text({
        text: `#${pinNum}`,
        style: new TextStyle({
          fontSize: r * 0.75,
          fill: '#ffffff',
          fontWeight: 'bold',
          fontFamily: 'Inter, system-ui, sans-serif',
          dropShadow: {
            color: '#000000',
            blur: 2 * scale,
            distance: 0,
            alpha: 0.6,
          },
        }),
      });
      numLabel.anchor.set(0, 1);
      // Place just to the right of the circle top
      numLabel.position.set(r * SIN45 + r * 1.1, -r * SIN45 - r * 0.9);
      pin.addChild(numLabel);

      if (!pin.parent) this.addChild(pin);
      this._pins.set(thread.id, pin);
    }
  }

  getThreadIdAtPoint(worldX: number, worldY: number): string | null {
    const scale = 1 / this._viewport.scale.x;
    const r = PIN_RADIUS * scale;
    // Hit-test against the circle body of each pin (not the tail tip)
    const cx_off = r * SIN45;
    const cy_off = -r * SIN45;

    for (const [threadId, pin] of this._pins) {
      const circleCx = pin.position.x + cx_off;
      const circleCy = pin.position.y + cy_off;
      const dx = circleCx - worldX;
      const dy = circleCy - worldY;
      if (dx * dx + dy * dy <= r * r) {
        return threadId;
      }
    }
    return null;
  }

  override destroy(options?: any) {
    for (const c of this._pins.values()) c.destroy({ children: true });
    for (const c of this._pool) c.destroy({ children: true });
    this._pins.clear();
    this._pool = [];
    super.destroy(options);
  }
}
