/**
 * Clipboard module — copy canvas to system clipboard and paste images from it.
 *
 * Copy approach: render ONLY the selected items at native resolution using
 * PixiJS generateTexture + extract. No viewport cropping — independent of
 * zoom/pan state. Items are temporarily reparented into a clean container,
 * rendered, then restored.
 */

import { Container, Rectangle } from 'pixi.js';
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
  if (!app?.renderer?.extract) throw new Error('Renderer not available');

  let outputCanvas: HTMLCanvasElement;

  if (items && items.length > 0) {
    // --- Render selected items at native resolution ---

    // 1. Compute world-space bounding box
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

    // 2. Save original parent/transform for each item, reparent into temp container
    const tempContainer = new Container();
    const saved = new Map<string, {
      parent: Container;
      x: number;
      y: number;
      sx: number;
      sy: number;
    }>();

    // Pre-compute world bounds for each item (handles group children with local coords)
    const worldBoundsMap = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const item of items) {
      worldBoundsMap.set(item.id, getItemWorldBounds(item));
    }

    for (const item of items) {
      const obj = item.displayObject;
      saved.set(item.id, {
        parent: obj.parent as Container,
        x: obj.x,
        y: obj.y,
        sx: obj.scale.x,
        sy: obj.scale.y,
      });

      // Remove from current parent
      obj.parent?.removeChild(obj);

      // Position using world bounds (correct for both top-level and group children)
      const wb = worldBoundsMap.get(item.id)!;
      obj.position.set(wb.x - minX + pad, wb.y - minY + pad);
      // Use data scale (not viewport-affected scale)
      obj.scale.set(item.data.sx, item.data.sy);

      tempContainer.addChild(obj);
    }

    // 3. Compute resolution multiplier to approach native texture resolution
    //    e.g. a 2000px image displayed at 400px → ratio ~5, capped at 4x
    let maxRatio = 1;
    for (const item of items) {
      const tex = (item.displayObject as any)?.texture;
      if (tex && tex.width > 1 && item.data.w > 1) {
        maxRatio = Math.max(maxRatio, tex.width / item.data.w);
      }
    }
    const resolution = Math.min(Math.max(maxRatio, window.devicePixelRatio || 1), 4);

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
      // 4. Restore items to their original parents and transforms (even on error)
      for (const item of items) {
        const s = saved.get(item.id)!;
        tempContainer.removeChild(item.displayObject);
        s.parent.addChild(item.displayObject);
        item.displayObject.position.set(s.x, s.y);
        item.displayObject.scale.set(s.sx, s.sy);
      }
      tempContainer.destroy();
      texture?.destroy(true);
    }

    // 6. Add opaque background
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = extractedCanvas.width;
    outputCanvas.height = extractedCanvas.height;
    const ctx2d = outputCanvas.getContext('2d')!;
    ctx2d.fillStyle = '#1e1e1e';
    ctx2d.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx2d.drawImage(extractedCanvas, 0, 0);
  } else {
    // Full viewport screenshot (at device pixel ratio for crisp output)
    const extractedCanvas = app.renderer.extract.canvas(viewport) as HTMLCanvasElement;
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = extractedCanvas.width;
    outputCanvas.height = extractedCanvas.height;
    const ctx2d = outputCanvas.getContext('2d')!;
    ctx2d.fillStyle = '#1e1e1e';
    ctx2d.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx2d.drawImage(extractedCanvas, 0, 0);
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
      const maxDim = 600;
      let fw = w, fh = h;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        fw = Math.round(w * s);
        fh = Math.round(h * s);
      }
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
