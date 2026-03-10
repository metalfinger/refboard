import { Container, Graphics } from "pixi.js";
import { GifSprite } from "pixi.js/gif";
import { TextureManager } from "../TextureManager";

/**
 * A Container holding a shadow graphic + animated GIF sprite with lazy loading.
 *
 * Follows the same pattern as ImageSprite:
 * - Shadow + placeholder shown immediately
 * - Texture loaded lazily by viewport culling system
 * - GIF loaded/unloaded via TextureManager's ref-counted gifCache
 *   (safe for duplicated GIFs on the same board)
 *
 * Uses PixiJS v8's built-in GifSprite (backed by gifuct-js).
 */
const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class AnimatedGifSprite extends Container {
  readonly assetKey: string;

  private textures: TextureManager;
  loaded = false;
  private loading = false;
  private placeholder: Graphics | null = null;
  private _gif: GifSprite | null = null;
  private _shadow: Graphics;
  private _naturalWidth: number;
  private _naturalHeight: number;
  private _playing = false;

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

    // Shadow
    this._shadow = new Graphics();
    this._drawShadow(SHADOW_REST);
    this.addChild(this._shadow);

    // Placeholder
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);
  }

  private _drawShadow(cfg: { offsetX: number; offsetY: number; alpha: number }): void {
    this._shadow.clear();
    this._shadow.rect(cfg.offsetX, cfg.offsetY, this._naturalWidth, this._naturalHeight);
    this._shadow.fill({ color: 0x000000, alpha: cfg.alpha });
  }

  liftShadow(): void {
    this._drawShadow(SHADOW_LIFT);
  }

  dropShadow(): void {
    this._drawShadow(SHADOW_REST);
  }

  /** The underlying GIF sprite's current texture (for clipboard/export). */
  get texture() {
    return this._gif?.texture ?? null;
  }

  /** Whether the GIF is currently animating. */
  get playing(): boolean {
    return this._playing;
  }

  /** Load the GIF source (ref-counted). Called by viewport culling. */
  async loadTexture(): Promise<void> {
    if (this.loaded || this.loading) return;

    this.loading = true;
    try {
      const source = await this.textures.loadGif(this.assetKey);
      if (this.destroyed) {
        this.textures.releaseGif(this.assetKey);
        return;
      }

      // Create GifSprite paused — culling system decides whether to play
      const gif = new GifSprite({ source, loop: true, autoPlay: false });
      gif.width = this._naturalWidth;
      gif.height = this._naturalHeight;
      this._gif = gif;
      this._playing = false;
      this.addChild(gif);
      this.loaded = true;

      // Remove placeholder
      if (this.placeholder) {
        this.removeChild(this.placeholder);
        this.placeholder.destroy();
        this.placeholder = null;
      }
    } catch (err) {
      console.warn(`[AnimatedGifSprite] Failed to load "${this.assetKey}":`, err);
    } finally {
      this.loading = false;
    }
  }

  /** Start GIF animation. Called by culling when within play budget. */
  play(): void {
    if (this._gif && !this._playing) {
      this._gif.play();
      this._playing = true;
    }
  }

  /** Stop GIF animation (stays on current frame). Called by culling when outside budget. */
  stop(): void {
    if (this._gif && this._playing) {
      this._gif.stop();
      this._playing = false;
    }
  }

  /** Release ref-counted GIF source on destroy (handles deletion while loaded). */
  override destroy(options?: any): void {
    if (this.loaded) {
      if (this._gif) {
        this._gif.stop();
        this._playing = false;
      }
      this.textures.releaseGif(this.assetKey);
      this.loaded = false;
    }
    super.destroy(options);
  }

  /** Unload GIF to free memory (ref-counted). Called by viewport culling. */
  unloadTexture(): void {
    if (!this.loaded) return;

    if (this._gif) {
      this._gif.stop();
      this._playing = false;
      this.removeChild(this._gif);
      this._gif.destroy();
      this._gif = null;
    }

    // Release through ref-counted manager (safe for duplicates)
    this.textures.releaseGif(this.assetKey);

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
