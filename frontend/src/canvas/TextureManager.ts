import { Texture, Assets } from "pixi.js";

interface TextureEntry {
  texture: Texture;
  url: string; // needed for Assets.unload()
}

/**
 * TextureManager — GPU texture cache.
 *
 * No internal LRU eviction — the viewport culling system (PixiCanvas)
 * manages loading/unloading based on proximity. This avoids destroying
 * textures that sprites still reference (which crashes PixiJS v8).
 */
export class TextureManager {
  private cache = new Map<string, TextureEntry>();

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
   */
  async load(assetKey: string): Promise<Texture> {
    const existing = this.cache.get(assetKey);
    if (existing) {
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

    this.cache.set(assetKey, { texture, url });
    return texture;
  }

  /** Remove a specific texture from the cache via Assets.unload(). */
  unload(assetKey: string): void {
    const entry = this.cache.get(assetKey);
    if (!entry) return;

    this.cache.delete(assetKey);
    try {
      Assets.unload(entry.url);
    } catch {
      // ignore — texture may already be gone
    }
  }

  /** Unload all cached textures. */
  clear(): void {
    for (const [key] of this.cache) {
      this.unload(key);
    }
    this.cache.clear();
  }
}
