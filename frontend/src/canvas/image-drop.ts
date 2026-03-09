import { Canvas, FabricImage, Rect } from 'fabric';
import { uploadImage, uploadImageFromUrl } from '../api';

type OnImageAdded = () => void;

export function setupDragDrop(
  canvas: Canvas,
  boardId: string,
  onImageAdded: OnImageAdded
): () => void {
  const canvasEl = canvas.getSelectionElement();
  const upperCanvas = canvas.upperCanvasEl || canvasEl;
  const wrapper = upperCanvas?.parentElement || canvasEl.parentElement;
  if (!wrapper) return () => {};

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

    // Handle URL drops (dragged image URL from browser)
    if (!files || files.length === 0) {
      const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      if (url && (url.startsWith('http://') || url.startsWith('https://')) && /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) {
        const rect = wrapper!.getBoundingClientRect();
        const vpt = canvas.viewportTransform!;
        const x = (e.clientX - rect.left - vpt[4]) / vpt[0];
        const y = (e.clientY - rect.top - vpt[5]) / vpt[3];

        const placeholder = new Rect({
          left: x, top: y, width: 200, height: 150,
          fill: '#3d3d3d', stroke: '#4a9eff', strokeWidth: 2,
          strokeDashArray: [8, 4], selectable: false, evented: false,
        });
        canvas.add(placeholder);
        canvas.requestRenderAll();

        try {
          const res = await uploadImageFromUrl(boardId, url);
          const imgData = res.data.image || res.data;
          const imgUrl = imgData.public_url;
          canvas.remove(placeholder);

          const imgEl = await FabricImage.fromURL(imgUrl, { crossOrigin: 'anonymous' });
          imgEl.set({ left: x, top: y, id: imgData.id } as any);
          const maxDim = 600;
          if (imgEl.width! > maxDim || imgEl.height! > maxDim) {
            const scale = maxDim / Math.max(imgEl.width!, imgEl.height!);
            imgEl.scale(scale);
          }
          canvas.add(imgEl);
          canvas.requestRenderAll();
          onImageAdded();
        } catch (err) {
          console.error('URL image upload failed:', err);
          canvas.remove(placeholder);
          canvas.requestRenderAll();
        }
      }
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;

      // Calculate drop position in canvas coordinates
      const rect = wrapper!.getBoundingClientRect();
      const vpt = canvas.viewportTransform!;
      const x = (e.clientX - rect.left - vpt[4]) / vpt[0];
      const y = (e.clientY - rect.top - vpt[5]) / vpt[3];

      // Create placeholder
      const placeholder = new Rect({
        left: x,
        top: y,
        width: 200,
        height: 150,
        fill: '#3d3d3d',
        stroke: '#4a9eff',
        strokeWidth: 2,
        strokeDashArray: [8, 4],
        selectable: false,
        evented: false,
      });
      canvas.add(placeholder);
      canvas.requestRenderAll();

      try {
        const res = await uploadImage(boardId, file);
        const imgData = res.data.image || res.data;
        const url = imgData.public_url;

        canvas.remove(placeholder);

        const imgEl = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
        imgEl.set({
          left: x,
          top: y,
          id: imgData.id,
        } as any);
        // Scale down large images
        const maxDim = 600;
        if (imgEl.width! > maxDim || imgEl.height! > maxDim) {
          const scale = maxDim / Math.max(imgEl.width!, imgEl.height!);
          imgEl.scale(scale);
        }
        canvas.add(imgEl);
        canvas.requestRenderAll();
        onImageAdded();
      } catch (err) {
        console.error('Image upload failed:', err);
        canvas.remove(placeholder);
        canvas.requestRenderAll();
      }
    }
  }

  wrapper.addEventListener('dragover', onDragOver);
  wrapper.addEventListener('drop', onDrop);

  return () => {
    wrapper.removeEventListener('dragover', onDragOver);
    wrapper.removeEventListener('drop', onDrop);
  };
}

export function setupPaste(
  canvas: Canvas,
  boardId: string,
  onImageAdded: OnImageAdded
): () => void {
  async function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/')) continue;

      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;

      // Place at canvas center
      const vpt = canvas.viewportTransform!;
      const cx = (canvas.width! / 2 - vpt[4]) / vpt[0];
      const cy = (canvas.height! / 2 - vpt[5]) / vpt[3];

      const placeholder = new Rect({
        left: cx - 100,
        top: cy - 75,
        width: 200,
        height: 150,
        fill: '#3d3d3d',
        stroke: '#4a9eff',
        strokeWidth: 2,
        strokeDashArray: [8, 4],
        selectable: false,
        evented: false,
      });
      canvas.add(placeholder);
      canvas.requestRenderAll();

      try {
        const res = await uploadImage(boardId, file);
        const imgData = res.data.image || res.data;
        const url = imgData.public_url;

        canvas.remove(placeholder);

        const imgEl = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
        imgEl.set({
          left: cx - (imgEl.width! * (imgEl.scaleX || 1)) / 2,
          top: cy - (imgEl.height! * (imgEl.scaleY || 1)) / 2,
          id: imgData.id,
        } as any);
        const maxDim = 600;
        if (imgEl.width! > maxDim || imgEl.height! > maxDim) {
          const scale = maxDim / Math.max(imgEl.width!, imgEl.height!);
          imgEl.scale(scale);
        }
        canvas.add(imgEl);
        canvas.requestRenderAll();
        onImageAdded();
      } catch (err) {
        console.error('Image paste upload failed:', err);
        canvas.remove(placeholder);
        canvas.requestRenderAll();
      }
    }
  }

  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('paste', onPaste);
  };
}
