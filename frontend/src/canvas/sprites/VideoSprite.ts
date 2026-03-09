import { Container, Sprite, Texture, Graphics } from 'pixi.js';

/**
 * VideoSprite — Container holding shadow + video sprite + play overlay.
 *
 * Matches ImageSprite pattern: extends Container (not Sprite) so shadow
 * and overlay children don't affect bounds for transform box.
 * Does NOT auto-play. User clicks to play/pause.
 * Auto-corrects dimensions from video metadata if initial w/h were fallbacks.
 *
 * Key design:
 *  - preload='auto' so the browser fetches enough data for the first frame
 *  - On 'loadeddata' we briefly play+pause to force the first frame to decode,
 *    then capture it as a static canvas texture (poster). This avoids the
 *    "black box" problem where PixiJS video textures only render while playing.
 *  - When the user hits play, we swap to the live video texture.
 *  - On pause, we keep the live texture (shows last frame).
 */

const MAX_CONCURRENT_VIDEOS = 3;
const activeVideos: Set<VideoSprite> = new Set();

const SHADOW_REST = { offsetX: 3, offsetY: 3, alpha: 0.2 };
const SHADOW_LIFT = { offsetX: 6, offsetY: 8, alpha: 0.3 };

export class VideoSprite extends Container {
  readonly assetKey: string;
  private videoEl: HTMLVideoElement;
  private videoTexture: Texture | null = null;
  private posterTexture: Texture | null = null;
  private _sprite: Sprite;
  private _shadow: Graphics;
  private _overlay: Graphics;
  private _placeholder: Graphics | null = null;
  private _naturalWidth: number;
  private _naturalHeight: number;
  private _isPlaying = false;
  private _videoReady = false;
  muted = true;
  loop = true;

  /** Called when video metadata reveals the real dimensions. */
  onDimensionsKnown: ((w: number, h: number) => void) | null = null;

  constructor(assetKey: string, w: number, h: number, videoUrl: string) {
    super();

    this.assetKey = assetKey;
    this._naturalWidth = w;
    this._naturalHeight = h;

    // Shadow
    this._shadow = new Graphics();
    this._drawShadow(SHADOW_REST);
    this.addChild(this._shadow);

    // Main sprite (starts empty)
    this._sprite = new Sprite(Texture.EMPTY);
    this._sprite.width = w;
    this._sprite.height = h;
    this.addChild(this._sprite);

    // Dark placeholder with film icon
    this._placeholder = new Graphics();
    this._placeholder.rect(0, 0, w, h).fill(0x2a2a2a);
    this.addChild(this._placeholder);

    // Play/pause overlay
    this._overlay = new Graphics();
    this._drawPlayIcon();
    this.addChild(this._overlay);

    // Video element
    this.videoEl = document.createElement('video');
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.muted = true;
    this.videoEl.loop = true;
    this.videoEl.playsInline = true;
    this.videoEl.preload = 'auto'; // load enough for first frame

    // Auto-correct dimensions from video metadata
    this.videoEl.addEventListener('loadedmetadata', () => {
      const vw = this.videoEl.videoWidth;
      const vh = this.videoEl.videoHeight;
      if (vw > 0 && vh > 0) {
        // Cap to 600px max dimension, preserving aspect ratio
        const maxDim = 600;
        let fw = vw, fh = vh;
        if (vw > maxDim || vh > maxDim) {
          const s = maxDim / Math.max(vw, vh);
          fw = Math.round(vw * s);
          fh = Math.round(vh * s);
        }
        if (fw !== this._naturalWidth || fh !== this._naturalHeight) {
          this._naturalWidth = fw;
          this._naturalHeight = fh;
          this._sprite.width = fw;
          this._sprite.height = fh;
          // Update placeholder size too
          if (this._placeholder) {
            this._placeholder.clear();
            this._placeholder.rect(0, 0, fw, fh).fill(0x2a2a2a);
          }
          this._drawShadow(SHADOW_REST);
          this._drawPlayIcon();
          this.onDimensionsKnown?.(fw, fh);
        }
      }
    }, { once: true });

    // When first frame data is available, capture a poster
    this.videoEl.addEventListener('loadeddata', () => {
      this._captureFirstFrame();
    }, { once: true });

    // Set src last to start loading
    this.videoEl.src = videoUrl;
  }

