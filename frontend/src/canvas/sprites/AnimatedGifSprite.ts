import { Container, Graphics, Assets } from "pixi.js";
import { GifSprite, GifSource } from "pixi.js/gif";
import { TextureManager } from "../TextureManager";

/**
 * A Container holding a shadow graphic + animated GIF sprite with lazy loading.
 *
 * Follows the same pattern as ImageSprite:
 * - Shadow + placeholder shown immediately
 * - Texture loaded lazily by viewport culling system
 * - GIF plays automatically when loaded, pauses when unloaded
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

  /** Load the GIF. Called by viewport culling when near viewport. */
  async loadTexture(): Promise<void> {
    if (this.loaded || this.loading) return;

    this.loading = true;
    try {
      const url = this.textures.urlForAsset(this.assetKey);
      const source: GifSource = await Assets.load(url);
      if (this.destroyed) return;

      const gif = new GifSprite({ source, loop: true, autoPlay: true });
      gif.width = this._naturalWidth;
      gif.height = this._naturalHeight;
      this._gif = gif;
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

  /** Unload GIF to free memory. Called by viewport culling when far from viewport. */
  unloadTexture(): void {
    if (!this.loaded) return;

    if (this._gif) {
      this._gif.stop();
      this.removeChild(this._gif);
      this._gif.destroy();
      this._gif = null;
    }

    // Unload the GifSource from Assets cache
    const url = this.textures.urlForAsset(this.assetKey);
    try { Assets.unload(url); } catch { /* ignore */ }

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
