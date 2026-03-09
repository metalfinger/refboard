/**
 * Canvas operations — pure functions for alignment, arrangement, normalize, flip, etc.
 * Each mutates item.data in place and syncs the displayObject. Caller should trigger
 * any needed re-render or persistence.
 */

import type { SceneItem } from './SceneManager';
import type { ImageObject } from './scene-format';
import { ColorMatrixFilter } from 'pixi.js';

// ─── Helpers ───

function scaledW(item: SceneItem): number {
  return item.data.w * item.data.sx;
}

function scaledH(item: SceneItem): number {
  return item.data.h * item.data.sy;
}

/** Sync displayObject position from item.data. */
function syncPosition(item: SceneItem): void {
  item.displayObject.position.set(item.data.x, item.data.y);
}

/** Sync displayObject scale from item.data. */
function syncScale(item: SceneItem): void {
  item.displayObject.scale.set(item.data.sx, item.data.sy);
}

/** Sync both position and scale. */
function syncTransform(item: SceneItem): void {
  syncPosition(item);
  syncScale(item);
  item.displayObject.angle = item.data.angle;
}

// ─── Alignment ───

export function alignLeft(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const minLeft = Math.min(...objects.map((item) => item.data.x));
  objects.forEach((item) => {
    item.data.x = minLeft;
    syncPosition(item);
  });
}

export function alignRight(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const maxRight = Math.max(...objects.map((item) => item.data.x + scaledW(item)));
  objects.forEach((item) => {
    item.data.x = maxRight - scaledW(item);
    syncPosition(item);
  });
}

export function alignTop(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const minTop = Math.min(...objects.map((item) => item.data.y));
  objects.forEach((item) => {
    item.data.y = minTop;
    syncPosition(item);
  });
}

export function alignBottom(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const maxBottom = Math.max(...objects.map((item) => item.data.y + scaledH(item)));
  objects.forEach((item) => {
    item.data.y = maxBottom - scaledH(item);
    syncPosition(item);
  });
}

// ─── Distribution ───

