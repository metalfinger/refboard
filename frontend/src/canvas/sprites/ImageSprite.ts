import { Container, Sprite, Texture, Graphics } from "pixi.js";
import { TextureManager } from "../TextureManager";

/**
 * A Container holding a shadow graphic + sprite with lazy texture loading.
 * Uses a lightweight Graphics shadow instead of DropShadowFilter (GPU-heavy).
 */
// Shadow defaults (resting state)
const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
// Shadow lifted state (during drag)
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class ImageSprite extends Container {
  readonly assetKey: string;

  private textures: TextureManager;
  private loaded = false;
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

    // Main sprite
    this._sprite = new Sprite(Texture.EMPTY);
    this._sprite.width = w;
    this._sprite.height = h;
    this.addChild(this._sprite);

    // Create placeholder: dark rect shown until first texture loads
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);

    // Immediately start loading the full texture
    this.loadTexture();
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

  /** Load the full-res texture. GPU handles scaling natively. */
  async loadTexture(): Promise<void> {
    if (this.loaded || this.loading) return;

    this.loading = true;
    try {
      const tex = await this.textures.load(this.assetKey);
      this._sprite.texture = tex;
      this._sprite.width = this._naturalWidth;
      this._sprite.height = this._naturalHeight;
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
}
