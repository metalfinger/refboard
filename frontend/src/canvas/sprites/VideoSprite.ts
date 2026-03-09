import { Sprite, Texture, Graphics } from 'pixi.js';

const MAX_CONCURRENT_VIDEOS = 3;
const activeVideos: Set<VideoSprite> = new Set();

export class VideoSprite extends Sprite {
  readonly assetKey: string;
  private videoEl: HTMLVideoElement;
  private videoTexture: Texture | null = null;
  private playIcon: Graphics;
  private _isPlaying: boolean = false;
  muted: boolean = true;
  loop: boolean = true;

  constructor(assetKey: string, w: number, h: number, url: string) {
    super(Texture.EMPTY);
    this.assetKey = assetKey;
    this.width = w;
    this.height = h;

    // Create hidden video element
    this.videoEl = document.createElement('video');
    this.videoEl.src = url;
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.muted = true;
    this.videoEl.loop = true;
    this.videoEl.playsInline = true;
    this.videoEl.preload = 'metadata';

    // Dark background
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill(0x1a1a1a);
    this.addChildAt(bg, 0);

    // Play icon — white triangle centered in the sprite
    this.playIcon = new Graphics();
    const triSize = Math.min(w, h) * 0.25;
    const cx = w / 2;
    const cy = h / 2;
    this.playIcon
      .poly([
        cx - triSize * 0.4, cy - triSize * 0.5,
        cx + triSize * 0.5, cy,
        cx - triSize * 0.4, cy + triSize * 0.5,
      ])
      .fill({ color: 0xffffff, alpha: 0.7 });
    this.addChild(this.playIcon);

    // Interaction
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      this.muted = !this.muted;
      this.videoEl.muted = this.muted;
    });

    // When video metadata/frame is ready, create texture
    this.videoEl.addEventListener(
      'loadeddata',
      () => {
        this.videoTexture = Texture.from(this.videoEl);
        this.texture = this.videoTexture;
        this.width = w;
        this.height = h;
      },
      { once: true },
    );
  }

  play(): void {
    if (this._isPlaying) return;

    // Evict oldest if at capacity
    if (activeVideos.size >= MAX_CONCURRENT_VIDEOS) {
      const oldest = activeVideos.values().next().value as VideoSprite;
      oldest.pause();
    }

    this.videoEl.play();
    this._isPlaying = true;
    this.playIcon.visible = false;
    activeVideos.add(this);
  }

  pause(): void {
    if (!this._isPlaying) return;

    this.videoEl.pause();
    this._isPlaying = false;
    this.playIcon.visible = true;
    activeVideos.delete(this);
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  onVisibilityChange(visible: boolean): void {
    if (visible && !this._isPlaying) {
      this.play();
    } else if (!visible && this._isPlaying) {
      this.pause();
    }
  }

  destroy(options?: Parameters<Sprite['destroy']>[0]): void {
    this.pause();
    this.videoEl.src = '';
    this.videoEl.load(); // release network resources
    if (this.videoTexture) {
      this.videoTexture.destroy(true);
      this.videoTexture = null;
    }
    super.destroy(options);
  }
}
