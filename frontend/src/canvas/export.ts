/**
 * Export canvas content as a downloadable image file.
 *
 * Image-only selections use the native-resolution renderer based on canonical
 * image geometry. Mixed selections fall back to the rendered canvas snapshot.
 */

import type { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';
import type { SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import {
  getNativeImageExportDimensions,
  renderCanvasSnapshot,
  renderNativeImageSelection,
  supportsNativeImageExport,
} from './snapshotRenderer';

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  scale: number;
  background: string;
  filename: string;
}

const MIME_MAP = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

async function renderToCanvas(
  app: Application,
  viewport: Viewport,
  items: SceneItem[],
  options: ExportOptions,
): Promise<HTMLCanvasElement> {
  if (supportsNativeImageExport(items)) {
    return renderNativeImageSelection(items, {
      scale: options.scale,
      background: options.background,
      paddingPx: 10,
    });
  }

  return renderCanvasSnapshot(app, viewport, items, {
    background: options.background,
    paddingPx: 12,
  });
}

export async function exportAsImage(
  app: Application | null,
  viewport: Viewport | null,
  items: SceneItem[],
  options: ExportOptions,
): Promise<void> {
  if (!app || !viewport) throw new Error('Renderer not available');
  if (items.length === 0) throw new Error('No items to export');

  const canvas = await renderToCanvas(app, viewport, items, options);
  const mimeType = MIME_MAP[options.format];
  const quality = options.format === 'png' ? undefined : options.quality;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Export failed'))),
      mimeType,
      quality,
    );
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${options.filename}.${options.format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getExportDimensions(
  items: SceneItem[],
  scale: number,
): { width: number; height: number } {
  if (items.length === 0) return { width: 0, height: 0 };

  if (supportsNativeImageExport(items)) {
    return getNativeImageExportDimensions(items, scale, 10);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const { x, y, w, h } = getItemWorldBounds(item);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const pad = 12;
  return {
    width: Math.max(1, Math.round(maxX - minX) + pad * 2),
    height: Math.max(1, Math.round(maxY - minY) + pad * 2),
  };
}
