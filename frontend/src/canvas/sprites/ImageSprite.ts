import { Sprite, Texture, Graphics } from "pixi.js";
import { DropShadowFilter } from "pixi-filters";
import { TextureManager, LODTier } from "../TextureManager";

/**
 * A Sprite subclass that manages LOD tier switching and lazy loading.
 * Shows a placeholder shimmer rect until the first texture tier loads,
 * then swaps textures as zoom level changes.
 */
// Shadow defaults (resting state)
const SHADOW_REST = { offsetX: 3, offsetY: 3, blur: 4, alpha: 0.25 };
// Shadow lifted state (during drag)
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, blur: 8, alpha: 0.35 };

export class ImageSprite extends Sprite {
  readonly assetKey: string;
  readonly shadow: DropShadowFilter;

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

    // Drop shadow for photos-on-a-desk feel
    this.shadow = new DropShadowFilter({
      offset: { x: SHADOW_REST.offsetX, y: SHADOW_REST.offsetY },
      blur: SHADOW_REST.blur,
      alpha: SHADOW_REST.alpha,
      color: 0x000000,
    });
    this.filters = [this.shadow];

    // Create placeholder: dark rect shown until first texture loads
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);

    // Immediately start loading the thumbnail tier
    this.loadTier("thumb");
  }

  /** Expand shadow for drag-lift effect. */
  liftShadow(): void {
    this.shadow.offset = { x: SHADOW_LIFT.offsetX, y: SHADOW_LIFT.offsetY };
    this.shadow.blur = SHADOW_LIFT.blur;
    this.shadow.alpha = SHADOW_LIFT.alpha;
  }

  /** Restore shadow to resting state. */
  dropShadow(): void {
    this.shadow.offset = { x: SHADOW_REST.offsetX, y: SHADOW_REST.offsetY };
    this.shadow.blur = SHADOW_REST.blur;
    this.shadow.alpha = SHADOW_REST.alpha;
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
