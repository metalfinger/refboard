import { Container, Sprite, Texture, Graphics, Rectangle } from "pixi.js";
import { TextureManager } from "../TextureManager";
import type { CropRect } from "../scene-format";

/**
 * A Container holding a shadow graphic + sprite with lazy texture loading.
 * Uses a lightweight Graphics shadow instead of DropShadowFilter (GPU-heavy).
 *
 * Textures are loaded/unloaded by the viewport culling system (PixiCanvas).
 * The constructor does NOT start loading — call loadTexture() when near viewport.
 * The Sprite is NOT added to the display tree until a real texture is loaded,
 * because PixiJS v8 crashes when rendering a Sprite with Texture.EMPTY.
 */
// Shadow defaults (resting state)
const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
// Shadow lifted state (during drag)
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class ImageSprite extends Container {
  readonly assetKey: string;

  private textures: TextureManager;
  loaded = false;
  private loading = false;
  private placeholder: Graphics | null = null;
  private _sprite: Sprite | null = null;
  private _shadow: Graphics;
  private _cropMask: Graphics | null = null;
  private _naturalWidth: number;
  private _naturalHeight: number;

  constructor(
    assetKey: string,
    w: number,
    h: number,
    textures: TextureManager,
  ) {
    super();

    this.assetKey = assetKey;
    this.textures = textures;
    this._naturalWidth = w;
    this._naturalHeight = h;

    // Shadow: simple dark rect behind the sprite (cheap, no GPU filter)
    this._shadow = new Graphics();
    this._drawShadow(SHADOW_REST);
    this.addChild(this._shadow);

    // Placeholder: dark rect shown until texture is loaded by culling system
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);

    // NOTE: Sprite is created lazily in loadTexture() — NOT added here.
  }

  get naturalWidth(): number { return this._naturalWidth; }
  get naturalHeight(): number { return this._naturalHeight; }

  private _drawShadow(cfg: { offsetX: number; offsetY: number; alpha: number }): void {
    const w = this._naturalWidth;
    const h = this._naturalHeight;
    this._shadow.clear();
    this._shadow.rect(cfg.offsetX, cfg.offsetY, w, h);
    this._shadow.fill({ color: 0x000000, alpha: cfg.alpha });
  }

  /** Expand shadow for drag-lift effect. */
  liftShadow(): void {
    this._drawShadow(SHADOW_LIFT);
  }

  /** Restore shadow to resting state. */
  dropShadow(): void {
    this._drawShadow(SHADOW_REST);
  }

  /** The underlying sprite's texture (used by clipboard for resolution detection). */
  get texture(): Texture {
    return this._sprite?.texture ?? Texture.EMPTY;
  }

  /**
   * Apply a crop mask. Normalized 0-1 values relative to natural dimensions.
   * Pass null/undefined to remove crop.
   */
  applyCrop(crop: CropRect | undefined): void {
    if (!crop) {
      // Remove crop
      if (this._cropMask) {
        if (this._sprite) this._sprite.mask = null;
        this.removeChild(this._cropMask);
        this._cropMask.destroy();
        this._cropMask = null;
      }
      // Restore shadow to full size
      this._drawShadow(SHADOW_REST);
      return;
    }

    const px = crop.x * this._naturalWidth;
    const py = crop.y * this._naturalHeight;
    const pw = crop.w * this._naturalWidth;
    const ph = crop.h * this._naturalHeight;

    if (!this._cropMask) {
      this._cropMask = new Graphics();
      this.addChild(this._cropMask);
    }

    this._cropMask.clear();
    this._cropMask.rect(px, py, pw, ph);
    this._cropMask.fill(0xffffff);

    if (this._sprite) {
      this._sprite.mask = this._cropMask;
    }

    // Update shadow to match cropped area
    this._shadow.clear();
    this._shadow.rect(px + SHADOW_REST.offsetX, py + SHADOW_REST.offsetY, pw, ph);
    this._shadow.fill({ color: 0x000000, alpha: SHADOW_REST.alpha });
  }

  /** Load the full-res texture. Called by viewport culling when near viewport. */
  async loadTexture(): Promise<void> {
    if (this.loaded || this.loading) return;

    this.loading = true;
    try {
      const tex = await this.textures.load(this.assetKey);
      if (this.destroyed) return;

      // Create sprite with real texture and add to display tree
      const sprite = new Sprite(tex);
      sprite.width = this._naturalWidth;
      sprite.height = this._naturalHeight;
      this._sprite = sprite;
      // Insert before placeholder (so placeholder is on top until removed)
      this.addChild(sprite);
      this.loaded = true;

      // Apply crop mask if one exists
      if (this._cropMask) {
        sprite.mask = this._cropMask;
      }

      // Remove placeholder after successful load
      if (this.placeholder) {
        this.removeChild(this.placeholder);
        this.placeholder.destroy();
        this.placeholder = null;
      }
    } catch (err) {
      console.warn(
        `[ImageSprite] Failed to load "${this.assetKey}":`,
        err,
      );
    } finally {
      this.loading = false;
    }
  }

  /** Unload texture to free GPU memory. Called by viewport culling when far from viewport. */
  unloadTexture(): void {
    if (!this.loaded) return;

    this.textures.release(this.assetKey);

    // Remove sprite from display tree entirely — avoids PixiJS v8 render crash
    if (this._sprite) {
      this._sprite.mask = null;
      this.removeChild(this._sprite);
      this._sprite.destroy();
      this._sprite = null;
    }
    this.loaded = false;

    // Restore placeholder
    if (!this.placeholder) {
      const placeholder = new Graphics();
      placeholder.rect(0, 0, this._naturalWidth, this._naturalHeight).fill(0x2a2a2a);
      this.placeholder = placeholder;
      this.addChild(placeholder);
    }
  }
}
