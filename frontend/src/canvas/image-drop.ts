import { Graphics, Text, TextStyle, Ticker } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneManager } from './SceneManager';
import type { SelectionManager } from './SelectionManager';
import type { UploadManager } from '../stores/uploadManager';
import { uploadImage, uploadImageFromUrl } from '../api';
import { wasRecentInternalPaste } from './shortcut-definitions';

type OnChange = () => void;

/** Client-side file size limit (matches backend MAX_FILE_SIZE_MB default) */
const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Explicit MIME allowlist — matches backend ALLOWED_MIME_TYPES exactly. */
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/pdf',
]);

/** Fallback: accepted file extensions (for when browser reports empty/wrong MIME). */
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|pdf)$/i;

/** Check if a file should be accepted (MIME or extension fallback). */
function isFileAllowed(file: File): boolean {
  if (ALLOWED_MIME_TYPES.has(file.type)) return true;
  // Fallback to extension when MIME is empty or non-standard
  if (file.name && ALLOWED_EXTENSIONS.test(file.name)) return true;
  return false;
}

/** Check if a file is media-like but unsupported (for rejection feedback). */
function isUnsupportedMedia(file: File): boolean {
  if (!file.type && !file.name) return false;
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return true;
  if (file.name && /\.(bmp|tiff?|avif|heic|heif|psd|raw|dng|ico|apng)$/i.test(file.name)) return true;
  return false;
}

/** Human-readable extension from MIME type, for error messages. */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'image/bmp': '.bmp', 'image/tiff': '.tiff', 'image/avif': '.avif',
    'image/heic': '.heic', 'image/heif': '.heif',
    'application/pdf': '.pdf', 'image/x-adobe-dng': '.dng',
  };
  return map[mime] || mime.split('/')[1] || mime;
}

/* ------------------------------------------------------------------ */
/*  Placeholder helper                                                 */
/* ------------------------------------------------------------------ */

function createPlaceholder(viewport: Viewport, x: number, y: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, 200, 150);
  g.fill({ color: 0x2a2a2a });
  g.stroke({ width: 2, color: 0x4a9eff });
  g.position.set(x, y);
  g.interactive = false;

  // "Loading..." label
  const label = new Text({
    text: 'Loading…',
    style: new TextStyle({ fontSize: 14, fill: 0xaaaaaa, fontFamily: 'sans-serif' }),
  });
  label.anchor.set(0.5);
  label.position.set(100, 75);
  g.addChild(label);

  // Pulsing border animation
  let elapsed = 0;
  const onTick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    g.alpha = 0.6 + 0.4 * Math.sin(elapsed * 0.005);
  };
  Ticker.shared.add(onTick);
  (g as any)._pulseCleanup = () => Ticker.shared.remove(onTick);

  viewport.addChild(g);
  return g;
}

function removePlaceholder(viewport: Viewport, g: Graphics) {
  (g as any)._pulseCleanup?.();
  viewport.removeChild(g);
  g.destroy({ children: true });
}

/* ------------------------------------------------------------------ */
/*  Handle upload response (image or video)                            */
/* ------------------------------------------------------------------ */

