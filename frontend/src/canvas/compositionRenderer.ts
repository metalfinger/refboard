/**
 * Composition Renderer — unified data-driven export/clipboard pipeline.
 *
 * Renders scene items from canonical scene data into an offscreen canvas,
 * independent of live PixiJS display state or viewport zoom. Image-only
 * selections produce native-resolution output; mixed selections fall back
 * to the snapshot renderer with an explicit warning.
 */

import type { Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import type { AnySceneObject, GroupObject, ImageObject } from './scene-format';
import {
  getImageDisplayTransform,
  getImageSourceRect,
} from './imageTransforms';
import { renderCanvasSnapshot } from './snapshotRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompositionMode = 'clipboard' | 'export';

export interface CompositionOptions {
  mode: CompositionMode;
  scale: number;
  background: string | null;
  paddingPx: number;
  fallbackToSnapshot: boolean;
}

export interface CompositionResult {
  canvas: HTMLCanvasElement;
  native: boolean;
  warnings: string[];
}

export interface ExportEntry {
  id: string;
  type: AnySceneObject['type'];
  z: number;
  worldBounds: { x: number; y: number; w: number; h: number };
  data: AnySceneObject;
  /** True if this entry is a child of a group (data stores local coords). */
  isGroupChild: boolean;
}

/** Per-type drawing interface for the composition pipeline. */
export interface ItemComposer {
  supportsNative(item: ExportEntry): boolean;
  draw(
    ctx: CanvasRenderingContext2D,
    item: ExportEntry,
    env: DrawEnv,
  ): Promise<void>;
}

export interface DrawEnv {
  pixelsPerWorld: number;
  offsetPxX: number;
  offsetPxY: number;
  /** Pre-loaded images keyed by entry ID. */
  imageMap: Map<string, HTMLImageElement>;
}

// ---------------------------------------------------------------------------
// Canvas safety limits
// ---------------------------------------------------------------------------

const MAX_EXPORT_WIDTH = 16384;
const MAX_EXPORT_HEIGHT = 16384;
const MAX_TOTAL_PIXELS = 16384 * 16384; // ~268 million — well within modern browser limits

// ---------------------------------------------------------------------------
// Image loading cache
// ---------------------------------------------------------------------------

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function assetUrlForExport(assetKey: string): string {
  if (assetKey.startsWith('http') || assetKey.startsWith('/api/')) {
    return assetKey;
  }
  return `/api/images/${assetKey}`;
}

async function loadImageForExport(assetKey: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(assetKey);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      try {
        if ('decode' in img) await img.decode();
      } catch {
        // ignore decode timing issues; onload already fired
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load image asset: ${assetKey}`));
    img.src = assetUrlForExport(assetKey);
  });

  imageCache.set(assetKey, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Export entry flattening
// ---------------------------------------------------------------------------

/**
 * Convert selected SceneItems into flat ExportEntry list with final
 * world-space transforms. Groups are resolved: their children are included
 * individually at their computed world positions.
 *
 * @param itemResolver - optional function to look up SceneItems by ID
 *   (needed to resolve group children that aren't directly in the selection)
 */
export function flattenToExportEntries(
  items: SceneItem[],
  itemResolver?: (id: string) => SceneItem | undefined,
): ExportEntry[] {
  const entries: ExportEntry[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    if (item.type === 'group') {
      // Resolve group children into individual export entries.
      // Children store local coords relative to the group parent, but
      // getItemWorldBounds already accounts for parent transforms.
      const groupData = item.data as GroupObject;
      if (itemResolver) {
        for (const childId of groupData.children) {
          if (seen.has(childId)) continue;
          seen.add(childId);
          const child = itemResolver(childId);
          if (!child) continue;
          entries.push({
            id: child.id,
            type: child.data.type,
            z: child.data.z,
            worldBounds: getItemWorldBounds(child),
            data: child.data,
            isGroupChild: true,
          });
        }
      }
      continue;
    }

    entries.push({
      id: item.id,
      type: item.data.type,
      z: item.data.z,
      worldBounds: getItemWorldBounds(item),
      data: item.data,
      isGroupChild: false,
    });
  }

  entries.sort((a, b) => a.z - b.z);
  return entries;
}

// ---------------------------------------------------------------------------
// Image composer
// ---------------------------------------------------------------------------

const imageComposer: ItemComposer = {
  supportsNative(item: ExportEntry): boolean {
    // Group children store LOCAL coords relative to group parent, so we can't
    // draw them with getImageDisplayTransform (which reads data.x/y directly).
    // Fall back to snapshot for selections containing group children.
    return item.type === 'image' && !item.isGroupChild;
  },

  async draw(ctx: CanvasRenderingContext2D, item: ExportEntry, env: DrawEnv): Promise<void> {
    const data = item.data as ImageObject;
    const img = env.imageMap.get(item.id) ?? await loadImageForExport(data.asset);
    const t = getImageDisplayTransform(data);

    // data.w/h may be capped display dimensions (e.g., 600px max for a 1920px
    // source). Map the normalized crop rect through the real source pixel
    // dimensions so we sample the full asset, not just the top-left corner.
    const natW = img.naturalWidth || data.w;
    const natH = img.naturalHeight || data.h;
    const crop = data.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const srcX = crop.x * natW;
    const srcY = crop.y * natH;
    const srcW = crop.w * natW;
    const srcH = crop.h * natH;

    ctx.save();
    ctx.translate(
      t.x * env.pixelsPerWorld - env.offsetPxX,
      t.y * env.pixelsPerWorld - env.offsetPxY,
    );
    ctx.rotate((t.angle * Math.PI) / 180);
    // The display transform scale (t.scaleX) places the image in world space
    // using data.w-based local dimensions. ppw converts world→export pixels.
    // We draw the full native source (srcW×srcH) and scale it to fit the same
    // world-space footprint: world_w = visibleLocal.w * |sx|, so export_w =
    // world_w * ppw. That means we scale the native source by:
    //   (visibleLocal.w * |sx| * ppw) / srcW = (data.w * crop.w * sx * ppw) / (natW * crop.w)
    //   = data.w * sx * ppw / natW
    const flipX = data.flipX ? -1 : 1;
    const flipY = data.flipY ? -1 : 1;
    const drawScaleX = (data.w * Math.abs(data.sx) * env.pixelsPerWorld / natW) * flipX;
    const drawScaleY = (data.h * Math.abs(data.sy) * env.pixelsPerWorld / natH) * flipY;
    ctx.scale(drawScaleX, drawScaleY);
    ctx.drawImage(
      img,
      srcX, srcY, srcW, srcH,
      0, 0, srcW, srcH,
    );
    ctx.restore();
  },
};

// ---------------------------------------------------------------------------
// Composer registry
// ---------------------------------------------------------------------------

const composerRegistry: ItemComposer[] = [imageComposer];

function findComposer(entry: ExportEntry): ItemComposer | undefined {
  return composerRegistry.find((c) => c.supportsNative(entry));
}

// ---------------------------------------------------------------------------
// Resolution policy
// ---------------------------------------------------------------------------

/**
 * Sync ppw estimate using data.w/h (for preview dimensions only).
 * May underestimate for images with capped display dimensions.
 */
function estimatePixelsPerWorldSync(entries: ExportEntry[], scale: number): number {
  let ppw = 1;
  for (const entry of entries) {
    if (entry.type !== 'image') continue;
    const data = entry.data as ImageObject;
    const pxPerWorldX = data.sx !== 0 ? 1 / Math.abs(data.sx) : 1;
    const pxPerWorldY = data.sy !== 0 ? 1 / Math.abs(data.sy) : 1;
    ppw = Math.max(ppw, pxPerWorldX, pxPerWorldY);
  }
  return Math.min(ppw * scale, 16);
}

/**
 * Compute native pixels-per-world-unit from loaded images.
 *
 * data.w/h can be capped display dimensions (e.g., 600px max), not the actual
 * source resolution. We use the loaded image's naturalWidth/Height to compute
 * the true native resolution per world unit.
 */
async function computePixelsPerWorld(
  entries: ExportEntry[],
  scale: number,
): Promise<{ ppw: number; imageMap: Map<string, HTMLImageElement> }> {
  let ppw = 1;
  const imageMap = new Map<string, HTMLImageElement>();

  for (const entry of entries) {
    if (entry.type !== 'image') continue;
    const data = entry.data as ImageObject;
    const img = await loadImageForExport(data.asset);
    imageMap.set(entry.id, img);

    // True source pixels per world unit: natW / (data.w * sx) for the visible region
    const natW = img.naturalWidth || data.w;
    const natH = img.naturalHeight || data.h;
    const pxPerWorldX = data.sx !== 0 ? natW / (data.w * Math.abs(data.sx)) : 1;
    const pxPerWorldY = data.sy !== 0 ? natH / (data.h * Math.abs(data.sy)) : 1;
    ppw = Math.max(ppw, pxPerWorldX, pxPerWorldY);
  }

  return { ppw: Math.min(ppw * scale, 16), imageMap };
}

/**
 * Ensure export dimensions fit within browser canvas limits.
 * Returns adjusted pixelsPerWorld and any warning message.
 */
function clampToCanvasLimits(
  ppw: number,
  worldW: number,
  worldH: number,
  paddingPx: number,
): { pixelsPerWorld: number; warning: string | null } {
  let w = Math.ceil(worldW * ppw) + paddingPx * 2;
  let h = Math.ceil(worldH * ppw) + paddingPx * 2;

  if (w <= MAX_EXPORT_WIDTH && h <= MAX_EXPORT_HEIGHT && w * h <= MAX_TOTAL_PIXELS) {
    return { pixelsPerWorld: ppw, warning: null };
  }

  // Scale down to fit
  const scaleW = w > MAX_EXPORT_WIDTH ? (MAX_EXPORT_WIDTH - paddingPx * 2) / (worldW * ppw) * ppw : ppw;
  const scaleH = h > MAX_EXPORT_HEIGHT ? (MAX_EXPORT_HEIGHT - paddingPx * 2) / (worldH * ppw) * ppw : ppw;
  let newPpw = Math.min(scaleW, scaleH);

  // Check total pixel budget
  w = Math.ceil(worldW * newPpw) + paddingPx * 2;
  h = Math.ceil(worldH * newPpw) + paddingPx * 2;
  if (w * h > MAX_TOTAL_PIXELS) {
    const totalScale = Math.sqrt(MAX_TOTAL_PIXELS / (w * h));
    newPpw = newPpw * totalScale;
  }

  return {
    pixelsPerWorld: newPpw,
    warning: 'Reduced resolution to fit browser limits',
  };
}

// ---------------------------------------------------------------------------
// Main composition entry point
// ---------------------------------------------------------------------------

/**
 * Compose selected scene items into an offscreen canvas.
 *
 * Image-only selections produce native-resolution output from canonical scene
 * data. Mixed selections fall back to the viewport snapshot renderer if
 * `options.fallbackToSnapshot` is true, otherwise throw.
 */
export async function composeSelection(
  items: SceneItem[],
  options: CompositionOptions,
  fallbackDeps?: { app: Application; viewport: Viewport },
  itemResolver?: (id: string) => SceneItem | undefined,
): Promise<CompositionResult> {
  if (items.length === 0) {
    throw new Error('No items to compose');
  }

  const entries = flattenToExportEntries(items, itemResolver);
  const warnings: string[] = [];

  // If flattening produced no entries (e.g. group with no resolver), fall back
  if (entries.length === 0) {
    if (options.fallbackToSnapshot && fallbackDeps) {
      const canvas = renderCanvasSnapshot(
        fallbackDeps.app,
        fallbackDeps.viewport,
        items,
        { background: options.background, paddingPx: options.paddingPx },
      );
      warnings.push('Copied using viewport-resolution fallback');
      return { canvas, native: false, warnings };
    }
    throw new Error('No exportable items found');
  }

  // Check if all entries have native composers
  const allNative = entries.every((e) => findComposer(e) !== undefined);

  if (!allNative) {
    if (options.fallbackToSnapshot && fallbackDeps) {
      const canvas = renderCanvasSnapshot(
        fallbackDeps.app,
        fallbackDeps.viewport,
        items,
        { background: options.background, paddingPx: options.paddingPx },
      );
      warnings.push('Copied using viewport-resolution fallback');
      return { canvas, native: false, warnings };
    }
    throw new Error('Native composition unavailable for this selection and fallback disabled');
  }

  // Compute world bounds of all entries
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    const b = entry.worldBounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  const worldW = maxX - minX;
  const worldH = maxY - minY;

  // Compute resolution — loads images to determine true native pixels
  const { ppw: rawPpw, imageMap } = await computePixelsPerWorld(entries, options.scale);
  const clamped = clampToCanvasLimits(rawPpw, worldW, worldH, options.paddingPx);
  let ppw = clamped.pixelsPerWorld;
  if (clamped.warning) warnings.push(clamped.warning);

  const offsetPxX = Math.floor(minX * ppw) - options.paddingPx;
  const offsetPxY = Math.floor(minY * ppw) - options.paddingPx;
  const canvasW = Math.max(1, Math.ceil(maxX * ppw) + options.paddingPx - offsetPxX);
  const canvasH = Math.max(1, Math.ceil(maxY * ppw) + options.paddingPx - offsetPxY);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.clearRect(0, 0, canvasW, canvasH);
  }

  const env: DrawEnv = { pixelsPerWorld: ppw, offsetPxX, offsetPxY, imageMap };

  for (const entry of entries) {
    const composer = findComposer(entry);
    if (!composer) continue; // should not happen — checked above
    await composer.draw(ctx, entry, env);
  }

  return { canvas, native: true, warnings };
}

// ---------------------------------------------------------------------------
// Dimension preview (for export dialog)
// ---------------------------------------------------------------------------

export function getCompositionDimensions(
  items: SceneItem[],
  scale: number,
  paddingPx: number,
  itemResolver?: (id: string) => SceneItem | undefined,
): { width: number; height: number; native: boolean } {
  if (items.length === 0) return { width: 0, height: 0, native: false };

  const entries = flattenToExportEntries(items, itemResolver);
  if (entries.length === 0) return { width: 0, height: 0, native: false };
  const allNative = entries.every((e) => findComposer(e) !== undefined);

  if (!allNative) {
    // Fallback dimensions — world-space bounds at 1:1
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const entry of entries) {
      const b = entry.worldBounds;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = paddingPx;
    return {
      width: Math.max(1, Math.round(maxX - minX) + pad * 2),
      height: Math.max(1, Math.round(maxY - minY) + pad * 2),
      native: false,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    const b = entry.worldBounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  const worldW = maxX - minX;
  const worldH = maxY - minY;
  // Sync ppw estimate for preview — uses data.w/h (may underestimate for
  // capped images, but actual composition uses loaded naturalWidth/Height).
  let ppw = estimatePixelsPerWorldSync(entries, scale);
  const clamped = clampToCanvasLimits(ppw, worldW, worldH, paddingPx);
  ppw = clamped.pixelsPerWorld;

  const offsetPxX = Math.floor(minX * ppw) - paddingPx;
  const offsetPxY = Math.floor(minY * ppw) - paddingPx;

  return {
    width: Math.max(1, Math.ceil(maxX * ppw) + paddingPx - offsetPxX),
    height: Math.max(1, Math.ceil(maxY * ppw) + paddingPx - offsetPxY),
    native: true,
  };
}
