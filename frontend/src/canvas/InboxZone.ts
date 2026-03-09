/**
 * InboxZone — visual drop-zone on the canvas where auto-synced media arrives.
 *
 * Positioned at top-left of the world (outside typical content area).
 * Shows a dashed border rectangle with an "Inbox" label.
 * Items slide in with spring animations.
 */

import { Container, Graphics, Text, TextStyle, Sprite, Texture } from 'pixi.js';
import { TextureManager } from './TextureManager';
import { SpringManager, Spring, PRESETS } from './spring';

// ---------------------------------------------------------------------------
// InboxZone
// ---------------------------------------------------------------------------

export class InboxZone extends Container {
  private border: Graphics;
  private labelText: Text;
  private mediaContainer: Container;
  private textures: TextureManager;
  private springs: SpringManager;

  /** Width of the inbox zone in world units. */
  static readonly WIDTH = 300;
  /** Height of the inbox zone in world units. */
  static readonly HEIGHT = 400;

  constructor(textures: TextureManager, springs: SpringManager) {
    super();

    this.textures = textures;
    this.springs = springs;

    // Position outside the typical content area
    this.position.set(-500, -500);

    // Dashed border rectangle
    this.border = new Graphics();
    this._drawBorder();
    this.addChild(this.border);

    // "Inbox" label at the top
    const style = new TextStyle({
      fontSize: 14,
      fill: 0x888888,
      fontFamily: 'system-ui, sans-serif',
      fontWeight: '600',
    });
    this.labelText = new Text({ text: 'Inbox', style });
    this.labelText.position.set(10, 8);
    this.addChild(this.labelText);

    // Container for media items (below the label)
    this.mediaContainer = new Container();
    this.mediaContainer.position.set(0, 32);
    this.addChild(this.mediaContainer);

    // Non-interactive by default — items inside can be dragged out
    this.eventMode = 'passive';
  }

  /** Draw the dashed border rectangle. */
  private _drawBorder(): void {
    const g = this.border;
    const w = InboxZone.WIDTH;
    const h = InboxZone.HEIGHT;
    const dashLen = 8;
    const gapLen = 6;

    g.clear();

    // Background fill (very subtle)
    g.rect(0, 0, w, h);
    g.fill({ color: 0x222222, alpha: 0.2 });

    // Dashed border — draw as individual line segments
    g.setStrokeStyle({ width: 1, color: 0x666666, alpha: 0.3 });

    // Top edge
    this._drawDashedLine(g, 0, 0, w, 0, dashLen, gapLen);
    // Right edge
    this._drawDashedLine(g, w, 0, w, h, dashLen, gapLen);
    // Bottom edge
    this._drawDashedLine(g, w, h, 0, h, dashLen, gapLen);
    // Left edge
    this._drawDashedLine(g, 0, h, 0, 0, dashLen, gapLen);
  }

  /** Draw a dashed line between two points. */
  private _drawDashedLine(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dashLen: number,
    gapLen: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / dist;
    const ny = dy / dist;
    let pos = 0;
    let drawing = true;

    while (pos < dist) {
      const segLen = drawing ? dashLen : gapLen;
      const end = Math.min(pos + segLen, dist);

      if (drawing) {
        g.moveTo(x1 + nx * pos, y1 + ny * pos);
        g.lineTo(x1 + nx * end, y1 + ny * end);
        g.stroke();
      }

      pos = end;
      drawing = !drawing;
    }
  }

  /**
   * Add media items to the inbox with slide-in animation.
   * Items are positioned with slight random offset and rotation.
   */
  addMedia(items: { assetKey: string; w: number; h: number }[]): void {
    const padding = 10;
    const maxW = InboxZone.WIDTH - padding * 2;
    const availH = InboxZone.HEIGHT - 40 - padding;

    for (let i = 0; i < items.length; i++) {
      const { assetKey, w, h } = items[i];

      // Scale to fit within inbox width
      const scale = Math.min(maxW / w, 80 / h, 1);
      const sw = w * scale;
      const sh = h * scale;

      const sprite = new Sprite(Texture.EMPTY);
      sprite.width = sw;
      sprite.height = sh;

      // Load thumbnail texture
      this.textures.load(assetKey, 'thumb').then((tex) => {
        if (!sprite.destroyed) {
          sprite.texture = tex;
          sprite.width = sw;
          sprite.height = sh;
        }
      });

      // Random offset and rotation
      const offsetX = (Math.random() - 0.5) * 40;
      const offsetY = (Math.random() - 0.5) * 40;
      const rotation = ((Math.random() - 0.5) * 6 * Math.PI) / 180; // ±3 degrees

      const targetX = padding + offsetX + (maxW - sw) / 2;
      const targetY = (i * (sh + 10)) % availH + offsetY;

      sprite.position.set(-InboxZone.WIDTH, targetY); // Start off-screen left
      sprite.rotation = rotation;
      sprite.alpha = 0;

      this.mediaContainer.addChild(sprite);

      // Spring slide-in animation from left
      const slideSpring = new Spring(-InboxZone.WIDTH, targetX, PRESETS.bounce);
      slideSpring.onUpdate = (v) => {
        if (!sprite.destroyed) sprite.x = v;
      };
      this.springs.add(slideSpring);

      // Fade in
      const fadeSpring = new Spring(0, 1, PRESETS.gentle);
      fadeSpring.onUpdate = (v) => {
        if (!sprite.destroyed) sprite.alpha = v;
      };
      this.springs.add(fadeSpring);
    }
  }

  /** Remove all media items from the inbox. */
  clear(): void {
    while (this.mediaContainer.children.length > 0) {
      const child = this.mediaContainer.children[0];
      this.mediaContainer.removeChild(child);
      child.destroy({ children: true });
    }
  }

  /** Number of items currently in the inbox. */
  get count(): number {
    return this.mediaContainer.children.length;
  }
}
