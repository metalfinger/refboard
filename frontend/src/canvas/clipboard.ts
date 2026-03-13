/**
 * Clipboard module — copy canvas to system clipboard and paste images from it.
 *
 * Uses the unified composition renderer for all copy operations. Image-only
 * selections produce native-resolution output; mixed selections fall back to
 * the viewport snapshot with an explicit warning.
 */

import type { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';
import type { SceneManager, SceneItem } from './SceneManager';
import { uploadImage } from '../api';
import { composeSelection } from './compositionRenderer';
import { renderCanvasSnapshot } from './snapshotRenderer';

/**
 * Write selected items (or full viewport) to system clipboard as PNG.
 * Selected items are rendered at their native size, not affected by zoom.
 *
 * Returns any warnings from the composition pipeline (e.g. fallback used).
 */
export async function writeCanvasToClipboard(
  app: Application | null,
  viewport: Viewport | null,
  items?: SceneItem[],
  scene?: SceneManager,
): Promise<string[]> {
  if (!viewport) throw new Error('Viewport not available');
  if (!app) throw new Error('Renderer not available');

  let outputCanvas: HTMLCanvasElement;
  let warnings: string[] = [];
  const resolver = scene ? (id: string) => scene.getById(id) : undefined;

  if (items && items.length > 0) {
    const result = await composeSelection(items, {
      mode: 'clipboard',
      scale: 1,
      background: null,
      paddingPx: 10,
      fallbackToSnapshot: true,
    }, { app, viewport }, resolver);
    outputCanvas = result.canvas;
    warnings = result.warnings;
  } else {
    // Full viewport capture — always snapshot
    outputCanvas = renderCanvasSnapshot(app, viewport, undefined, { background: null });
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

  return warnings;
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