export function distributeHorizontal(objects: SceneItem[]) {
  if (objects.length < 3) return;
  const sorted = [...objects].sort((a, b) => a.data.x - b.data.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = last.data.x + scaledW(last) - first.data.x;
  const totalWidth = sorted.reduce((s, item) => s + scaledW(item), 0);
  const gap = (totalSpan - totalWidth) / (sorted.length - 1);
  let x = first.data.x + scaledW(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    sorted[i].data.x = x;
    syncPosition(sorted[i]);
    x += scaledW(sorted[i]) + gap;
  }
}

export function distributeVertical(objects: SceneItem[]) {
  if (objects.length < 3) return;
  const sorted = [...objects].sort((a, b) => a.data.y - b.data.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = last.data.y + scaledH(last) - first.data.y;
  const totalHeight = sorted.reduce((s, item) => s + scaledH(item), 0);
  const gap = (totalSpan - totalHeight) / (sorted.length - 1);
  let y = first.data.y + scaledH(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    sorted[i].data.y = y;
    syncPosition(sorted[i]);
    y += scaledH(sorted[i]) + gap;
  }
}

// ─── Normalize ───

export function normalizeSize(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const areas = objects.map((item) => scaledW(item) * scaledH(item));
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  objects.forEach((item) => {
    const currentArea = scaledW(item) * scaledH(item);
    if (currentArea <= 0) return;
    const ratio = Math.sqrt(avgArea / currentArea);
    item.data.sx *= ratio;
    item.data.sy *= ratio;
    syncScale(item);
  });
}

export function normalizeScale(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const avgSX = objects.reduce((s, item) => s + item.data.sx, 0) / objects.length;
  const avgSY = objects.reduce((s, item) => s + item.data.sy, 0) / objects.length;
  objects.forEach((item) => {
    item.data.sx = avgSX;
    item.data.sy = avgSY;
    syncScale(item);
  });
}

export function normalizeHeight(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const avgH = objects.reduce((s, item) => s + scaledH(item), 0) / objects.length;
  objects.forEach((item) => {
    const h = scaledH(item);
    if (h <= 0) return;
    const ratio = avgH / h;
    item.data.sx *= ratio;
    item.data.sy *= ratio;
    syncScale(item);
  });
}

export function normalizeWidth(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const avgW = objects.reduce((s, item) => s + scaledW(item), 0) / objects.length;
  objects.forEach((item) => {
    const w = scaledW(item);
    if (w <= 0) return;
    const ratio = avgW / w;
    item.data.sx *= ratio;
    item.data.sy *= ratio;
    syncScale(item);
  });
}

// ─── Arrangement ───

export function arrangeOptimal(objects: SceneItem[]) {
  if (objects.length < 2) return;
  // Shelf-based bin packing, sorted by height descending
  const sorted = [...objects].sort((a, b) => scaledH(b) - scaledH(a));
  const gap = 10;
  const totalArea = sorted.reduce((s, item) => s + scaledW(item) * scaledH(item), 0);
  const shelfWidth = Math.sqrt(totalArea) * 1.3;
  const startX = sorted[0].data.x;
  const startY = sorted[0].data.y;
  let x = 0, y = 0, shelfHeight = 0;
  sorted.forEach((item) => {
    const w = scaledW(item);
    const h = scaledH(item);
    if (x + w > shelfWidth && x > 0) {
      x = 0;
      y += shelfHeight + gap;
      shelfHeight = 0;
    }
    item.data.x = startX + x;
    item.data.y = startY + y;
    syncPosition(item);
    shelfHeight = Math.max(shelfHeight, h);
    x += w + gap;
  });
}

export function arrangeGrid(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const gap = 20;
  const cols = Math.ceil(Math.sqrt(objects.length));
  const startX = objects[0].data.x;
  const startY = objects[0].data.y;
  const maxW = Math.max(...objects.map(scaledW));
  const maxH = Math.max(...objects.map(scaledH));
  objects.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    item.data.x = startX + col * (maxW + gap);
    item.data.y = startY + row * (maxH + gap);
    syncPosition(item);
  });
}

export function arrangeRow(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const gap = 20;
  const sorted = [...objects].sort((a, b) => a.data.x - b.data.x);
  const startY = sorted[0].data.y;
  let x = sorted[0].data.x;
  sorted.forEach((item) => {
    item.data.x = x;
    item.data.y = startY;
    syncPosition(item);
    x += scaledW(item) + gap;
  });
}

export function arrangeColumn(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const gap = 20;
  const sorted = [...objects].sort((a, b) => a.data.y - b.data.y);
  const startX = sorted[0].data.x;
  let y = sorted[0].data.y;
  sorted.forEach((item) => {
    item.data.x = startX;
    item.data.y = y;
    syncPosition(item);
    y += scaledH(item) + gap;
  });
}

export function stackObjects(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const cx = objects.reduce((s, item) => s + item.data.x + scaledW(item) / 2, 0) / objects.length;
  const cy = objects.reduce((s, item) => s + item.data.y + scaledH(item) / 2, 0) / objects.length;
  objects.forEach((item) => {
    item.data.x = cx - scaledW(item) / 2;
    item.data.y = cy - scaledH(item) / 2;
    syncPosition(item);
  });
}

export function arrangeByName(objects: SceneItem[]) {
  const sorted = [...objects].sort((a, b) =>
    (a.data.name || '').localeCompare(b.data.name || '')
  );
  layoutAsGrid(sorted);
}

export function arrangeByZOrder(objects: SceneItem[]) {
  // Sort by z-order stored in item.data.z
  const sorted = [...objects].sort((a, b) => a.data.z - b.data.z);
  layoutAsGrid(sorted);
}

