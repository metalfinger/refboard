/**
 * Canvas operations — pure functions for alignment, arrangement, normalize, flip, etc.
 * Each mutates objects in place and calls setCoords(). Caller must requestRenderAll().
 *
 * IMPORTANT: When multiple objects are selected in Fabric.js, they live inside an
 * ActiveSelection group. Their left/top are RELATIVE to the group center, not the canvas.
 * We must use getBoundingRect() or the canvas-level coordinates for position calculations,
 * then convert back. The helper getAbsPos/setAbsPos handles this.
 */

import { Canvas, FabricObject } from 'fabric';

// ─── Helpers ───

function scaledW(o: FabricObject): number {
  return (o.width || 0) * (o.scaleX || 1);
}

function scaledH(o: FabricObject): number {
  return (o.height || 0) * (o.scaleY || 1);
}

/**
 * Break ActiveSelection so objects have canvas-level coordinates.
 * Returns a cleanup function to restore selection afterward.
 */
export function breakSelection(canvas: Canvas): { objects: FabricObject[]; restore: () => void } {
  const activeObj = canvas.getActiveObject();
  const objects = canvas.getActiveObjects();
  if (!activeObj || objects.length <= 1) {
    return { objects, restore: () => {} };
  }
  // Discard the ActiveSelection — this updates each object's left/top to canvas coordinates
  canvas.discardActiveObject();
  return {
    objects,
    restore: () => {
      // Re-select after operation
      const fabricNs = (window as any).fabric;
      if (fabricNs?.ActiveSelection && objects.length > 1) {
        const sel = new fabricNs.ActiveSelection(objects, { canvas });
        canvas.setActiveObject(sel);
      } else if (objects.length === 1) {
        canvas.setActiveObject(objects[0]);
      }
    },
  };
}

// ─── Alignment ───

export function alignLeft(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const minLeft = Math.min(...objects.map((o) => o.left ?? 0));
  objects.forEach((o) => { o.set({ left: minLeft } as any); o.setCoords(); });
}

export function alignRight(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const maxRight = Math.max(...objects.map((o) => (o.left ?? 0) + scaledW(o)));
  objects.forEach((o) => { o.set({ left: maxRight - scaledW(o) } as any); o.setCoords(); });
}

export function alignTop(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const minTop = Math.min(...objects.map((o) => o.top ?? 0));
  objects.forEach((o) => { o.set({ top: minTop } as any); o.setCoords(); });
}

export function alignBottom(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const maxBottom = Math.max(...objects.map((o) => (o.top ?? 0) + scaledH(o)));
  objects.forEach((o) => { o.set({ top: maxBottom - scaledH(o) } as any); o.setCoords(); });
}

// ─── Distribution ───

export function distributeHorizontal(objects: FabricObject[]) {
  if (objects.length < 3) return;
  const sorted = [...objects].sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = (last.left ?? 0) + scaledW(last) - (first.left ?? 0);
  const totalWidth = sorted.reduce((s, o) => s + scaledW(o), 0);
  const gap = (totalSpan - totalWidth) / (sorted.length - 1);
  let x = (first.left ?? 0) + scaledW(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    sorted[i].set({ left: x } as any);
    sorted[i].setCoords();
    x += scaledW(sorted[i]) + gap;
  }
}

export function distributeVertical(objects: FabricObject[]) {
  if (objects.length < 3) return;
  const sorted = [...objects].sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = (last.top ?? 0) + scaledH(last) - (first.top ?? 0);
  const totalHeight = sorted.reduce((s, o) => s + scaledH(o), 0);
  const gap = (totalSpan - totalHeight) / (sorted.length - 1);
  let y = (first.top ?? 0) + scaledH(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    sorted[i].set({ top: y } as any);
    sorted[i].setCoords();
    y += scaledH(sorted[i]) + gap;
  }
}

// ─── Normalize ───

export function normalizeSize(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const areas = objects.map((o) => scaledW(o) * scaledH(o));
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  objects.forEach((o) => {
    const currentArea = scaledW(o) * scaledH(o);
    if (currentArea <= 0) return;
    const ratio = Math.sqrt(avgArea / currentArea);
    o.set({ scaleX: (o.scaleX || 1) * ratio, scaleY: (o.scaleY || 1) * ratio } as any);
    o.setCoords();
  });
}

