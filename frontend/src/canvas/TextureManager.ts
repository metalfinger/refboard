import { Texture, Assets } from "pixi.js";

// Max texture dimension — avoids WebGL INVALID_VALUE on large images.
// Most GPUs support 4096 or 8192; we cap at 2048 for memory efficiency
// since display sizes are typically 300-600px anyway.
const MAX_TEXTURE_DIM = 2048;

interface TextureEntry {
  texture: Texture;
  url: string; // needed for Assets.unload()
  lastUsed: number;
  memoryEstimate: number;
}

/**
 * TextureManager — GPU texture cache with LRU eviction and memory budget.
 * Caps texture dimensions at MAX_TEXTURE_DIM to prevent WebGL OOM.
 * Uses Assets.unload() instead of texture.destroy() for proper cleanup.
 */
export class TextureManager {
  private cache = new Map<string, TextureEntry>();
  private budget = 256 * 1024 * 1024; // 256 MB (conservative for 90+ items)
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
   * Large images are downscaled server-side via width param to stay within GPU limits.
   */
  async load(assetKey: string): Promise<Texture> {
    const existing = this.cache.get(assetKey);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing.texture;
    }

    // Request capped size from server to avoid loading huge textures into GPU
    let url = this.urlForAsset(assetKey);
    if (!url.includes('?')) {
      url += `?w=${MAX_TEXTURE_DIM}`;
    }

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
      url,
      lastUsed: performance.now(),
      memoryEstimate,
    });

    while (this.currentUsage > this.budget && this.cache.size > 1) {
      this.evictLRU();
    }

    return texture;
  }

  /** Remove a specific texture from the cache via Assets.unload(). */
  unload(assetKey: string): void {
    const entry = this.cache.get(assetKey);
    if (!entry) return;

    this.currentUsage -= entry.memoryEstimate;
    try {
      Assets.unload(entry.url);
    } catch {
      // Fallback if Assets doesn't know about it
      entry.texture.destroy(true);
    }
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
      this.unload(oldestKey);
    }
  }

  /** Unload all cached textures and reset memory tracking. */
  clear(): void {
    for (const [key] of this.cache) {
      this.unload(key);
    }
    this.cache.clear();
    this.currentUsage = 0;
  }
}
