import { Texture, Assets } from "pixi.js";

interface TextureEntry {
  texture: Texture;
  url: string;
  refCount: number;
}

/**
 * TextureManager — GPU texture cache with reference counting.
 *
 * Multiple ImageSprites can share the same assetKey (duplicated images).
 * Assets.unload() destroys the shared texture source, so we must only
 * call it when the LAST reference is released. Otherwise PixiJS v8
 * crashes with null source errors (alphaMode, addressModeU).
 *
 * The viewport culling system (PixiCanvas) calls load/release to
 * manage which textures consume GPU memory.
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
   * Load a texture for the given asset. Increments ref count.
   * Returns cached texture if available, otherwise fetches and caches.
   */
  async load(assetKey: string): Promise<Texture> {
    const existing = this.cache.get(assetKey);
    if (existing) {
      existing.refCount++;
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

    this.cache.set(assetKey, { texture, url, refCount: 1 });
    return texture;
  }

  /**
   * Release a reference to a texture. Only actually unloads from GPU
   * when the last reference is released.
   */
  release(assetKey: string): void {
    const entry = this.cache.get(assetKey);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount > 0) return; // other sprites still using it

    this.cache.delete(assetKey);
    try {
      Assets.unload(entry.url);
    } catch {
      // ignore — texture may already be gone
    }
  }

  /** Force unload (used by clear). */
  unload(assetKey: string): void {
    const entry = this.cache.get(assetKey);
    if (!entry) return;
    this.cache.delete(assetKey);
    try {
      Assets.unload(entry.url);
    } catch {
      // ignore
    }
  }

  /** Unload all cached textures. */
  clear(): void {
    for (const [, entry] of this.cache) {
      try { Assets.unload(entry.url); } catch { /* ignore */ }
    }
    this.cache.clear();
  }
}
