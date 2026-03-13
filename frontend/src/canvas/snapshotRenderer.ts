import type { Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import {
  getImageDisplayTransform,
  getImageSourceRect,
} from './imageTransforms';
import type { ImageObject } from './scene-format';

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

export function supportsNativeImageExport(items: SceneItem[]): boolean {
  return items.length > 0 && items.every((item) => item.type === 'image');
}

function getNativePixelsPerWorld(items: SceneItem[], scale = 1): number {
  let pixelsPerWorld = 1;
  for (const item of items) {
    if (item.type !== 'image') continue;
    const data = item.data as ImageObject;
    const pxPerWorldX = data.sx !== 0 ? 1 / Math.abs(data.sx) : 1;
    const pxPerWorldY = data.sy !== 0 ? 1 / Math.abs(data.sy) : 1;
    pixelsPerWorld = Math.max(pixelsPerWorld, pxPerWorldX, pxPerWorldY);
  }
  return Math.min(pixelsPerWorld * scale, 8);
}

export async function renderNativeImageSelection(
  items: SceneItem[],
  options?: { scale?: number; background?: string | null; paddingPx?: number },
): Promise<HTMLCanvasElement> {
  if (!supportsNativeImageExport(items)) {
    throw new Error('Native export currently supports image-only selections');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const bounds = getItemWorldBounds(item);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }

  const pixelsPerWorld = getNativePixelsPerWorld(items, options?.scale ?? 1);
  const paddingPx = options?.paddingPx ?? 10;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((maxX - minX) * pixelsPerWorld) + paddingPx * 2);
  canvas.height = Math.max(1, Math.ceil((maxY - minY) * pixelsPerWorld) + paddingPx * 2);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  if (options?.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const orderedItems = [...items].sort((a, b) => a.data.z - b.data.z);

  for (const item of orderedItems) {
    const data = item.data as ImageObject;
    const img = await loadImageForExport(data.asset);
    const src = getImageSourceRect(data);
    const t = getImageDisplayTransform(data);

    ctx.save();
    ctx.translate(
      Math.round((t.x - minX) * pixelsPerWorld) + paddingPx,
      Math.round((t.y - minY) * pixelsPerWorld) + paddingPx,
    );
    ctx.rotate((t.angle * Math.PI) / 180);
    ctx.scale(t.scaleX * pixelsPerWorld, t.scaleY * pixelsPerWorld);
    ctx.drawImage(
      img,
      src.x,
      src.y,
      src.w,
      src.h,
      0,
      0,
      src.w,
      src.h,
    );
    ctx.restore();
  }

  return canvas;
}

export function getNativeImageExportDimensions(
  items: SceneItem[],
  scale = 1,
  paddingPx = 10,
): { width: number; height: number } {
  if (!supportsNativeImageExport(items)) return { width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const bounds = getItemWorldBounds(item);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }

  const pixelsPerWorld = getNativePixelsPerWorld(items, scale);
  return {
    width: Math.max(1, Math.ceil((maxX - minX) * pixelsPerWorld) + paddingPx * 2),
    height: Math.max(1, Math.ceil((maxY - minY) * pixelsPerWorld) + paddingPx * 2),
  };
}

export function renderCanvasSnapshot(
  app: Application,
  viewport: Viewport,
  items?: SceneItem[],
  options?: { background?: string | null; paddingPx?: number },
): HTMLCanvasElement {
  const directCanvas = app.canvas as unknown as HTMLCanvasElement | undefined;
  const sourceCanvas = directCanvas
    ?? (app.renderer?.extract
      ? (app.renderer.extract.canvas(viewport) as HTMLCanvasElement)
      : undefined);
  if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    throw new Error('Rendered canvas unavailable');
  }

  let sx = 0;
  let sy = 0;
  let sw = sourceCanvas.width;
  let sh = sourceCanvas.height;

  if (items && items.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      const bounds = getItemWorldBounds(item);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.w);
      maxY = Math.max(maxY, bounds.y + bounds.h);
    }

    const screenTL = viewport.toScreen(minX, minY);
    const screenBR = viewport.toScreen(maxX, maxY);
    const rect = sourceCanvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? sourceCanvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? sourceCanvas.height / rect.height : 1;
    const pad = options?.paddingPx ?? 12;

    sx = Math.max(0, Math.floor(Math.min(screenTL.x, screenBR.x) * scaleX) - pad);
    sy = Math.max(0, Math.floor(Math.min(screenTL.y, screenBR.y) * scaleY) - pad);
    sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.ceil(Math.abs(screenBR.x - screenTL.x) * scaleX) + pad * 2));
    sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.ceil(Math.abs(screenBR.y - screenTL.y) * scaleY) + pad * 2));
  }

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = sw;
  outputCanvas.height = sh;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  if (options?.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  } else {
    ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  }

  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return outputCanvas;
}