/** Returns the placed dimensions and item ID so callers can offset subsequent items and select them. */
function handleUploadResult(
  res: any,
  viewport: Viewport,
  sceneManager: SceneManager,
  x: number,
  y: number,
  onChange: OnChange,
): { w: number; h: number; id: string } {
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

  let item;
  if (mediaType === 'video' && assetKey) {
    const posterKey: string | undefined = imgData.poster_asset_key;
    const duration: number | undefined = imgData.duration;
    item = sceneManager.addVideoFromUpload(assetKey, finalW, finalH, x, y, posterKey, duration);
  } else if (assetKey) {
    item = sceneManager.addImageFromUpload(assetKey, finalW, finalH, x, y);
  } else {
    // Fallback: legacy response without asset_key — use addImageFromUpload with public_url as key
    const fallbackKey = imgData.public_url || imgData.id || 'unknown';
    item = sceneManager.addImageFromUpload(fallbackKey, finalW, finalH, x, y);
  }

  onChange();
  return { w: finalW, h: finalH, id: item.id };
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
  selection?: SelectionManager | null,
  uploads?: UploadManager | null,
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
      const isHttpUrl = url && (url.startsWith('http://') || url.startsWith('https://'));
      const supportedUrlPattern = /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)(\?|#|$)/i;
      // Broader media pattern: URLs that look like media but aren't in our supported set
      const mediaUrlPattern = /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|bmp|tiff?|avif|heic|heif|psd|raw|dng|ico|apng)(\?|#|$)/i;

      if (isHttpUrl && !supportedUrlPattern.test(url) && mediaUrlPattern.test(url)) {
        // URL looks like media but isn't supported — show rejection
        const ext = url.split('?')[0].split('#')[0].match(/\.(\w+)$/)?.[1] || 'unknown';
        uploads?.addRejected(
          url.split('/').pop()?.split('?')[0] || 'url-import',
          `Unsupported format: .${ext}`,
        );
        return;
      }
      if (
        isHttpUrl &&
        supportedUrlPattern.test(url)
      ) {
        const rect = container.getBoundingClientRect();
        const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        const placeholder = createPlaceholder(viewport, world.x, world.y);

        // Derive a filename from the URL for the upload manager
        const urlFilename = url.split('/').pop()?.split('?')[0] || 'url-import';
        const isVideoUrl = /\.(mp4|webm|mov)(\?|$)/i.test(url);
        const jobId = uploads?.addUrlJob(urlFilename, isVideoUrl ? 'video' : 'image');

        try {
          const res = await uploadImageFromUrl(boardId, url);
          removePlaceholder(viewport, placeholder);
          const { id } = handleUploadResult(res, viewport, sceneManager, world.x, world.y, onChange);
          selection?.selectOnly(id);
          const imgData = res.data.image || res.data;
          if (jobId) uploads?.uploadComplete(jobId, imgData.id);
        } catch (err: any) {
          console.error('URL image upload failed:', err);
          removePlaceholder(viewport, placeholder);
          if (jobId) uploads?.setFailed(jobId, err.response?.data?.error || err.message || 'URL import failed');
        }
      }
      return;
    }

    const rect = container.getBoundingClientRect();
    const world = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const GAP = 20;

    // ── Pass 1: validate files, create all jobs upfront so queue is visible ──
    interface QueuedFile { file: File; jobId: string | undefined; }
    const queued: QueuedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Reject unsupported file types with immediate feedback
      if (!isFileAllowed(file)) {
        if (isUnsupportedMedia(file)) {
          const ext = file.name?.match(/\.(\w+)$/)?.[1] || file.type.split('/')[1] || 'unknown';
          uploads?.addRejected(file.name || 'unknown', `Unsupported format: .${ext}`);
        }
        continue;
      }

      // Client-side size validation
      if (file.size > MAX_FILE_SIZE) {
        const jobId = uploads?.addJob(file, boardId);
        if (jobId) uploads?.setFailed(jobId, `File too large (${(file.size / 1024 / 1024).toFixed(0)}MB, max ${MAX_FILE_SIZE_MB}MB)`);
        continue;
      }

      const jobId = uploads?.addJob(file, boardId);
      queued.push({ file, jobId });
    }

    // ── Pass 2: upload sequentially, placing in grid ──
    const cols = Math.ceil(Math.sqrt(queued.length)) || 1;
    let col = 0;
    let row = 0;
    let rowMaxH = 0;
    let cursorY = world.y;
    const colWidths: number[] = new Array(cols).fill(0);
    const newItemIds: string[] = [];

    for (const { file, jobId } of queued) {
      // Check if job was cancelled while queued (user clicked cancel)
      if (jobId && uploads?.isCancelled(jobId)) {
        col++;
        if (col >= cols) { col = 0; row++; cursorY += rowMaxH + GAP; rowMaxH = 0; }
        continue;
      }

      // Compute x from column widths so far
      let cursorX = world.x;
      for (let c = 0; c < col; c++) cursorX += (colWidths[c] || 220) + GAP;

      const placeholder = createPlaceholder(viewport, cursorX, cursorY);
      if (jobId) uploads?.startUpload(jobId);

      try {
        const res = await uploadImage(boardId, file, (p) => {
          if (jobId) uploads?.setProgress(jobId, p);
        });
        removePlaceholder(viewport, placeholder);
        const { w: placedW, h: placedH, id } = handleUploadResult(res, viewport, sceneManager, cursorX, cursorY, onChange);
        newItemIds.push(id);
        if (placedW > (colWidths[col] || 0)) colWidths[col] = placedW;
        if (placedH > rowMaxH) rowMaxH = placedH;
        const imgData = res.data.image || res.data;
        if (jobId) uploads?.uploadComplete(jobId, imgData.id);
      } catch (err: any) {
        console.error('Image upload failed:', err);
        removePlaceholder(viewport, placeholder);
        if (jobId) uploads?.setFailed(jobId, err.response?.data?.error || err.message || 'Upload failed');
        if (220 > (colWidths[col] || 0)) colWidths[col] = 220;
        if (150 > rowMaxH) rowMaxH = 150;
      }

      col++;
      if (col >= cols) {
        col = 0;
        row++;
        cursorY += rowMaxH + GAP;
        rowMaxH = 0;
      }
    }

    // Select all newly imported items
    if (selection && newItemIds.length > 0) {
      selection.selectOnly(newItemIds[0]);
      for (let i = 1; i < newItemIds.length; i++) {
        selection.toggle(newItemIds[i]);
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
  selection?: SelectionManager | null,
  uploads?: UploadManager | null,
  opts?: {
    onTextPaste?: (data: { text: string; html: string; hasImage: boolean }) => void;
    onShortTextPaste?: (text: string) => void;
  },
): () => void {
  // Track last known cursor position in world coordinates for paste-at-cursor
  let lastWorldX: number | null = null;
  let lastWorldY: number | null = null;
  const onPointerMove = (e: any) => {
    const world = viewport.toWorld(e.global.x, e.global.y);
    lastWorldX = world.x;
    lastWorldY = world.y;
  };
  viewport.on('pointermove', onPointerMove);

  async function onPaste(e: ClipboardEvent) {
    // If focus is inside a contentEditable (e.g. BlockNote editor), let native paste through
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || active.closest('[contenteditable]'))) return;

    // If an internal paste (scene item duplication) just happened via the shortcut
    // handler, skip the native paste to avoid double-pasting the PNG screenshot.
    if (wasRecentInternalPaste()) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    // ── Text/HTML detection — before media loop ──
    let hasMedia = false;
    let textContent = '';
    let htmlContent = '';

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/') || item.type.startsWith('video/')) hasMedia = true;
      if (item.type === 'text/plain') textContent = e.clipboardData?.getData('text/plain') || '';
      if (item.type === 'text/html') htmlContent = e.clipboardData?.getData('text/html') || '';
    }

    if (textContent) {
      if (textContent.length > 20 && opts?.onTextPaste) {
        e.preventDefault();
        opts.onTextPaste({ text: textContent, html: htmlContent, hasImage: hasMedia });
        return;
      } else if (textContent.length <= 20 && opts?.onShortTextPaste) {
        e.preventDefault();
        opts.onShortTextPaste(textContent);
        return;
      }
      // No callback provided — let native paste behavior through
    }

    // ── Media paste logic (unchanged) ──
    const newItemIds: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Skip non-media clipboard items (text, html, etc.)
      if (!item.type.startsWith('image/') && !item.type.startsWith('video/')) continue;

      e.preventDefault();

      // Reject unsupported media types with feedback
      if (!ALLOWED_MIME_TYPES.has(item.type)) {
        const ext = extFromMime(item.type);
        uploads?.addRejected(
          `pasted-item${ext.startsWith('.') ? ext : '.' + ext}`,
          `Unsupported format: ${ext}`,
        );
        continue;
      }

      const file = item.getAsFile();
      if (!file) continue;

      // Client-side size validation
      if (file.size > MAX_FILE_SIZE) {
        const jobId = uploads?.addJob(file, boardId);
        if (jobId) uploads?.setFailed(jobId, `File too large (${(file.size / 1024 / 1024).toFixed(0)}MB, max ${MAX_FILE_SIZE_MB}MB)`);
        continue;
      }

      // Place at cursor position if known, otherwise fall back to viewport center
      const cx = lastWorldX ?? viewport.center.x;
      const cy = lastWorldY ?? viewport.center.y;

      const placeholder = createPlaceholder(viewport, cx - 100, cy - 75);
      const jobId = uploads?.addJob(file, boardId);

      try {
        const res = await uploadImage(boardId, file, (p) => {
          if (jobId) uploads?.setProgress(jobId, p);
        });
        removePlaceholder(viewport, placeholder);
        const { id } = handleUploadResult(res, viewport, sceneManager, cx - 100, cy - 75, onChange);
        newItemIds.push(id);
        const imgData = res.data.image || res.data;
        if (jobId) uploads?.uploadComplete(jobId, imgData.id);
      } catch (err: any) {
        console.error('Image paste upload failed:', err);
        removePlaceholder(viewport, placeholder);
        if (jobId) uploads?.setFailed(jobId, err.response?.data?.error || err.message || 'Upload failed');
      }
    }

    // Select all pasted items
    if (selection && newItemIds.length > 0) {
      selection.selectOnly(newItemIds[0]);
      for (let i = 1; i < newItemIds.length; i++) {
        selection.toggle(newItemIds[i]);
      }
    }
  }

  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('paste', onPaste);
    viewport.off('pointermove', onPointerMove);
  };
}
