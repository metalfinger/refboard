/**
 * Canvas operations — pure functions for alignment, arrangement, normalize, flip, etc.
 * Each mutates item.data in place and syncs the displayObject. Caller should trigger
 * any needed re-render or persistence.
 */

import { getItemWorldBounds, type SceneItem } from './SceneManager';
import type { ImageObject } from './scene-format';
import { ColorMatrixFilter } from 'pixi.js';
import { applyImageDisplayTransform, getImageDisplayTransform } from './imageTransforms';

// ─── Helpers ───

/** Items with fixed dimensions — scale must stay at 1. */
function isFixedSize(item: SceneItem): boolean {
  return item.type === 'markdown' || item.type === 'sticky';
}

function scaledW(item: SceneItem): number {
  return getItemWorldBounds(item).w;
}

function scaledH(item: SceneItem): number {
  return getItemWorldBounds(item).h;
}

function bounds(item: SceneItem) {
  return getItemWorldBounds(item);
}

function moveVisibleTopLeftTo(item: SceneItem, x: number, y: number): void {
  const b = bounds(item);
  item.data.x += x - b.x;
  item.data.y += y - b.y;
  syncPosition(item);
}

function moveVisibleCenterTo(item: SceneItem, cx: number, cy: number): void {
  const b = bounds(item);
  moveVisibleTopLeftTo(item, cx - b.w / 2, cy - b.h / 2);
}

// ─── Animated position sync ───

let _animTargets = new Map<SceneItem, { startX: number; startY: number; endX: number; endY: number; t: number }>();
let _animRaf = 0;
let _animCallback: ((items: SceneItem[]) => void) | null = null;
const ANIM_DURATION = 320; // ms
const ANIM_STEP = 1000 / 60;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function _animTick() {
  const dt = ANIM_STEP / ANIM_DURATION;
  let done = true;

  for (const [item, anim] of _animTargets) {
    anim.t = Math.min(1, anim.t + dt);
    const e = easeOutCubic(anim.t);
    item.displayObject.position.set(
      anim.startX + (anim.endX - anim.startX) * e,
      anim.startY + (anim.endY - anim.startY) * e,
    );
    if (anim.t < 1) done = false;
  }

  if (!done) {
    _animRaf = requestAnimationFrame(_animTick);
  } else {
    // Snap to final positions and clean up
    for (const [item, anim] of _animTargets) {
      item.displayObject.position.set(anim.endX, anim.endY);
    }
    const items = Array.from(_animTargets.keys());
    _animTargets.clear();
    _animRaf = 0;
    _animCallback?.(items);
  }
}

/** Sync displayObject position from item.data with smooth animation. */
function syncPosition(item: SceneItem): void {
  const target = item.type === 'image'
    ? getImageDisplayTransform(item.data as ImageObject)
    : { x: item.data.x, y: item.data.y };
  _animTargets.set(item, {
    startX: item.displayObject.x,
    startY: item.displayObject.y,
    endX: target.x,
    endY: target.y,
    t: 0,
  });
  if (!_animRaf) {
    _animRaf = requestAnimationFrame(_animTick);
  }
}

/**
 * Register a callback that fires once when the current arrangement animation finishes.
 * Use this to persist/broadcast final positions.
 */
export function onArrangeAnimationDone(cb: (items: SceneItem[]) => void): void {
  _animCallback = cb;
}

/** Sync displayObject scale from item.data. */
function syncScale(item: SceneItem): void {
  if (item.type === 'image') {
    const t = getImageDisplayTransform(item.data as ImageObject);
    item.displayObject.scale.set(t.scaleX, t.scaleY);
    item.displayObject.angle = t.angle;
    return;
  }
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
  const minLeft = Math.min(...objects.map((item) => bounds(item).x));
  objects.forEach((item) => {
    moveVisibleTopLeftTo(item, minLeft, bounds(item).y);
  });
}

