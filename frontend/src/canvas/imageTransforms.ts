import type { Container } from 'pixi.js';
import type { CropRect, ImageObject } from './scene-format';

export interface ImageDisplayTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface RectTransformData {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  angle: number;
}

/**
 * Normalize legacy negative image scales into positive scale magnitude plus flip flags.
 * This keeps image scene data canonical while preserving visual orientation.
 */
export function normalizeImageTransformData(data: ImageObject): void {
  if (data.sx < 0) {
    data.sx = Math.abs(data.sx);
    data.flipX = !data.flipX;
  }
  if (data.sy < 0) {
    data.sy = Math.abs(data.sy);
    data.flipY = !data.flipY;
  }
}

/**
 * Compute the actual Pixi display transform for an image from canonical scene data.
 * Images render from a top-left local origin, so flip uses a compensating position
 * shift to keep the visible unrotated bounds anchored at data.x/data.y.
 */
export function getImageDisplayTransform(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY'>): ImageDisplayTransform {
  const sx = Math.abs(data.sx);
  const sy = Math.abs(data.sy);
  const scaleX = sx * (data.flipX ? -1 : 1);
  const scaleY = sy * (data.flipY ? -1 : 1);
  return {
    x: data.x + (data.flipX ? data.w * sx : 0),
    y: data.y + (data.flipY ? data.h * sy : 0),
    scaleX,
    scaleY,
    angle: data.angle,
  };
}

function getVisibleLocalRect(data: Pick<ImageObject, 'w' | 'h' | 'crop'>): { x: number; y: number; w: number; h: number } {
  const crop = data.crop;
  if (!crop) {
    return { x: 0, y: 0, w: data.w, h: data.h };
  }
  return {
    x: crop.x * data.w,
    y: crop.y * data.h,
    w: crop.w * data.w,
    h: crop.h * data.h,
  };
}

export function applyImageDisplayTransform(displayObject: Container, data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY'>): void {
  const t = getImageDisplayTransform(data);
  displayObject.position.set(t.x, t.y);
  displayObject.scale.set(t.scaleX, t.scaleY);
  displayObject.angle = t.angle;
}

function transformLocalPoint(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY'>, localX: number, localY: number): Point2D {
  const t = getImageDisplayTransform(data);
  return transformPoint({ x: localX, y: localY }, {
    x: t.x,
    y: t.y,
    sx: t.scaleX,
    sy: t.scaleY,
    angle: t.angle,
  });
}

export function transformPoint(point: Point2D, transform: Pick<RectTransformData, 'x' | 'y' | 'sx' | 'sy' | 'angle'>): Point2D {
  const rad = (transform.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x * transform.sx;
  const dy = point.y * transform.sy;
  return {
    x: transform.x + dx * cos - dy * sin,
    y: transform.y + dx * sin + dy * cos,
  };
}

export function transformPoints(points: Point2D[], transform: Pick<RectTransformData, 'x' | 'y' | 'sx' | 'sy' | 'angle'>): Point2D[] {
  return points.map((point) => transformPoint(point, transform));
}

export function getRectTransformedCorners(data: RectTransformData): Point2D[] {
  return [
    transformPoint({ x: 0, y: 0 }, data),
    transformPoint({ x: data.w, y: 0 }, data),
    transformPoint({ x: data.w, y: data.h }, data),
    transformPoint({ x: 0, y: data.h }, data),
  ];
}

export function getBoundsFromPoints(points: Point2D[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function offsetImageDataPosition(data: Pick<ImageObject, 'x' | 'y'>, dx: number, dy: number): void {
  data.x += dx;
  data.y += dy;
}

export function getImageTransformedCorners(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): Point2D[] {
  const rect = getVisibleLocalRect(data);
  return [
    transformLocalPoint(data, rect.x, rect.y),
    transformLocalPoint(data, rect.x + rect.w, rect.y),
    transformLocalPoint(data, rect.x + rect.w, rect.y + rect.h),
    transformLocalPoint(data, rect.x, rect.y + rect.h),
  ];
}

export function getImageWorldBounds(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): { x: number; y: number; w: number; h: number } {
  return getBoundsFromPoints(getImageTransformedCorners(data));
}
