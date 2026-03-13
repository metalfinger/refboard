/**
 * Export canvas content as a downloadable image file.
 * Reuses the same rendering pipeline as clipboard.ts.
 */

import { Container, Rectangle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';
import type { SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import { getImageVisibleLocalRect } from './imageTransforms';
import type { ImageObject } from './scene-format';

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number; // 0-1, only used for jpeg/webp
  scale: number;   // 1 = native, 0.5 = half, 2 = double
  background: string; // hex color
  filename: string;
}

/**
 * Render selected items (or full board content) to a canvas at the given scale.
 * Returns an HTMLCanvasElement ready for blob conversion.
 */
function renderToCanvas(
  app: Application,
  viewport: Viewport,
  items: SceneItem[],
  scale: number,
  background: string,
): HTMLCanvasElement {
  // Compute world-space bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    const { x, y, w, h } = getItemWorldBounds(item);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const pad = 10;
  const totalW = Math.ceil(maxX - minX) + pad * 2;
  const totalH = Math.ceil(maxY - minY) + pad * 2;

  // Reparent items into temp container
  const tempContainer = new Container();
  const saved = new Map<string, { parent: Container; x: number; y: number; sx: number; sy: number; angle: number; globalX: number; globalY: number }>();
  for (const item of items) {
    const obj = item.displayObject;
    const globalOrigin = obj.parent?.toGlobal(obj.position) ?? obj.position;
    saved.set(item.id, {
      parent: obj.parent as Container,
      x: obj.x, y: obj.y,
      sx: obj.scale.x, sy: obj.scale.y,
      angle: obj.angle,
      globalX: globalOrigin.x,
      globalY: globalOrigin.y,
    });
    obj.parent?.removeChild(obj);
    const s = saved.get(item.id)!;
    obj.position.set(s.globalX - minX + pad, s.globalY - minY + pad);
    obj.scale.set(s.sx, s.sy);
    obj.angle = s.angle;
    tempContainer.addChild(obj);
  }

  // Compute resolution: use native texture ratio, then apply user scale
  let maxRatio = 1;
  for (const item of items) {
    const tex = (item.displayObject as any)?.texture;
    const displayW = item.type === 'image'
      ? getImageVisibleLocalRect(item.data as ImageObject).w * Math.abs(item.data.sx)
      : item.data.w * Math.abs(item.data.sx);
    if (tex && tex.width > 1 && displayW > 1) {
      maxRatio = Math.max(maxRatio, tex.width / displayW);
    }
  }
  const resolution = Math.min(maxRatio * scale, 8); // cap at 8x to avoid GPU limits

  let texture;
  let extractedCanvas: HTMLCanvasElement;
  try {
    texture = app.renderer.generateTexture({
      target: tempContainer,
      resolution,
      frame: new Rectangle(0, 0, totalW, totalH),
    });
    extractedCanvas = app.renderer.extract.canvas(texture) as HTMLCanvasElement;
  } finally {
    for (const item of items) {
      const s = saved.get(item.id)!;
      tempContainer.removeChild(item.displayObject);
      s.parent.addChild(item.displayObject);
      item.displayObject.position.set(s.x, s.y);
      item.displayObject.scale.set(s.sx, s.sy);
      item.displayObject.angle = s.angle;
    }
    tempContainer.destroy();
    texture?.destroy(true);
  }

  // Add background
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = extractedCanvas.width;
  outputCanvas.height = extractedCanvas.height;
  const ctx = outputCanvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  ctx.drawImage(extractedCanvas, 0, 0);

  return outputCanvas;
}

const MIME_MAP = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

/**
 * Export items as a downloadable image.
 */
export async function exportAsImage(
  app: Application | null,
  viewport: Viewport | null,
  items: SceneItem[],
  options: ExportOptions,
): Promise<void> {
  if (!app?.renderer?.extract || !viewport) throw new Error('Renderer not available');
  if (items.length === 0) throw new Error('No items to export');

  const canvas = renderToCanvas(app, viewport, items, options.scale, options.background);
  const mimeType = MIME_MAP[options.format];
  const quality = options.format === 'png' ? undefined : options.quality;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Export failed'))),
      mimeType,
      quality,
    );
  });

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${options.filename}.${options.format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get the pixel dimensions of the export at a given scale,
 * so the dialog can show a preview of the output size.
 */
export function getExportDimensions(
  items: SceneItem[],
  scale: number,
): { width: number; height: number } {
  if (items.length === 0) return { width: 0, height: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    const { x, y, w, h } = getItemWorldBounds(item);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const pad = 10;
  const w = Math.ceil(maxX - minX) + pad * 2;
  const h = Math.ceil(maxY - minY) + pad * 2;

  // Estimate native resolution ratio
  let maxRatio = 1;
  for (const item of items) {
    const tex = (item.displayObject as any)?.texture;
    const displayW = item.type === 'image'
      ? getImageVisibleLocalRect(item.data as ImageObject).w * Math.abs(item.data.sx)
      : item.data.w * Math.abs(item.data.sx);
    if (tex && tex.width > 1 && displayW > 1) {
      maxRatio = Math.max(maxRatio, tex.width / displayW);
    }
  }
  const resolution = Math.min(maxRatio * scale, 8);

  return {
    width: Math.round(w * resolution),
    height: Math.round(h * resolution),
  };
}