export function alignRight(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const maxRight = Math.max(...objects.map((item) => {
    const b = bounds(item);
    return b.x + b.w;
  }));
  objects.forEach((item) => {
    moveVisibleTopLeftTo(item, maxRight - scaledW(item), bounds(item).y);
  });
}

export function alignTop(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const minTop = Math.min(...objects.map((item) => bounds(item).y));
  objects.forEach((item) => {
    moveVisibleTopLeftTo(item, bounds(item).x, minTop);
  });
}

export function alignBottom(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const maxBottom = Math.max(...objects.map((item) => {
    const b = bounds(item);
    return b.y + b.h;
  }));
  objects.forEach((item) => {
    moveVisibleTopLeftTo(item, bounds(item).x, maxBottom - scaledH(item));
  });
}

// ─── Distribution ───

/** Distribute horizontally: normalize all to same height, then space evenly in a row. */
export function distributeHorizontal(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  // Normalize heights first (uniform row)
  normalizeHeight(objects);
  // Then arrange as row with even spacing
  const gap = 20;
  const sorted = [...objects].sort((a, b) => bounds(a).x - bounds(b).x);
  let x = 0;
  sorted.forEach((item) => {
    moveVisibleTopLeftTo(item, startX + x, startY);
    x += scaledW(item) + gap;
  });
}

/** Distribute vertically: normalize all to same width, then space evenly in a column. */
export function distributeVertical(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  // Normalize widths first (uniform column)
  normalizeWidth(objects);
  // Then arrange as column with even spacing
  const gap = 20;
  const sorted = [...objects].sort((a, b) => bounds(a).y - bounds(b).y);
  let y = 0;
  sorted.forEach((item) => {
    moveVisibleTopLeftTo(item, startX, startY + y);
    y += scaledH(item) + gap;
  });
}

// ─── Normalize ───

