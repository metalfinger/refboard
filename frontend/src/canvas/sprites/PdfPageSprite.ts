import { Container, Sprite, Texture, Graphics, Text, TextStyle } from "pixi.js";
import { TextureManager } from "../TextureManager";

/**
 * PdfPageSprite — a Container for rendering a single PDF page on the canvas.
 *
 * Follows the ImageSprite pattern: shadow + placeholder + lazy texture loading.
 * Adds a page badge in the bottom-right corner showing "p.{N}/{total}".
 *
 * Textures are loaded/unloaded by the viewport culling system (PixiCanvas).
 * The constructor does NOT start loading — call loadTexture() when near viewport.
 */

// Shadow defaults (resting state)
const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
// Shadow lifted state (during drag)
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class PdfPageSprite extends Container {
  private _thumbKey: string | null;
  private _assetKey: string | null;
  private _activeKey: string | null = null; // which key is currently loaded

  private textures: TextureManager;
  loaded = false;
  private loading = false;
  private placeholder: Graphics | null = null;
  private _sprite: Sprite | null = null;
  private _shadow: Graphics;
  private _badge: Container;
  private _naturalWidth: number;
  private _naturalHeight: number;
  private _shadowCfg = SHADOW_REST;

  readonly pageNumber: number;
  readonly pageCount: number;

  constructor(
    thumbKey: string | null,
    assetKey: string | null,
    w: number,
    h: number,
    pageNumber: number,
    pageCount: number,
    textures: TextureManager,
  ) {
    super();

    this._thumbKey = thumbKey;
    this._assetKey = assetKey;
    this._naturalWidth = w;
    this._naturalHeight = h;
    this.pageNumber = pageNumber;
    this.pageCount = pageCount;
    this.textures = textures;

    // Shadow: simple dark rect behind the sprite (cheap, no GPU filter)
    this._shadow = new Graphics();
    this._drawShadow(SHADOW_REST);
    this.addChild(this._shadow);

    // Placeholder: dark rect shown until texture is loaded by culling system
    const placeholder = new Graphics();
    placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.placeholder = placeholder;
    this.addChild(placeholder);

    // Page badge: bottom-right corner — "p.N/total"
    this._badge = this._buildBadge(pageNumber, pageCount, w, h);
    this.addChild(this._badge);
  }

  get naturalWidth(): number { return this._naturalWidth; }
  get naturalHeight(): number { return this._naturalHeight; }

  /** Best available asset key: prefer high-res, fall back to thumb. */
  private get _bestKey(): string | null {
    return this._assetKey ?? this._thumbKey;
  }

  private _drawShadow(cfg: { offsetX: number; offsetY: number; alpha: number }): void {
    this._shadow.clear();
    this._shadow.rect(cfg.offsetX, cfg.offsetY, this._naturalWidth, this._naturalHeight);
    this._shadow.fill({ color: 0x000000, alpha: cfg.alpha });
  }

  /** Build the page badge container (rounded rect bg + text). */
  private _buildBadge(page: number, total: number, w: number, h: number): Container {
    const badge = new Container();

    const style = new TextStyle({
      fontSize: 12,
      fill: 0xffffff,
      fontFamily: 'sans-serif',
    });
    const label = new Text({ text: `p.${page}/${total}`, style });

    const padX = 6;
    const padY = 3;
    const bw = label.width + padX * 2;
    const bh = label.height + padY * 2;

    const bg = new Graphics();
    bg.roundRect(0, 0, bw, bh, 4);
    bg.fill({ color: 0x000000, alpha: 0.6 });

    label.position.set(padX, padY);

    badge.addChild(bg);
    badge.addChild(label);

    // Position at bottom-right of the page
    badge.position.set(w - bw - 6, h - bh - 6);

    return badge;
  }

  /** Expand shadow for drag-lift effect. */
  liftShadow(): void {
    this._shadowCfg = SHADOW_LIFT;
    this._drawShadow(this._shadowCfg);
  }

  /** Restore shadow to resting state. */
  dropShadow(): void {
    this._shadowCfg = SHADOW_REST;
    this._drawShadow(this._shadowCfg);
  }

  /** The underlying sprite's texture. */
  get texture(): Texture {
    return this._sprite?.texture ?? Texture.EMPTY;
  }

  /** Load the best available texture. Called by viewport culling when near viewport. */
  async loadTexture(): Promise<void> {
    if (this.loaded || this.loading) return;

    const key = this._bestKey;
    if (!key) return;

    this.loading = true;
    try {
      const tex = await this.textures.load(key);
      if (this.destroyed) return;

      // Create sprite with real texture and add to display tree
      const sprite = new Sprite(tex);
      sprite.width = this._naturalWidth;
      sprite.height = this._naturalHeight;
      this._sprite = sprite;
      // Insert before placeholder (so placeholder is on top until removed)
      this.addChild(sprite);
      this._activeKey = key;
      this.loaded = true;

      // Remove placeholder after successful load
      if (this.placeholder) {
        this.removeChild(this.placeholder);
        this.placeholder.destroy();
        this.placeholder = null;
      }

      // Ensure badge stays on top
      this.setChildIndex(this._badge, this.children.length - 1);
    } catch (err) {
      console.warn(
        `[PdfPageSprite] Failed to load "${key}":`,
        err,
      );
    } finally {
      this.loading = false;
    }
  }

  /** Swap to high-res texture once the pdf-hires job completes. */
  async upgradeTexture(hiresAssetKey: string): Promise<void> {
    this._assetKey = hiresAssetKey;

    // If not loaded at all, the next loadTexture() will pick it up
    if (!this.loaded || !this._sprite) return;

    try {
      const tex = await this.textures.load(hiresAssetKey);
      if (this.destroyed) return;

      // Release old key
      if (this._activeKey && this._activeKey !== hiresAssetKey) {
        this.textures.release(this._activeKey);
      }

      this._sprite.texture = tex;
      this._activeKey = hiresAssetKey;
    } catch (err) {
      console.warn(`[PdfPageSprite] Failed to upgrade to hires "${hiresAssetKey}":`, err);
    }
  }

  /** Set thumbnail key when it arrives after initial placement. */
  async setThumb(thumbKey: string): Promise<void> {
    this._thumbKey = thumbKey;

    // If already loaded with hires, no need to do anything
    if (this.loaded && this._assetKey && this._activeKey === this._assetKey) return;

    // If not loaded at all, the next loadTexture() will pick up the thumb
    if (!this.loaded) return;

    // Currently loaded with nothing better — swap to thumb
    try {
      const tex = await this.textures.load(thumbKey);
      if (this.destroyed) return;

      if (this._activeKey && this._activeKey !== thumbKey) {
        this.textures.release(this._activeKey);
      }

      if (!this._sprite) {
        this._sprite = new Sprite(tex);
        this._sprite.width = this._naturalWidth;
        this._sprite.height = this._naturalHeight;
        this.addChild(this._sprite);
        this.setChildIndex(this._badge, this.children.length - 1);
      } else {
        this._sprite.texture = tex;
      }
      this._activeKey = thumbKey;
    } catch (err) {
      console.warn(`[PdfPageSprite] Failed to load thumb "${thumbKey}":`, err);
    }
  }

  /** Unload texture to free GPU memory. Called by viewport culling when far from viewport. */
  unloadTexture(): void {
    if (!this.loaded) return;

    if (this._activeKey) {
      this.textures.release(this._activeKey);
      this._activeKey = null;
    }

    // Remove sprite from display tree entirely — avoids PixiJS v8 render crash
    if (this._sprite) {
      // Swap to EMPTY before destroying so PixiJS never reads a null source
      // during its render-loop traversal (collectRenderables → alphaMode).
      this._sprite.texture = Texture.EMPTY;
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

    // Ensure badge stays on top
    this.setChildIndex(this._badge, this.children.length - 1);
  }
}