  /**
   * Capture the first frame as a static canvas texture.
   * This ensures the video shows content even when paused/not-yet-played.
   */
  private _captureFirstFrame(): void {
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
      this._sprite.texture = this.posterTexture;
      this._sprite.width = this._naturalWidth;
      this._sprite.height = this._naturalHeight;
      this._videoReady = true;

      // Remove placeholder
      if (this._placeholder) {
        this.removeChild(this._placeholder);
        this._placeholder.destroy();
        this._placeholder = null;
      }
    } catch (err) {
      // Cross-origin or other issue — try the seeked approach
      this._trySeekCapture();
    }
  }

  /**
   * Fallback: seek to 0.1s and capture on 'seeked' event.
   * Some browsers need a seek to decode the first frame.
   */
  private _trySeekCapture(): void {
    const onSeeked = () => {
      this.videoEl.removeEventListener('seeked', onSeeked);
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
        this._sprite.texture = this.posterTexture;
        this._sprite.width = this._naturalWidth;
        this._sprite.height = this._naturalHeight;
        this._videoReady = true;

        if (this._placeholder) {
          this.removeChild(this._placeholder);
          this._placeholder.destroy();
          this._placeholder = null;
        }
      } catch {
        // Give up on poster — user will see placeholder until play
      }
    };

    this.videoEl.addEventListener('seeked', onSeeked);
    this.videoEl.currentTime = 0.1;
  }

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

    // Semi-transparent circle
    this._overlay.circle(cx, cy, triSize * 0.8);
    this._overlay.fill({ color: 0x000000, alpha: 0.5 });

    // Play triangle
    this._overlay.poly([
      cx - triSize * 0.3, cy - triSize * 0.4,
      cx + triSize * 0.4, cy,
      cx - triSize * 0.3, cy + triSize * 0.4,
    ]);
    this._overlay.fill({ color: 0xffffff, alpha: 0.9 });
  }

  liftShadow(): void {
    this._drawShadow(SHADOW_LIFT);
  }

  dropShadow(): void {
    this._drawShadow(SHADOW_REST);
  }

  play(): void {
    if (this._isPlaying) return;

    // Evict oldest if at capacity
    if (activeVideos.size >= MAX_CONCURRENT_VIDEOS) {
      const oldest = activeVideos.values().next().value as VideoSprite;
      oldest.pause();
    }

    this.videoEl.muted = this.muted;

    // Create live video texture for playback
    if (!this.videoTexture) {
      this.videoTexture = Texture.from(this.videoEl);
    }
    this._sprite.texture = this.videoTexture;
    this._sprite.width = this._naturalWidth;
    this._sprite.height = this._naturalHeight;

    this.videoEl.play().catch(() => {
      // Autoplay blocked — revert to poster
      if (this.posterTexture) {
        this._sprite.texture = this.posterTexture;
      }
      this._overlay.visible = true;
    });
    this._isPlaying = true;
    this._overlay.visible = false;
    activeVideos.add(this);
  }

  pause(): void {
    if (!this._isPlaying) return;
    this.videoEl.pause();
    this._isPlaying = false;
    this._overlay.visible = true;
    activeVideos.delete(this);
    // Keep the video texture showing (last frame) — don't revert to poster
  }

  togglePlayPause(): void {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.videoEl.muted = this.muted;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Expose the underlying HTMLVideoElement for external controls. */
  get videoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  /** Seek to a specific time (in seconds). */
  seek(time: number): void {
    this.videoEl.currentTime = Math.max(0, Math.min(time, this.videoEl.duration || 0));
  }

  onVisibilityChange(visible: boolean): void {
    if (!visible && this._isPlaying) {
      this.pause();
    }
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.pause();
    this.videoEl.src = '';
    this.videoEl.load();
    if (this.videoTexture) {
      this.videoTexture.destroy(true);
      this.videoTexture = null;
    }
    if (this.posterTexture) {
      this.posterTexture.destroy(true);
      this.posterTexture = null;
    }
    super.destroy(options);
  }
}
