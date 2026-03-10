import { Container, Sprite, Texture, Graphics } from 'pixi.js';

/**
 * VideoSprite — Container with budget-aware lazy video lifecycle.
 *
 * Memory tiers (managed by external culling system):
 *   Tier 0 — placeholder only (offscreen, default state)
 *   Tier 1 — initialized <video> with preload='metadata' (near viewport)
 *   Tier 2 — poster texture captured (nearest subset / selected)
 *   Tier 3 — actively playing with live video texture (user-initiated)
 *
 * The culling system in PixiCanvas manages budgets:
 *   - MAX_INITIALIZED_VIDEOS (tier 1+)
 *   - MAX_POSTER_VIDEOS (tier 2+)
 *   - MAX_PLAYING_VIDEOS (tier 3)
 *
 * Constructor creates only shadow + placeholder + overlay. No <video> element.
 */

const MAX_PLAYING_VIDEOS = 1;
const activeVideos: Set<VideoSprite> = new Set();

const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class VideoSprite extends Container {
  readonly assetKey: string;
  readonly videoUrl: string;

  private videoEl: HTMLVideoElement | null = null;
  private videoTexture: Texture | null = null;
  private posterTexture: Texture | null = null;
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

  constructor(assetKey: string, w: number, h: number, videoUrl: string) {
    super();

    this.assetKey = assetKey;
    this.videoUrl = videoUrl;
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
  }

  get isPlaying(): boolean { return this._isPlaying; }
  get isInitialized(): boolean { return this._videoInitialized; }
  get hasPoster(): boolean { return this._hasPoster; }

  /** Expose the underlying HTMLVideoElement for external controls. Null if not initialized. */
  get videoElement(): HTMLVideoElement | null { return this.videoEl; }

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
    this.onStateChange?.(); // notify controls of new element
  }

  /** Tear down the <video> element. Keeps poster if present. */
  teardownVideo(): void {
    if (!this._videoInitialized) return;
    if (this._isPlaying) return; // don't tear down while user is watching

    this._destroyVideoEl();
    this._destroyVideoTexture();
    this._videoInitialized = false;
    this.onStateChange?.(); // notify controls element is gone
  }

  // ---- Tier 2: Poster texture ---------------------------------------------

  /** Capture a poster frame. Requires initialized video. */
  capturePoster(): void {
    if (this._hasPoster || !this.videoEl || this.destroyed) return;

    if (this.videoEl.readyState >= 2) {
      // Frame data already available — capture directly
      this._captureFirstFrame();
    } else if (this.videoEl.readyState >= 1) {
      // Metadata loaded but no frame decoded (preload='metadata').
      // Force a seek to trigger frame decode, capture on 'seeked'.
      this._trySeekCapture();
    } else {
      // Not even metadata yet — wait for loadeddata
      this.videoEl.addEventListener('loadeddata', this._onLoadedData, { once: true });
    }
  }

  /** Destroy the poster texture to free GPU memory. */
  destroyPoster(): void {
    if (!this._hasPoster) return;
    if (this.posterTexture) {
      // If sprite is showing poster, switch back to nothing
      if (this._sprite && this._sprite.texture === this.posterTexture) {
        this._removeSpriteFromTree();
      }
      this.posterTexture.destroy(true);
      this.posterTexture = null;
    }
    this._hasPoster = false;
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

    // Ensure video element exists
    if (!this._videoInitialized) this.initVideo();
    if (!this.videoEl) return;

    // Evict oldest if at capacity
    if (activeVideos.size >= MAX_PLAYING_VIDEOS) {
      const oldest = activeVideos.values().next().value as VideoSprite;
      oldest.pause();
    }

    // Promote to full load for playback
    this.videoEl.preload = 'auto';
    this.videoEl.muted = this.muted;
    this.videoEl.loop = this.loop;

    // Create live video texture
    if (!this.videoTexture) {
      this.videoTexture = Texture.from(this.videoEl);
    }

    // Drop poster while playing — don't keep both resident
    if (this.posterTexture && this._hasPoster) {
      this.posterTexture.destroy(true);
      this.posterTexture = null;
      this._hasPoster = false;
    }

    this._ensureSprite(this.videoTexture);
    this._removePlaceholder();

    this._isPlaying = true;
    this._overlay.visible = false;
    activeVideos.add(this);
    this.onStateChange?.();

    this.videoEl.play().catch(() => {
      // Autoplay blocked — show placeholder
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
    // Keep video texture showing last frame
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

  /** Simple visibility callback — culling system manages budgets externally. */
  onVisibilityChange(visible: boolean): void {
    if (!visible && this._isPlaying) {
      this.pause();
    }
    // NOTE: init/teardown is now managed by the culling budget system,
    // not by individual visibility changes.
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

  // ---- Media event handlers (arrow fns for stable `this`) -----------------

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
      // Insert after shadow (index 0), before placeholder/overlay
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
    // Insert after shadow
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
      // If sprite is showing live texture, remove it
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
    if (this.posterTexture) { this.posterTexture.destroy(true); this.posterTexture = null; }
    super.destroy(options);
  }
}
