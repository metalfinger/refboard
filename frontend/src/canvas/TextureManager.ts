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

  /** Build the URL for a given asset + tier. */
  urlForAsset(assetKey: string, tier: LODTier): string {
    return `/api/images/${assetKey}/${tier}.webp`;
  }

  /**
   * Load a texture for the given asset and LOD tier.
   * Returns a cached texture if available, otherwise fetches it,
   * estimates GPU memory, and evicts LRU entries if over budget.
   */
  async load(assetKey: string, tier: LODTier): Promise<Texture> {
    const key = `${assetKey}:${tier}`;

    const existing = this.cache.get(key);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing.texture;
    }

    const url = this.urlForAsset(assetKey, tier);
    const texture: Texture = await Assets.load(url);

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
