import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { AnnotationStore } from '../stores/annotationStore';
import type { SceneManager } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import { getAuthorColorHex, getAuthorInitial } from '../utils/authorColors';

const PIN_RADIUS = 11;
const PIN_COLOR_RESOLVED = 0x555555;
const TAIL_WIDTH = 6;
const TAIL_HEIGHT = 8;

function drawBubble(gfx: Graphics, r: number, color: number, alpha: number, scale: number): void {
  const padding = r * 0.3;
  const bubbleW = r * 2 + padding * 2;
  const bubbleH = r * 2 + padding;
  const cornerR = r * 0.4;
  const tailW = TAIL_WIDTH * scale;
  const tailH = TAIL_HEIGHT * scale;
  const bx = -bubbleW / 2;
  const by = -tailH - bubbleH;

  gfx.roundRect(bx, by, bubbleW, bubbleH, cornerR);
  gfx.fill({ color, alpha });
  gfx.moveTo(-tailW, -tailH);
  gfx.lineTo(0, 0);
  gfx.lineTo(tailW, -tailH);
  gfx.closePath();
  gfx.fill({ color, alpha });
  gfx.roundRect(bx, by, bubbleW, bubbleH, cornerR);
  gfx.stroke({ color: 0xffffff, width: 1.2 * scale, alpha: alpha * 0.5 });
}

// Shared TextStyle to avoid recreating per pin
const sharedStyle = new TextStyle({
  fill: '#ffffff',
  fontWeight: 'bold',
  fontFamily: 'Inter, system-ui, sans-serif',
});

interface PinData {
  container: Container;
  gfx: Graphics;
  initialText: Text;
  badge: Graphics | null;
  badgeText: Text | null;
  version: string; // tracks thread data changes
}

/**
 * PinOverlay — comment bubbles in a separate overlay Container.
 *
 * Position: uses getItemWorldBounds() which reads item.data.x/y (always current).
 * Visuals: Graphics redrawn in-place (clear + redraw), Text objects reused.
 * No objects are created or destroyed during drag — only position.set() calls.
 */
export class PinOverlay extends Container {
  private _pins = new Map<string, PinData>();
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _store: AnnotationStore;
  private _lastScale = -1;
  private _ghostPin: { objectId: string; pinX: number; pinY: number } | null = null;
  private _ghostContainer: Container | null = null;
  private _focusedThreadId: string | null = null;

  constructor(viewport: Viewport, scene: SceneManager, store: AnnotationStore) {
    super();
    this._viewport = viewport;
    this._scene = scene;
    this._store = store;
  }

  private _threadVersion(t: { status: string; created_by: string; comment_count: number }): string {
    return `${t.status}|${t.created_by}|${t.comment_count}`;
  }

  private _getAnchorWorld(thread: { object_id: string; anchor_type: string; pin_x: number | null; pin_y: number | null }): { x: number; y: number } | null {
    const item = this._scene.items.get(thread.object_id);
    if (!item) return null;
    const b = getItemWorldBounds(item);
    if (thread.anchor_type === 'point' && thread.pin_x != null && thread.pin_y != null) {
      return { x: b.x + thread.pin_x * b.w, y: b.y + thread.pin_y * b.h };
    }
    return { x: b.x + b.w * 0.9, y: b.y };
  }

  /**
   * Fast path: only update positions. Called during drag.
   * Zero allocations, zero texture work.
   */
  updatePositions() {
    for (const [threadId, entry] of this._pins) {
      const thread = this._store.threads.get(threadId);
      if (!thread) continue;
      const pos = this._getAnchorWorld(thread);
      if (pos) {
        entry.container.position.set(pos.x, pos.y);
      }
    }
  }

  /**
   * Full refresh: sync pins with store, rebuild visuals on zoom/data change.
   * Call on zoom, store change, or scene change — NOT during drag (use updatePositions).
   */
  refresh(showResolved = false) {
    const scale = 1 / this._viewport.scale.x;
    const scaleChanged = Math.abs(scale - this._lastScale) > 0.0001;
    this._lastScale = scale;

    const r = PIN_RADIUS * scale;
    const active = new Set<string>();

    for (const thread of this._store.threads.values()) {
      if (thread.status === 'resolved' && !showResolved) continue;

      const pos = this._getAnchorWorld(thread);
      if (!pos) continue;

      active.add(thread.id);
      const version = this._threadVersion(thread);
      const existing = this._pins.get(thread.id);

      if (existing) {
        existing.container.position.set(pos.x, pos.y);

        if (existing.version !== version || scaleChanged) {
          this._updateVisuals(existing, thread, r, scale);
          existing.version = version;
        }
        continue;
      }

      // Create new pin — only happens on store change, never during drag
      const entry = this._createPin(thread, r, scale, pos);
      this._pins.set(thread.id, entry);
    }

    // Remove pins whose threads are gone
    for (const [id, entry] of this._pins) {
      if (!active.has(id)) {
        this._destroyPin(entry);
        this._pins.delete(id);
      }
    }

    this._updateFocusVisuals();
    this._updateGhostPin();
  }

  private _createPin(thread: any, r: number, scale: number, pos: { x: number; y: number }): PinData {
    const container = new Container();
    container.position.set(pos.x, pos.y);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    (container as any)._threadId = thread.id;

    const gfx = new Graphics();
    container.addChild(gfx);

    const initialText = new Text({ text: '', style: sharedStyle.clone() });
    initialText.anchor.set(0.5);
    container.addChild(initialText);

    const badge = new Graphics();
    badge.visible = false;
    container.addChild(badge);

    const badgeText = new Text({ text: '', style: sharedStyle.clone() });
    badgeText.anchor.set(0.5);
    badgeText.visible = false;
    container.addChild(badgeText);

    const entry: PinData = { container, gfx, initialText, badge, badgeText, version: '' };
    this._updateVisuals(entry, thread, r, scale);
    entry.version = this._threadVersion(thread);

    this.addChild(container);

    // No entrance animation — focus styling must not be overwritten by animation.
    return entry;
  }

