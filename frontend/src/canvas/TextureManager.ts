import { Texture, Assets } from "pixi.js";

export type LODTier = "thumb" | "medium" | "full";

interface TextureEntry {
  texture: Texture;
  tier: LODTier;
  lastUsed: number;
  memoryEstimate: number;
}

export class TextureManager {
  private cache = new Map<string, TextureEntry>();
  private budget = 512 * 1024 * 1024; // 512 MB
  private currentUsage = 0;

  /** Map zoom level to the appropriate LOD tier. */
  tierForZoom(zoom: number): LODTier {
    if (zoom < 0.3) return "thumb";
    if (zoom > 1.5) return "full";
    return "medium";
  }

  /**
   * Detect whether an asset key is a new LOD-format key (no extension)
   * or an old pre-migration path (has file extension).
   */
  private _isLegacyAsset(assetKey: string): boolean {
    // New LOD keys look like: boards/{boardId}/{imageId} (no extension)
    // Old keys look like: boards/{boardId}/{imageId}.png or full URLs
    return /\.\w{2,5}$/.test(assetKey) || assetKey.startsWith('http') || assetKey.startsWith('/api/');
  }

  /** Build the URL for a given asset + tier. */
  urlForAsset(assetKey: string, tier: LODTier): string {
    if (this._isLegacyAsset(assetKey)) {
      // Legacy: load original file directly (GPU handles scaling)
      if (assetKey.startsWith('http') || assetKey.startsWith('/api/')) {
        return assetKey;
      }
      return `/api/images/${assetKey}`;
    }
    // New LOD format: boards/{boardId}/{imageId}/thumb.webp
    return `/api/images/${assetKey}/${tier}.webp`;
  }

  /**
   * Load a texture for the given asset and LOD tier.
   * For legacy assets (pre-migration), loads the original file directly —
   * the GPU handles downscaling naturally.
   * For new assets, loads the appropriate LOD tier with fallback.
   */
  async load(assetKey: string, tier: LODTier): Promise<Texture> {
    // For legacy assets, all tiers resolve to the same URL
    const effectiveTier = this._isLegacyAsset(assetKey) ? 'full' : tier;
    const key = `${assetKey}:${effectiveTier}`;

    const existing = this.cache.get(key);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing.texture;
    }

    const url = this.urlForAsset(assetKey, effectiveTier);
    let texture: Texture;
    try {
      texture = await Assets.load(url);
    } catch {
      console.warn(`[TextureManager] Failed to load ${url}`);
      return Texture.EMPTY;
    }

    const w = texture.source.width ?? 256;
    const h = texture.source.height ?? 256;
    const memoryEstimate = w * h * 4; // RGBA

    this.currentUsage += memoryEstimate;

    this.cache.set(key, {
      texture,
      tier,
      lastUsed: performance.now(),
      memoryEstimate,
    });

    while (this.currentUsage > this.budget && this.cache.size > 1) {
      this.evictLRU();
    }

    return texture;
  }

  /** Remove a specific texture from the cache and destroy it. */
  unload(assetKey: string, tier: LODTier): void {
    const key = `${assetKey}:${tier}`;
    const entry = this.cache.get(key);
    if (!entry) return;

    this.currentUsage -= entry.memoryEstimate;
    entry.texture.destroy(true);
    this.cache.delete(key);
  }

  /** Evict the least-recently-used cache entry. */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.currentUsage -= entry.memoryEstimate;
      entry.texture.destroy(true);
      this.cache.delete(oldestKey);
    }
  }

  /** Destroy all cached textures and reset memory tracking. */
  clear(): void {
    for (const entry of this.cache.values()) {
      entry.texture.destroy(true);
    }
    this.cache.clear();
    this.currentUsage = 0;
  }
}
