import { Graphics } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneManager } from './SceneManager';
import { uploadImage, uploadImageFromUrl } from '../api';

type OnChange = () => void;

/* ------------------------------------------------------------------ */
/*  Placeholder helper                                                 */
/* ------------------------------------------------------------------ */

function createPlaceholder(viewport: Viewport, x: number, y: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, 200, 150);
  g.fill({ color: 0x3d3d3d });
  g.stroke({ width: 2, color: 0x4a9eff });
  g.position.set(x, y);
  g.interactive = false;
  viewport.addChild(g);
  return g;
}

function removePlaceholder(viewport: Viewport, g: Graphics) {
  viewport.removeChild(g);
  g.destroy();
}

/* ------------------------------------------------------------------ */
/*  Handle upload response (image or video)                            */
/* ------------------------------------------------------------------ */

/** Returns the placed width so callers can offset subsequent items. */
function handleUploadResult(
  res: any,
  viewport: Viewport,
  sceneManager: SceneManager,
  x: number,
  y: number,
  onChange: OnChange,
): number {
  const imgData = res.data.image || res.data;
  const mediaType: string = imgData.media_type || 'image';
  const assetKey: string | undefined = imgData.asset_key;
  const w: number = imgData.width || 400;
  const h: number = imgData.height || 300;

  // Cap large media to 600px max dimension
  const maxDim = 600;
  let finalW = w;
  let finalH = h;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    finalW = Math.round(w * scale);
    finalH = Math.round(h * scale);
  }

  if (mediaType === 'video' && assetKey) {
    sceneManager.addVideoFromUpload(assetKey, finalW, finalH, x, y);
  } else if (assetKey) {
    sceneManager.addImageFromUpload(assetKey, finalW, finalH, x, y);
  } else {
    // Fallback: legacy response without asset_key — use addImageFromUpload with public_url as key
    const fallbackKey = imgData.public_url || imgData.id || 'unknown';
    sceneManager.addImageFromUpload(fallbackKey, finalW, finalH, x, y);
  }

  onChange();
  return finalW;
}

/* ------------------------------------------------------------------ */
/*  Drag & Drop                                                        */
/* ------------------------------------------------------------------ */

export function setupDragDrop(
  container: HTMLElement,
  viewport: Viewport,
  sceneManager: SceneManager,
  boardId: string,
  onChange: OnChange,
): () => void {
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer?.files;

    // Handle URL drops (dragged image/video URL from browser)
    if (!files || files.length === 0) {
      const url =
        e.dataTransfer?.getData('text/uri-list') ||
        e.dataTransfer?.getData('text/plain') ||
        '';
      if (
        url &&
        (url.startsWith('http://') || url.startsWith('https://')) &&
        /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)(\?|$)/i.test(url)
      ) {
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        const placeholder = createPlaceholder(viewport, world.x, world.y);

        try {
          const res = await uploadImageFromUrl(boardId, url);
          removePlaceholder(viewport, placeholder);
          handleUploadResult(res, viewport, sceneManager, world.x, world.y, onChange);
        } catch (err) {
          console.error('URL image upload failed:', err);
          removePlaceholder(viewport, placeholder);
        }
      }
      return;
    }

    const rect = container.getBoundingClientRect();
    const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const GAP = 20; // px gap between dropped images
    let cursorX = world.x; // running x position for side-by-side placement

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;

      const placeholder = createPlaceholder(viewport, cursorX, world.y);

      try {
        const res = await uploadImage(boardId, file);
        removePlaceholder(viewport, placeholder);
        const placedWidth = handleUploadResult(res, viewport, sceneManager, cursorX, world.y, onChange);
        cursorX += placedWidth + GAP;
      } catch (err) {
        console.error('Image upload failed:', err);
        removePlaceholder(viewport, placeholder);
        cursorX += 220; // fallback offset if upload fails
      }
    }
  }

  // Prevent browser default (opening file in new tab) on the whole document
  function onDocDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function onDocDrop(e: DragEvent) {
    e.preventDefault();
  }

  document.addEventListener('dragover', onDocDragOver);
  document.addEventListener('drop', onDocDrop);
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);

  return () => {
    document.removeEventListener('dragover', onDocDragOver);
    document.removeEventListener('drop', onDocDrop);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('drop', onDrop);
  };
}

/* ------------------------------------------------------------------ */
/*  Clipboard Paste                                                    */
/* ------------------------------------------------------------------ */

export function setupPaste(
  viewport: Viewport,
  sceneManager: SceneManager,
  boardId: string,
  onChange: OnChange,
): () => void {
  async function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/') && !item.type.startsWith('video/')) continue;

      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;

      // Place at viewport center (world coords)
      const center = viewport.center;
      const cx = center.x;
      const cy = center.y;

      const placeholder = createPlaceholder(viewport, cx - 100, cy - 75);

      try {
        const res = await uploadImage(boardId, file);
        removePlaceholder(viewport, placeholder);
        handleUploadResult(res, viewport, sceneManager, cx - 100, cy - 75, onChange);
      } catch (err) {
        console.error('Image paste upload failed:', err);
        removePlaceholder(viewport, placeholder);
      }
    }
  }

  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('paste', onPaste);
  };
}