  /**
   * Update visuals IN PLACE — no object creation or destruction.
   * Graphics are cleared and redrawn. Text content/style updated.
   */
  private _updateVisuals(entry: PinData, thread: any, r: number, scale: number) {
    const isResolved = thread.status === 'resolved';
    const fillColor = isResolved ? PIN_COLOR_RESOLVED : getAuthorColorHex(thread.created_by);
    const fillAlpha = isResolved ? 0.45 : 0.92;

    // Redraw bubble — clear() keeps the same GPU buffer
    entry.gfx.clear();
    drawBubble(entry.gfx, r, fillColor, fillAlpha, scale);

    // Update initial text
    const authorName = thread.comments[0]?.author_name ?? '';
    const initial = getAuthorInitial(authorName);
    const tailH = TAIL_HEIGHT * scale;
    const bubbleH = r * 2 + r * 0.3;
    const bubbleCenterY = -tailH - bubbleH / 2;

    entry.initialText.text = initial;
    entry.initialText.style.fontSize = r * 1.05;
    entry.initialText.position.set(0, bubbleCenterY);

    // Update badge
    if (thread.comment_count > 1) {
      const padding = r * 0.3;
      const bubbleW = r * 2 + padding * 2;
      const badgeR = r * 0.45;
      const badgeX = bubbleW / 2 - badgeR * 0.5;
      const badgeY = -tailH - bubbleH + badgeR * 0.5;

      entry.badge!.clear();
      entry.badge!.circle(badgeX, badgeY, badgeR);
      entry.badge!.fill({ color: 0x000000, alpha: 0.6 });
      entry.badge!.circle(badgeX, badgeY, badgeR);
      entry.badge!.stroke({ color: 0xffffff, width: 0.8 * scale, alpha: 0.5 });
      entry.badge!.visible = true;

      entry.badgeText!.text = `${thread.comment_count}`;
      entry.badgeText!.style.fontSize = r * 0.55;
      entry.badgeText!.position.set(badgeX, badgeY);
      entry.badgeText!.visible = true;
    } else {
      entry.badge!.visible = false;
      entry.badgeText!.visible = false;
    }
  }

  private _destroyPin(entry: PinData) {
    if (!entry.container.destroyed) {
      entry.container.destroy({ children: true });
    }
  }

  setGhostPin(pin: { objectId: string; pinX: number; pinY: number } | null) {
    this._ghostPin = pin;
    this._updateGhostPin();
  }

  setFocusedThread(threadId: string | null) {
    if (this._focusedThreadId === threadId) return;
    this._focusedThreadId = threadId;
    this._updateFocusVisuals();
  }

  private _updateGhostPin() {
    // Remove existing ghost
    if (this._ghostContainer) {
      this._ghostContainer.destroy({ children: true });
      this._ghostContainer = null;
    }

    if (!this._ghostPin) return;

    const item = this._scene.items.get(this._ghostPin.objectId);
    if (!item) return;

    const b = getItemWorldBounds(item);
    const wx = b.x + this._ghostPin.pinX * b.w;
    const wy = b.y + this._ghostPin.pinY * b.h;
    const scale = 1 / this._viewport.scale.x;
    const r = PIN_RADIUS * scale;

    const container = new Container();
    container.position.set(wx, wy);
    container.alpha = 0.4;

    const gfx = new Graphics();
    drawBubble(gfx, r, 0xffffff, 0.6, scale);
    container.addChild(gfx);

    // "+" text in center
    const tailH = TAIL_HEIGHT * scale;
    const bubbleH = r * 2 + r * 0.3;
    const bubbleCenterY = -tailH - bubbleH / 2;
    const plusText = new Text({
      text: '+',
      style: new TextStyle({
        fill: '#ffffff',
        fontWeight: 'bold',
        fontSize: r * 1.2,
        fontFamily: 'Inter, system-ui, sans-serif',
      }),
    });
    plusText.anchor.set(0.5);
    plusText.position.set(0, bubbleCenterY);
    container.addChild(plusText);

    this.addChild(container);
    this._ghostContainer = container;
  }

  private _updateFocusVisuals() {
    for (const [threadId, entry] of this._pins) {
      if (this._focusedThreadId) {
        if (threadId === this._focusedThreadId) {
          entry.container.alpha = 1;
          entry.container.scale.set(1.15);
        } else {
          entry.container.alpha = 0.7;
          entry.container.scale.set(1);
        }
      } else {
        entry.container.alpha = 1;
        entry.container.scale.set(1);
      }
    }
  }

  getThreadIdAtPoint(worldX: number, worldY: number): string | null {
    const scale = 1 / this._viewport.scale.x;
    const r = PIN_RADIUS * scale;
    const tailH = TAIL_HEIGHT * scale;
    const bubbleH = r * 2 + r * 0.3;

    for (const [threadId, entry] of this._pins) {
      const bx = entry.container.position.x;
      const by = entry.container.position.y;
      const halfW = r + r * 0.3;

      if (
        worldX >= bx - halfW &&
        worldX <= bx + halfW &&
        worldY >= by - tailH - bubbleH &&
        worldY <= by
      ) {
        return threadId;
      }
    }
    return null;
  }

  override destroy(options?: any) {
    if (this._ghostContainer) {
      this._ghostContainer.destroy({ children: true });
      this._ghostContainer = null;
    }
    for (const entry of this._pins.values()) {
      this._destroyPin(entry);
    }
    this._pins.clear();
    super.destroy(options);
  }
}
