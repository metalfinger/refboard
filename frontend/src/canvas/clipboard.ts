/**
 * Clipboard module — copy canvas to system clipboard and paste images from it.
 *
 * Copy approach: snapshot the already-rendered canvas, then crop the visible
 * selection region in screen space. This preserves crop/flip/rotation/group
 * transforms exactly as the user sees them.
 */

import type { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';
import type { SceneManager, SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import { uploadImage } from '../api';

/**
 * Write selected items (or full viewport) to system clipboard as PNG.
 * Selected items are rendered at their native size, not affected by zoom.
 */
export async function writeCanvasToClipboard(
  app: Application | null,
  viewport: Viewport | null,
  items?: SceneItem[],
): Promise<void> {
  if (!viewport) throw new Error('Viewport not available');
  if (!app) throw new Error('Renderer not available');

  const directCanvas = app.canvas as unknown as HTMLCanvasElement | undefined;
  const fallbackCanvas = app.renderer?.extract
    ? (app.renderer.extract.canvas(viewport) as HTMLCanvasElement)
    : undefined;
  const sourceCanvas = directCanvas ?? fallbackCanvas;
  if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    throw new Error('Rendered canvas unavailable');
  }

  let outputCanvas: HTMLCanvasElement;

  if (items && items.length > 0) {
    // Compute world-space bounding box, then convert to visible screen-space crop.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items) {
      const { x, y, w, h } = getItemWorldBounds(item);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    const screenTL = viewport.toScreen(minX, minY);
    const screenBR = viewport.toScreen(maxX, maxY);
    const rect = sourceCanvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? sourceCanvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? sourceCanvas.height / rect.height : 1;
    const pad = 12;
    const sx = Math.max(0, Math.floor(Math.min(screenTL.x, screenBR.x) * scaleX) - pad);
    const sy = Math.max(0, Math.floor(Math.min(screenTL.y, screenBR.y) * scaleY) - pad);
    const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.ceil(Math.abs(screenBR.x - screenTL.x) * scaleX) + pad * 2));
    const sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.ceil(Math.abs(screenBR.y - screenTL.y) * scaleY) + pad * 2));

    outputCanvas = document.createElement('canvas');
    outputCanvas.width = sw;
    outputCanvas.height = sh;
    const ctx2d = outputCanvas.getContext('2d')!;
    ctx2d.fillStyle = '#1e1e1e';
    ctx2d.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx2d.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  } else {
    // Full current view copy.
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = sourceCanvas.width;
    outputCanvas.height = sourceCanvas.height;
    const ctx2d = outputCanvas.getContext('2d')!;
    ctx2d.fillStyle = '#1e1e1e';
    ctx2d.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx2d.drawImage(sourceCanvas, 0, 0);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('toBlob returned null'));
    }, 'image/png');
  });

  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

/**
 * Paste an image from the system clipboard into the scene.
 * Reads the clipboard, uploads the first image found, and adds it at the viewport center.
 */
export async function pasteFromSystemClipboard(
  scene: SceneManager,
  viewport: Viewport,
  boardId: string,
  onChange: () => void,
): Promise<string> {
  const clipItems = await navigator.clipboard.read();
  for (const clipItem of clipItems) {
    for (const type of clipItem.types) {
      if (!type.startsWith('image/')) continue;
      const blob = await clipItem.getType(type);
      const file = new File([blob], `paste.${type.split('/')[1]}`, { type });
      const res = await uploadImage(boardId, file);
      const imgData = res.data.image || res.data;
      const assetKey = imgData.asset_key;
      const w = imgData.width || 400;
      const h = imgData.height || 300;
      // Display at native size — let user resize manually if needed
      const fw = w;
      const fh = h;
      if (assetKey) {
        const center = viewport.center;
        scene.addImageFromUpload(assetKey, fw, fh, center.x - fw / 2, center.y - fh / 2);
        onChange();
        return 'Pasted image';
      }
    }
  }
  return 'No image in clipboard';
}
