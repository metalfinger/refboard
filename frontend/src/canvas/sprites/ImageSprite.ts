import { Sprite, Texture, Graphics } from "pixi.js";
import { TextureManager, LODTier } from "../TextureManager";

/**
 * A Sprite subclass that manages LOD tier switching and lazy loading.
 * Shows a placeholder shimmer rect until the first texture tier loads,
 * then swaps textures as zoom level changes.
 */
export class ImageSprite extends Sprite {
  readonly assetKey: string;

  private textures: TextureManager;
  private currentTier: LODTier | null = null;
  private loading = false;
  private placeholder: Graphics | null = null;
  private _naturalWidth: number;
  private _naturalHeight: number;

  constructor(
    assetKey: string,
    w: number,
    h: number,
    textures: TextureManager,
  ) {
    super(Texture.EMPTY);

    this.assetKey = assetKey;
    this.textures = textures;
    this._naturalWidth = w;
    this._naturalHeight = h;

    this.width = w;
    this.height = h;

    // Create placeholder: dark rect shown until first texture loads
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);

    // Immediately start loading the thumbnail tier
    this.loadTier("thumb");
  }

  /**
   * Load a specific LOD tier texture for this sprite.
   * Skips if already at the requested tier or currently loading.
   */
  async loadTier(tier: LODTier): Promise<void> {
    if (this.currentTier === tier || this.loading) return;

    this.loading = true;
    try {
      const tex = await this.textures.load(this.assetKey, tier);
      this.texture = tex;
      this.width = this._naturalWidth;
      this.height = this._naturalHeight;
      this.currentTier = tier;

      // Remove placeholder after first successful load
      if (this.placeholder) {
        this.removeChild(this.placeholder);
        this.placeholder.destroy();
        this.placeholder = null;
      }
    } catch (err) {
      console.warn(
        `[ImageSprite] Failed to load tier "${tier}" for "${this.assetKey}":`,
        err,
      );
    } finally {
      this.loading = false;
    }
  }

  /**
   * Evaluate the current zoom level and switch LOD tier if needed.
   */
  updateLOD(zoom: number): void {
    const needed = this.textures.tierForZoom(zoom);
    if (needed !== this.currentTier) {
      this.loadTier(needed);
    }
  }

  /**
   * Release the current texture (for off-screen sprites to free GPU memory).
   */
  unloadTexture(): void {
    this.texture = Texture.EMPTY;
    this.currentTier = null;
  }
}
