/**
 * Export canvas content as a downloadable image file.
 *
 * Uses the unified composition renderer. Image-only selections produce
 * native-resolution output; mixed selections fall back to the viewport
 * snapshot with an explicit warning.
 */

import type { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';
import type { SceneManager, SceneItem } from './SceneManager';
import { composeSelection, getCompositionDimensions } from './compositionRenderer';

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

/**
 * Export selected items as a downloadable image file.
 * Returns any warnings from the composition pipeline.
 */
export async function exportAsImage(
  app: Application | null,
  viewport: Viewport | null,
  items: SceneItem[],
  options: ExportOptions,
  scene?: SceneManager,
): Promise<string[]> {
  if (!app || !viewport) throw new Error('Renderer not available');
  if (items.length === 0) throw new Error('No items to export');

  const resolver = scene ? (id: string) => scene.getById(id) : undefined;

  const result = await composeSelection(items, {
    mode: 'export',
    scale: options.scale,
    background: options.background,
    paddingPx: 10,
    fallbackToSnapshot: true,
  }, { app, viewport }, resolver);

  const mimeType = MIME_MAP[options.format];
  const quality = options.format === 'png' ? undefined : options.quality;

  const blob = await new Promise<Blob>((resolve, reject) => {
    result.canvas.toBlob(
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

  return result.warnings;
}

export function getExportDimensions(
  items: SceneItem[],
  scale: number,
  scene?: SceneManager,
): { width: number; height: number } {
  if (items.length === 0) return { width: 0, height: 0 };
  const resolver = scene ? (id: string) => scene.getById(id) : undefined;
  const dims = getCompositionDimensions(items, scale, 10, resolver);
  return { width: dims.width, height: dims.height };
}