export function arrangeRandomly(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const minX = Math.min(...objects.map((item) => item.data.x));
  const minY = Math.min(...objects.map((item) => item.data.y));
  const maxX = Math.max(...objects.map((item) => item.data.x + scaledW(item)));
  const maxY = Math.max(...objects.map((item) => item.data.y + scaledH(item)));
  objects.forEach((item) => {
    item.data.x = minX + Math.random() * (maxX - minX - scaledW(item));
    item.data.y = minY + Math.random() * (maxY - minY - scaledH(item));
    syncPosition(item);
  });
}

function layoutAsGrid(sorted: SceneItem[]) {
  if (sorted.length < 2) return;
  const gap = 20;
  const cols = Math.ceil(Math.sqrt(sorted.length));
  const startX = sorted[0].data.x;
  const startY = sorted[0].data.y;
  const maxW = Math.max(...sorted.map(scaledW));
  const maxH = Math.max(...sorted.map(scaledH));
  sorted.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    item.data.x = startX + col * (maxW + gap);
    item.data.y = startY + row * (maxH + gap);
    syncPosition(item);
  });
}

// ─── Flip ───

export function flipHorizontal(objects: SceneItem[]) {
  objects.forEach((item) => {
    item.data.flipX = !item.data.flipX;
    item.displayObject.scale.x = item.data.sx * (item.data.flipX ? -1 : 1);
  });
}

export function flipVertical(objects: SceneItem[]) {
  objects.forEach((item) => {
    item.data.flipY = !item.data.flipY;
    item.displayObject.scale.y = item.data.sy * (item.data.flipY ? -1 : 1);
  });
}

// ─── Transform ───

export function resetTransform(objects: SceneItem[]) {
  objects.forEach((item) => {
    item.data.sx = 1;
    item.data.sy = 1;
    item.data.angle = 0;
    item.data.flipX = false;
    item.data.flipY = false;
    syncTransform(item);
  });
}

// ─── Grayscale ───

export function toggleGrayscale(objects: SceneItem[]) {
  objects.forEach((item) => {
    if (item.type !== 'image') return;
    const imgData = item.data as ImageObject;
    const obj = item.displayObject;

    // Check if a desaturate filter is already applied
    const hasGrayscale = imgData.filters.includes('Grayscale');

    if (hasGrayscale) {
      // Remove grayscale: clear the ColorMatrixFilter and remove from data
      imgData.filters = imgData.filters.filter((f) => f !== 'Grayscale');
      obj.filters = (obj.filters || []).filter((f) => !(f instanceof ColorMatrixFilter));
    } else {
      // Add grayscale
      imgData.filters.push('Grayscale');
      const filter = new ColorMatrixFilter();
      filter.desaturate();
      obj.filters = [...(obj.filters || []), filter];
    }
  });
}

// ─── Lock ───

export function toggleLocked(objects: SceneItem[]) {
  objects.forEach((item) => {
    item.data.locked = !item.data.locked;
    item.displayObject.eventMode = item.data.locked ? 'none' : 'static';
  });
}

// ─── Overlay / Compare ───

export function overlayCompare(objects: SceneItem[]) {
  if (objects.length < 2) return;
  // If all are at 0.5 opacity, restore to 1; otherwise set to 0.5 and center-stack
  const allHalf = objects.every((item) => Math.abs(item.data.opacity - 0.5) < 0.05);
  if (allHalf) {
    objects.forEach((item) => {
      item.data.opacity = 1;
      item.displayObject.alpha = 1;
    });
  } else {
    const cx = objects.reduce((s, item) => s + item.data.x + scaledW(item) / 2, 0) / objects.length;
    const cy = objects.reduce((s, item) => s + item.data.y + scaledH(item) / 2, 0) / objects.length;
    objects.forEach((item) => {
      item.data.opacity = 0.5;
      item.data.x = cx - scaledW(item) / 2;
      item.data.y = cy - scaledH(item) / 2;
      item.displayObject.alpha = 0.5;
      syncPosition(item);
    });
  }
}
