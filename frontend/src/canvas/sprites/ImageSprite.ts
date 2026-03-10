import { Container, Sprite, Texture, Graphics } from "pixi.js";
import { TextureManager } from "../TextureManager";

/**
 * A Container holding a shadow graphic + sprite with lazy texture loading.
 * Uses a lightweight Graphics shadow instead of DropShadowFilter (GPU-heavy).
 *
 * Textures are loaded/unloaded by the viewport culling system (PixiCanvas).
 * The constructor does NOT start loading — call loadTexture() when near viewport.
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
  private _sprite: Sprite;
  private _shadow: Graphics;
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

    // Main sprite — hidden until texture loads (prevents PixiJS render errors with EMPTY)
    this._sprite = new Sprite(Texture.EMPTY);
    this._sprite.width = w;
    this._sprite.height = h;
    this._sprite.visible = false;
    this.addChild(this._sprite);

    // Placeholder: dark rect shown until texture is loaded by culling system
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);

    // NOTE: texture loading is deferred — PixiCanvas culling ticker calls loadTexture()
  }

  private _drawShadow(cfg: { offsetX: number; offsetY: number; alpha: number }): void {
    this._shadow.clear();
    this._shadow.rect(cfg.offsetX, cfg.offsetY, this._naturalWidth, this._naturalHeight);
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
    return this._sprite.texture;
  }

  /** Load the full-res texture. Called by viewport culling when near viewport. */
  async loadTexture(): Promise<void> {
    if (this.loaded || this.loading) return;

    this.loading = true;
    try {
      const tex = await this.textures.load(this.assetKey);
      if (this.destroyed) return; // component may have been removed while loading
      this._sprite.texture = tex;
      this._sprite.width = this._naturalWidth;
      this._sprite.height = this._naturalHeight;
      this._sprite.visible = true;
      this.loaded = true;

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

    this.textures.unload(this.assetKey);
    this._sprite.texture = Texture.EMPTY;
    this._sprite.visible = false;
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
