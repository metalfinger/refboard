import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import { TextureManager } from '../TextureManager';

/**
 * VideoSprite — Container with budget-aware lazy video lifecycle.
 *
 * Memory tiers (managed by external culling system):
 *   Tier 0 — placeholder only (offscreen, default state)
 *   Tier 0.5 — server poster loaded as image texture (no <video> needed!)
 *   Tier 1 — initialized <video> with preload='metadata' (near viewport)
 *   Tier 2 — client-captured poster from video frame (fallback if no server poster)
 *   Tier 3 — actively playing with live video texture (user-initiated)
 *
 * If the server provides a poster asset key at upload time, the video renders
 * as a plain image until explicitly played. No <video> element needed for thumbnails.
 */

const MAX_PLAYING_VIDEOS = 1;
const activeVideos: Set<VideoSprite> = new Set();

const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class VideoSprite extends Container {
  readonly assetKey: string;
  readonly videoUrl: string;
  readonly posterAssetKey: string | null;

  private textures: TextureManager | null;
  private videoEl: HTMLVideoElement | null = null;
  private videoTexture: Texture | null = null;
  private posterTexture: Texture | null = null;
  private _serverPosterLoaded = false;
  private _serverPosterLoading = false;
  private _sprite: Sprite | null = null;
  private _shadow: Graphics;
  private _overlay: Graphics;
  private _placeholder: Graphics | null = null;
  private _naturalWidth: number;
  private _naturalHeight: number;
  private _isPlaying = false;
  private _videoInitialized = false;
  private _hasPoster = false;
  muted = true;
  loop = true;

  /** Called when video metadata reveals the real dimensions. */
  onDimensionsKnown: ((w: number, h: number) => void) | null = null;

  /** Called when playback state changes (for external controls). */
  onStateChange: (() => void) | null = null;

  constructor(
    assetKey: string,
    w: number,
    h: number,
    videoUrl: string,
    posterAssetKey?: string | null,
    textures?: TextureManager | null,
  ) {
    super();

    this.assetKey = assetKey;
    this.videoUrl = videoUrl;
    this.posterAssetKey = posterAssetKey ?? null;
    this.textures = textures ?? null;
    this._naturalWidth = w;
    this._naturalHeight = h;

    // Shadow
    this._shadow = new Graphics();
    this._drawShadow(SHADOW_REST);
    this.addChild(this._shadow);

    // Dark placeholder
    this._placeholder = new Graphics();
    this._placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.addChild(this._placeholder);

    // Play/pause overlay
    this._overlay = new Graphics();
    this._drawPlayIcon();
    this.addChild(this._overlay);

    // NOTE: Server poster is NOT loaded here. The culling system calls
    // loadServerPoster() when this video is within the poster budget.
  }

  get isPlaying(): boolean { return this._isPlaying; }
  get isInitialized(): boolean { return this._videoInitialized; }
  get hasPoster(): boolean { return this._hasPoster; }

  /** Expose the underlying HTMLVideoElement for external controls. Null if not initialized. */
  get videoElement(): HTMLVideoElement | null { return this.videoEl; }

  /** Whether this video has a server-generated poster available (not yet loaded). */
  get hasServerPoster(): boolean { return !!this.posterAssetKey && !!this.textures; }

  // ---- Tier 0.5: Server-generated poster (loaded like an image) -----------

  /** Load server poster. Called by culling system when within poster budget. */
  async loadServerPoster(): Promise<void> {
    if (this._serverPosterLoading || !this.posterAssetKey || !this.textures || this.destroyed) return;
    this._serverPosterLoading = true;
    try {
      const tex = await this.textures.load(this.posterAssetKey);
      if (this.destroyed || this._isPlaying) {
        this.textures!.release(this.posterAssetKey!);
        return;
      }

      this.posterTexture = tex;
      this._hasPoster = true;
      this._serverPosterLoaded = true;

      this._ensureSprite(tex);
      this._removePlaceholder();
    } catch {
      // Server poster failed — will fall back to client capture if needed
    } finally {
      this._serverPosterLoading = false;
    }
  }

  // ---- Tier 1: Initialize <video> element ---------------------------------

  /** Create <video> with preload='metadata'. Called by culling when within init budget. */
  initVideo(): void {
    if (this._videoInitialized || this.destroyed) return;
    this._videoInitialized = true;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';

    video.addEventListener('loadedmetadata', this._onLoadedMetadata);

    this.videoEl = video;
    video.src = this.videoUrl;
    this.onStateChange?.();
  }

  /** Tear down the <video> element. Keeps poster if present. */
  teardownVideo(): void {
    if (!this._videoInitialized) return;
    if (this._isPlaying) return;

    this._destroyVideoEl();
    this._destroyVideoTexture();
    this._videoInitialized = false;
    this.onStateChange?.();
  }

  // ---- Tier 2: Client-captured poster (fallback) --------------------------

  /** Capture a poster frame from video. Only needed if no server poster. */
  capturePoster(): void {
    if (this._hasPoster || !this.videoEl || this.destroyed) return;

    if (this.videoEl.readyState >= 2) {
      this._captureFirstFrame();
    } else if (this.videoEl.readyState >= 1) {
      // preload='metadata' may not decode frames. Force a seek.
      this._trySeekCapture();
    } else {
      this.videoEl.addEventListener('loadeddata', this._onLoadedData, { once: true });
    }
  }

  /** Destroy the poster texture to free GPU memory. */
  destroyPoster(): void {
    if (!this._hasPoster) return;
    if (this.posterTexture) {
      if (this._sprite && this._sprite.texture === this.posterTexture) {
        this._removeSpriteFromTree();
      }
      // Release via TextureManager if server poster, otherwise destroy directly
      if (this._serverPosterLoaded && this.posterAssetKey && this.textures) {
        this.textures.release(this.posterAssetKey);
      } else {
        this.posterTexture.destroy(true);
      }
      this.posterTexture = null;
    }
    this._hasPoster = false;
    this._serverPosterLoaded = false;
    this._restorePlaceholder();
  }

  /** Full aggressive teardown: destroy video element + poster + all textures. */
  teardownFull(): void {
    if (this._isPlaying) this.pause();
    this.destroyPoster();
    this.teardownVideo();
  }

  // ---- Tier 3: Playback ---------------------------------------------------

  play(): void {
    if (this._isPlaying) return;

    if (!this._videoInitialized) this.initVideo();
    if (!this.videoEl) return;

    if (activeVideos.size >= MAX_PLAYING_VIDEOS) {
      const oldest = activeVideos.values().next().value as VideoSprite;
      oldest.pause();
    }

    this.videoEl.preload = 'auto';
    this.videoEl.muted = this.muted;
    this.videoEl.loop = this.loop;

    if (!this.videoTexture) {
      this.videoTexture = Texture.from(this.videoEl);
    }

    // Drop poster while playing — don't keep both resident
    if (this._hasPoster && this.posterTexture) {
      if (this._serverPosterLoaded && this.posterAssetKey && this.textures) {
        this.textures.release(this.posterAssetKey);
      } else {
        this.posterTexture.destroy(true);
      }
      this.posterTexture = null;
      this._hasPoster = false;
      this._serverPosterLoaded = false;
    }

    this._ensureSprite(this.videoTexture);
    this._removePlaceholder();

    this._isPlaying = true;
    this._overlay.visible = false;
    activeVideos.add(this);
    this.onStateChange?.();

    this.videoEl.play().catch(() => {
      this._isPlaying = false;
      this._overlay.visible = true;
      activeVideos.delete(this);
      this.onStateChange?.();
    });
  }

  pause(): void {
    if (!this._isPlaying) return;
    this.videoEl?.pause();
    this._isPlaying = false;
    this._overlay.visible = true;
    activeVideos.delete(this);
    this.onStateChange?.();
  }

  togglePlayPause(): void {
    if (this._isPlaying) this.pause(); else this.play();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.videoEl) this.videoEl.muted = this.muted;
    this.onStateChange?.();
  }

  seek(time: number): void {
    if (!this.videoEl) return;
    this.videoEl.currentTime = Math.max(0, Math.min(time, this.videoEl.duration || 0));
  }

  // ---- Visibility (called by culling system) ------------------------------

  onVisibilityChange(visible: boolean): void {
    if (!visible && this._isPlaying) {
      this.pause();
    }
  }

  // ---- Shadow / overlay ---------------------------------------------------

  liftShadow(): void { this._drawShadow(SHADOW_LIFT); }
  dropShadow(): void { this._drawShadow(SHADOW_REST); }

  private _drawShadow(cfg: { offsetX: number; offsetY: number; alpha: number }): void {
    this._shadow.clear();
    this._shadow.rect(cfg.offsetX, cfg.offsetY, this._naturalWidth, this._naturalHeight);
    this._shadow.fill({ color: 0x000000, alpha: cfg.alpha });
  }

  private _drawPlayIcon(): void {
    this._overlay.clear();
    const w = this._naturalWidth;
    const h = this._naturalHeight;
    const triSize = Math.min(w, h) * 0.2;
    const cx = w / 2;
    const cy = h / 2;

    this._overlay.circle(cx, cy, triSize * 0.8);
    this._overlay.fill({ color: 0x000000, alpha: 0.5 });

    this._overlay.poly([
      cx - triSize * 0.3, cy - triSize * 0.4,
      cx + triSize * 0.4, cy,
      cx - triSize * 0.3, cy + triSize * 0.4,
    ]);
    this._overlay.fill({ color: 0xffffff, alpha: 0.9 });
  }

  // ---- Media event handlers -----------------------------------------------

  private _onLoadedMetadata = (): void => {
    if (!this.videoEl || this.destroyed) return;
    const vw = this.videoEl.videoWidth;
    const vh = this.videoEl.videoHeight;
    if (vw > 0 && vh > 0 && (vw !== this._naturalWidth || vh !== this._naturalHeight)) {
      this._naturalWidth = vw;
      this._naturalHeight = vh;
      if (this._sprite) {
        this._sprite.width = vw;
        this._sprite.height = vh;
      }
      if (this._placeholder) {
        this._placeholder.clear();
        this._placeholder.rect(0, 0, vw, vh).fill(0x2a2a2a);
      }
      this._drawShadow(SHADOW_REST);
      this._drawPlayIcon();
      this.onDimensionsKnown?.(vw, vh);
    }
  };

  private _onLoadedData = (): void => {
    this._captureFirstFrame();
  };

  // ---- Internal helpers ---------------------------------------------------

  private _captureFirstFrame(): void {
    if (!this.videoEl || this.destroyed || this._hasPoster) return;
    const vw = this.videoEl.videoWidth;
    const vh = this.videoEl.videoHeight;
    if (vw <= 0 || vh <= 0) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(this.videoEl, 0, 0, vw, vh);
      this.posterTexture = Texture.from(canvas);
      this._hasPoster = true;

      this._ensureSprite(this.posterTexture);
      this._removePlaceholder();
    } catch {
      this._trySeekCapture();
    }
  }

  private _trySeekCapture(): void {
    if (!this.videoEl) return;
    const onSeeked = () => {
      if (!this.videoEl) return;
      this.videoEl.removeEventListener('seeked', onSeeked);
      if (this._hasPoster || this.destroyed) return;
      const vw = this.videoEl.videoWidth;
      const vh = this.videoEl.videoHeight;
      if (vw <= 0 || vh <= 0) return;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = vw;
        canvas.height = vh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(this.videoEl, 0, 0, vw, vh);
        this.posterTexture = Texture.from(canvas);
        this._hasPoster = true;

        this._ensureSprite(this.posterTexture);
        this._removePlaceholder();
      } catch {
        // Give up on poster
      }
    };

    this.videoEl.addEventListener('seeked', onSeeked);
    this.videoEl.currentTime = 0.1;
  }

  private _ensureSprite(texture: Texture): void {
    if (!this._sprite) {
      this._sprite = new Sprite(texture);
      this._sprite.width = this._naturalWidth;
      this._sprite.height = this._naturalHeight;
      this.addChildAt(this._sprite, 1);
    } else {
      this._sprite.texture = texture;
      this._sprite.width = this._naturalWidth;
      this._sprite.height = this._naturalHeight;
    }
  }

  private _removeSpriteFromTree(): void {
    if (this._sprite) {
      this.removeChild(this._sprite);
      this._sprite.destroy();
      this._sprite = null;
    }
  }

  private _removePlaceholder(): void {
    if (this._placeholder) {
      this.removeChild(this._placeholder);
      this._placeholder.destroy();
      this._placeholder = null;
    }
  }

  private _restorePlaceholder(): void {
    if (this._placeholder) return;
    const p = new Graphics();
    p.rect(0, 0, this._naturalWidth, this._naturalHeight).fill(0x2a2a2a);
    this._placeholder = p;
    this.addChildAt(p, 1);
  }

  private _destroyVideoEl(): void {
    if (!this.videoEl) return;
    this.videoEl.removeEventListener('loadedmetadata', this._onLoadedMetadata);
    this.videoEl.removeEventListener('loadeddata', this._onLoadedData);
    this.videoEl.pause();
    this.videoEl.src = '';
    this.videoEl.load();
    this.videoEl = null;
  }

  private _destroyVideoTexture(): void {
    if (this.videoTexture) {
      if (this._sprite && this._sprite.texture === this.videoTexture) {
        this._removeSpriteFromTree();
        this._restorePlaceholder();
      }
      this.videoTexture.destroy(true);
      this.videoTexture = null;
    }
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.pause();
    this._destroyVideoEl();
    if (this.videoTexture) { this.videoTexture.destroy(true); this.videoTexture = null; }
    if (this._hasPoster && this.posterTexture) {
      if (this._serverPosterLoaded && this.posterAssetKey && this.textures) {
        this.textures.release(this.posterAssetKey);
      } else {
        this.posterTexture.destroy(true);
      }
      this.posterTexture = null;
    }
    super.destroy(options);
  }
}