export function normalizeSize(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const scalable = objects.filter(i => !isFixedSize(i));
  if (scalable.length < 2) return;
  const areas = scalable.map((item) => scaledW(item) * scaledH(item));
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  scalable.forEach((item) => {
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
  const scalable = objects.filter(i => !isFixedSize(i));
  if (scalable.length < 2) return;
  const avgSX = scalable.reduce((s, item) => s + item.data.sx, 0) / scalable.length;
  const avgSY = scalable.reduce((s, item) => s + item.data.sy, 0) / scalable.length;
  scalable.forEach((item) => {
    item.data.sx = avgSX;
    item.data.sy = avgSY;
    syncScale(item);
  });
}

export function normalizeHeight(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const scalable = objects.filter(i => !isFixedSize(i));
  if (scalable.length < 2) return;
  const avgH = scalable.reduce((s, item) => s + scaledH(item), 0) / scalable.length;
  scalable.forEach((item) => {
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
  const scalable = objects.filter(i => !isFixedSize(i));
  if (scalable.length < 2) return;
  const avgW = scalable.reduce((s, item) => s + scaledW(item), 0) / scalable.length;
  scalable.forEach((item) => {
    const w = scaledW(item);
    if (w <= 0) return;
    const ratio = avgW / w;
    item.data.sx *= ratio;
    item.data.sy *= ratio;
    syncScale(item);
  });
}

// ─── Arrangement ───

/** Get the top-left corner of the bounding box of all items. */
function anchorTopLeft(objects: SceneItem[]): { x: number; y: number } {
  return {
    x: Math.min(...objects.map((item) => bounds(item).x)),
    y: Math.min(...objects.map((item) => bounds(item).y)),
  };
}

export function arrangeOptimal(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  // Shelf-based bin packing, sorted by height descending
  const sorted = [...objects].sort((a, b) => scaledH(b) - scaledH(a));
  const gap = 10;
  const totalArea = sorted.reduce((s, item) => s + scaledW(item) * scaledH(item), 0);
  const shelfWidth = Math.sqrt(totalArea) * 1.3;
  let x = 0, y = 0, shelfHeight = 0;
  sorted.forEach((item) => {
    const w = scaledW(item);
    const h = scaledH(item);
    if (x + w > shelfWidth && x > 0) {
      x = 0;
      y += shelfHeight + gap;
      shelfHeight = 0;
    }
    moveVisibleTopLeftTo(item, startX + x, startY + y);
    shelfHeight = Math.max(shelfHeight, h);
    x += w + gap;
  });
}

export function arrangeGrid(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  const gap = 20;
  const cols = Math.ceil(Math.sqrt(objects.length));
  const maxW = Math.max(...objects.map(scaledW));
  const maxH = Math.max(...objects.map(scaledH));
  objects.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    moveVisibleTopLeftTo(item, startX + col * (maxW + gap), startY + row * (maxH + gap));
  });
}

export function arrangeRow(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  const sorted = [...objects].sort((a, b) => bounds(a).x - bounds(b).x);
  const gap = 20;
  let x = 0;
  sorted.forEach((item) => {
    moveVisibleTopLeftTo(item, startX + x, startY);
    x += scaledW(item) + gap;
  });
}

export function arrangeColumn(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  const sorted = [...objects].sort((a, b) => bounds(a).y - bounds(b).y);
  const gap = 20;
  let y = 0;
  sorted.forEach((item) => {
    moveVisibleTopLeftTo(item, startX, startY + y);
    y += scaledH(item) + gap;
  });
}

export function stackObjects(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const cx = objects.reduce((s, item) => {
    const b = bounds(item);
    return s + b.x + b.w / 2;
  }, 0) / objects.length;
  const cy = objects.reduce((s, item) => {
    const b = bounds(item);
    return s + b.y + b.h / 2;
  }, 0) / objects.length;
  objects.forEach((item) => {
    moveVisibleCenterTo(item, cx, cy);
  });
}

export function arrangeByName(objects: SceneItem[]) {
  const sorted = [...objects].sort((a, b) =>
    (a.data.name || '').localeCompare(b.data.name || '')
  );
  layoutAsGrid(sorted, anchorTopLeft(objects));
}

export function arrangeByZOrder(objects: SceneItem[]) {
  const sorted = [...objects].sort((a, b) => a.data.z - b.data.z);
  layoutAsGrid(sorted, anchorTopLeft(objects));
}

export function arrangeRandomly(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const { x: startX, y: startY } = anchorTopLeft(objects);
  // Compute spread area based on total content size
  const totalW = objects.reduce((s, item) => s + scaledW(item), 0);
  const totalH = objects.reduce((s, item) => s + scaledH(item), 0);
  const spreadW = Math.sqrt(totalW * totalH) * 1.5;
  const spreadH = spreadW;
  objects.forEach((item) => {
    moveVisibleTopLeftTo(item, startX + Math.random() * spreadW, startY + Math.random() * spreadH);
  });
}

function layoutAsGrid(sorted: SceneItem[], anchor: { x: number; y: number }) {
  if (sorted.length < 2) return;
  const gap = 20;
  const cols = Math.ceil(Math.sqrt(sorted.length));
  const maxW = Math.max(...sorted.map(scaledW));
  const maxH = Math.max(...sorted.map(scaledH));
  sorted.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    moveVisibleTopLeftTo(item, anchor.x + col * (maxW + gap), anchor.y + row * (maxH + gap));
  });
}

// ─── Flip ───

export function flipHorizontal(objects: SceneItem[]) {
  objects.forEach((item) => {
    if (isFixedSize(item)) return;
    item.data.flipX = !item.data.flipX;
    if (item.type === 'image') {
      applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
    } else {
      item.displayObject.scale.x = item.data.sx * (item.data.flipX ? -1 : 1);
    }
  });
}