export function normalizeScale(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const avgSX = objects.reduce((s, o) => s + (o.scaleX || 1), 0) / objects.length;
  const avgSY = objects.reduce((s, o) => s + (o.scaleY || 1), 0) / objects.length;
  objects.forEach((o) => { o.set({ scaleX: avgSX, scaleY: avgSY } as any); o.setCoords(); });
}

export function normalizeHeight(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const avgH = objects.reduce((s, o) => s + scaledH(o), 0) / objects.length;
  objects.forEach((o) => {
    const h = scaledH(o);
    if (h <= 0) return;
    const ratio = avgH / h;
    o.set({ scaleX: (o.scaleX || 1) * ratio, scaleY: (o.scaleY || 1) * ratio } as any);
    o.setCoords();
  });
}

export function normalizeWidth(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const avgW = objects.reduce((s, o) => s + scaledW(o), 0) / objects.length;
  objects.forEach((o) => {
    const w = scaledW(o);
    if (w <= 0) return;
    const ratio = avgW / w;
    o.set({ scaleX: (o.scaleX || 1) * ratio, scaleY: (o.scaleY || 1) * ratio } as any);
    o.setCoords();
  });
}

// ─── Arrangement ───

export function arrangeOptimal(objects: FabricObject[]) {
  if (objects.length < 2) return;
  // Shelf-based bin packing, sorted by height descending
  const sorted = [...objects].sort((a, b) => scaledH(b) - scaledH(a));
  const gap = 10;
  const totalArea = sorted.reduce((s, o) => s + scaledW(o) * scaledH(o), 0);
  const shelfWidth = Math.sqrt(totalArea) * 1.3;
  const startX = sorted[0]?.left ?? 0;
  const startY = sorted[0]?.top ?? 0;
  let x = 0, y = 0, shelfHeight = 0;
  sorted.forEach((obj) => {
    const w = scaledW(obj);
    const h = scaledH(obj);
    if (x + w > shelfWidth && x > 0) {
      x = 0;
      y += shelfHeight + gap;
      shelfHeight = 0;
    }
    obj.set({ left: startX + x, top: startY + y } as any);
    obj.setCoords();
    shelfHeight = Math.max(shelfHeight, h);
    x += w + gap;
  });
}

export function arrangeGrid(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const gap = 20;
  const cols = Math.ceil(Math.sqrt(objects.length));
  const startX = objects[0]?.left ?? 0;
  const startY = objects[0]?.top ?? 0;
  // Find max cell size
  const maxW = Math.max(...objects.map(scaledW));
  const maxH = Math.max(...objects.map(scaledH));
  objects.forEach((obj, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    obj.set({ left: startX + col * (maxW + gap), top: startY + row * (maxH + gap) } as any);
    obj.setCoords();
  });
}

export function arrangeRow(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const gap = 20;
  const sorted = [...objects].sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  const startY = sorted[0]?.top ?? 0;
  let x = sorted[0]?.left ?? 0;
  sorted.forEach((obj) => {
    obj.set({ left: x, top: startY } as any);
    obj.setCoords();
    x += scaledW(obj) + gap;
  });
}

export function arrangeColumn(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const gap = 20;
  const sorted = [...objects].sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
  const startX = sorted[0]?.left ?? 0;
  let y = sorted[0]?.top ?? 0;
  sorted.forEach((obj) => {
    obj.set({ left: startX, top: y } as any);
    obj.setCoords();
    y += scaledH(obj) + gap;
  });
}

export function stackObjects(objects: FabricObject[]) {
  if (objects.length < 2) return;
  const cx = objects.reduce((s, o) => s + (o.left ?? 0) + scaledW(o) / 2, 0) / objects.length;
  const cy = objects.reduce((s, o) => s + (o.top ?? 0) + scaledH(o) / 2, 0) / objects.length;
  objects.forEach((o) => {
    o.set({ left: cx - scaledW(o) / 2, top: cy - scaledH(o) / 2 } as any);
    o.setCoords();
  });
}

export function arrangeByName(objects: FabricObject[]) {
  const sorted = [...objects].sort((a, b) =>
    ((a as any).name || '').localeCompare((b as any).name || '')
  );
  layoutAsGrid(sorted);
}

