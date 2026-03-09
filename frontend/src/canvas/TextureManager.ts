import { Texture, Assets } from "pixi.js";

interface TextureEntry {
  texture: Texture;
  lastUsed: number;
  memoryEstimate: number;
}

/**
 * TextureManager — GPU texture cache with LRU eviction and memory budget.
 * No LOD tiers — PixiJS GPU handles scaling natively.
 * Just loads the full-res image and caches it.
 */
export class TextureManager {
  private cache = new Map<string, TextureEntry>();
  private budget = 512 * 1024 * 1024; // 512 MB
  private currentUsage = 0;

  /** Build the URL for a given asset. */
  urlForAsset(assetKey: string): string {
    if (assetKey.startsWith('http') || assetKey.startsWith('/api/')) {
      return assetKey;
    }
    return `/api/images/${assetKey}`;
  }

  /**
   * Load a texture for the given asset.
   * Returns cached texture if available, otherwise fetches and caches.
   * GPU handles all scaling — no LOD tiers needed.
   */
  async load(assetKey: string): Promise<Texture> {
    const existing = this.cache.get(assetKey);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing.texture;
    }

    const url = this.urlForAsset(assetKey);
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

    this.cache.set(assetKey, {
      texture,
      lastUsed: performance.now(),
      memoryEstimate,
    });

    while (this.currentUsage > this.budget && this.cache.size > 1) {
      this.evictLRU();
    }

    return texture;
  }

  /** Remove a specific texture from the cache and destroy it. */
  unload(assetKey: string): void {
    const entry = this.cache.get(assetKey);
    if (!entry) return;

    this.currentUsage -= entry.memoryEstimate;
    entry.texture.destroy(true);
    this.cache.delete(assetKey);
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