export function flipVertical(objects: SceneItem[]) {
  objects.forEach((item) => {
    if (isFixedSize(item)) return;
    item.data.flipY = !item.data.flipY;
    if (item.type === 'image') {
      applyImageDisplayTransform(item.displayObject, item.data as ImageObject);
    } else {
      item.displayObject.scale.y = item.data.sy * (item.data.flipY ? -1 : 1);
    }
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

// ─── Nudge ───

export function nudge(objects: SceneItem[], dx: number, dy: number) {
  objects.forEach((item) => {
    item.data.x += dx;
    item.data.y += dy;
    syncPosition(item);
  });
}

// ─── Scale (relative) ───

export function scaleBy(objects: SceneItem[], factor: number) {
  objects.forEach((item) => {
    const b = bounds(item);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    item.data.sx *= factor;
    item.data.sy *= factor;
    const nextBounds = bounds(item);
    item.data.x += cx - (nextBounds.x + nextBounds.w / 2);
    item.data.y += cy - (nextBounds.y + nextBounds.h / 2);
    syncTransform(item);
  });
}

// ─── Rotate (quick 90° snap) ───

export function rotate90(objects: SceneItem[], clockwise: boolean) {
  objects.forEach((item) => {
    item.data.angle = ((item.data.angle + (clockwise ? 90 : -90)) % 360 + 360) % 360;
    if (item.type === 'image') {
      const t = getImageDisplayTransform(item.data as ImageObject);
      item.displayObject.angle = t.angle;
      item.displayObject.scale.set(t.scaleX, t.scaleY);
    } else {
      item.displayObject.angle = item.data.angle;
    }
  });
}

// ─── Set Opacity ───

export function setOpacity(objects: SceneItem[], opacity: number) {
  const clamped = Math.max(0, Math.min(1, opacity));
  objects.forEach((item) => {
    item.data.opacity = clamped;
    item.displayObject.alpha = clamped;
  });
}

// ─── Align Center ───

export function alignCenterH(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const avgCX = objects.reduce((s, item) => {
    const b = bounds(item);
    return s + b.x + b.w / 2;
  }, 0) / objects.length;
  objects.forEach((item) => {
    moveVisibleCenterTo(item, avgCX, bounds(item).y + bounds(item).h / 2);
  });
}

export function alignCenterV(objects: SceneItem[]) {
  if (objects.length < 2) return;
  const avgCY = objects.reduce((s, item) => {
    const b = bounds(item);
    return s + b.y + b.h / 2;
  }, 0) / objects.length;
  objects.forEach((item) => {
    moveVisibleCenterTo(item, bounds(item).x + bounds(item).w / 2, avgCY);
  });
}

// ─── Equal Spacing ───

export function equalSpacingH(objects: SceneItem[], gap = 20) {
  if (objects.length < 2) return;
  const sorted = [...objects].sort((a, b) => bounds(a).x - bounds(b).x);
  const first = bounds(sorted[0]);
  let x = first.x + first.w + gap;
  for (let i = 1; i < sorted.length; i++) {
    moveVisibleTopLeftTo(sorted[i], x, bounds(sorted[i]).y);
    x += scaledW(sorted[i]) + gap;
  }
}

export function equalSpacingV(objects: SceneItem[], gap = 20) {
  if (objects.length < 2) return;
  const sorted = [...objects].sort((a, b) => bounds(a).y - bounds(b).y);
  const first = bounds(sorted[0]);
  let y = first.y + first.h + gap;
  for (let i = 1; i < sorted.length; i++) {
    moveVisibleTopLeftTo(sorted[i], bounds(sorted[i]).x, y);
    y += scaledH(sorted[i]) + gap;
  }
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
    const cx = objects.reduce((s, item) => {
      const b = bounds(item);
      return s + b.x + b.w / 2;
    }, 0) / objects.length;
    const cy = objects.reduce((s, item) => {
      const b = bounds(item);
      return s + b.y + b.h / 2;
    }, 0) / objects.length;
    objects.forEach((item) => {
      item.data.opacity = 0.5;
      item.displayObject.alpha = 0.5;
      moveVisibleCenterTo(item, cx, cy);
    });
  }
}