export function arrangeByZOrder(objects: FabricObject[], canvasObjects: FabricObject[]) {
  // Sort by z-order (position in canvas.getObjects())
  const indexMap = new Map(canvasObjects.map((o, i) => [o, i]));
  const sorted = [...objects].sort((a, b) => (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0));
  layoutAsGrid(sorted);
}

export function arrangeRandomly(objects: FabricObject[]) {
  if (objects.length < 2) return;
  // Get bounding box of current positions
  const minX = Math.min(...objects.map((o) => o.left ?? 0));
  const minY = Math.min(...objects.map((o) => o.top ?? 0));
  const maxX = Math.max(...objects.map((o) => (o.left ?? 0) + scaledW(o)));
  const maxY = Math.max(...objects.map((o) => (o.top ?? 0) + scaledH(o)));
  objects.forEach((o) => {
    o.set({
      left: minX + Math.random() * (maxX - minX - scaledW(o)),
      top: minY + Math.random() * (maxY - minY - scaledH(o)),
    } as any);
    o.setCoords();
  });
}

function layoutAsGrid(sorted: FabricObject[]) {
  if (sorted.length < 2) return;
  const gap = 20;
  const cols = Math.ceil(Math.sqrt(sorted.length));
  const startX = sorted[0]?.left ?? 0;
  const startY = sorted[0]?.top ?? 0;
  const maxW = Math.max(...sorted.map(scaledW));
  const maxH = Math.max(...sorted.map(scaledH));
  sorted.forEach((obj, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    obj.set({ left: startX + col * (maxW + gap), top: startY + row * (maxH + gap) } as any);
    obj.setCoords();
  });
}

// ─── Flip ───

export function flipHorizontal(objects: FabricObject[]) {
  objects.forEach((o) => { o.set({ flipX: !o.flipX } as any); o.setCoords(); });
}

export function flipVertical(objects: FabricObject[]) {
  objects.forEach((o) => { o.set({ flipY: !o.flipY } as any); o.setCoords(); });
}

// ─── Transform ───

export function resetTransform(objects: FabricObject[]) {
  objects.forEach((o) => {
    o.set({
      scaleX: 1, scaleY: 1, angle: 0,
      skewX: 0, skewY: 0, flipX: false, flipY: false,
    } as any);
    o.setCoords();
  });
}

// ─── Grayscale ───

export function toggleGrayscale(objects: FabricObject[]) {
  objects.forEach((o) => {
    if (o.type !== 'image') return;
    const img = o as any;
    if (!img.filters) img.filters = [];
    // Check if grayscale filter already applied
    const idx = img.filters.findIndex((f: any) => f?.type === 'Grayscale');
    if (idx >= 0) {
      img.filters.splice(idx, 1);
    } else {
      // Dynamically access Grayscale filter from Fabric
      const fabric = (window as any).fabric;
      if (fabric?.filters?.Grayscale) {
        img.filters.push(new fabric.filters.Grayscale());
      }
    }
    img.applyFilters?.();
  });
}

// ─── Lock ───

export function toggleLocked(objects: FabricObject[]) {
  objects.forEach((o) => {
    const isLocked = !o.selectable;
    o.set({
      selectable: isLocked,
      evented: isLocked,
    } as any);
  });
}

// ─── Overlay / Compare ───

export function overlayCompare(objects: FabricObject[]) {
  if (objects.length < 2) return;
  // If all are at 0.5 opacity, restore to 1; otherwise set to 0.5 and center-stack
  const allHalf = objects.every((o) => Math.abs((o.opacity ?? 1) - 0.5) < 0.05);
  if (allHalf) {
    objects.forEach((o) => { o.set({ opacity: 1 } as any); });
  } else {
    const cx = objects.reduce((s, o) => s + (o.left ?? 0) + scaledW(o) / 2, 0) / objects.length;
    const cy = objects.reduce((s, o) => s + (o.top ?? 0) + scaledH(o) / 2, 0) / objects.length;
    objects.forEach((o) => {
      o.set({
        opacity: 0.5,
        left: cx - scaledW(o) / 2,
        top: cy - scaledH(o) / 2,
      } as any);
      o.setCoords();
    });
  }
}
