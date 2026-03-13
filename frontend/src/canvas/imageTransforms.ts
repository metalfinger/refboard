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

export interface ImageSourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageVisibleFrame {
  sourceRect: ImageSourceRect;
  localRect: ImageLocalRect;
  display: ImageDisplayTransform;
}

export interface ImageLocalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The canonical runtime image model:
 * - `sourceRect` is the sampled rectangle inside the original asset
 * - `localRect` is the visible rendered frame, always rebased to local 0,0
 * - `display` is the final Pixi transform that places that visible frame in world space
 *
 * All image consumers should derive geometry from this model rather than re-deriving
 * crop, flip, and visible bounds independently.
 */

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

export function getImageSourceRect(data: Pick<ImageObject, 'w' | 'h' | 'crop'>): ImageSourceRect {
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

export function getImageVisibleLocalRect(data: Pick<ImageObject, 'w' | 'h' | 'crop'>): ImageLocalRect {
  const sourceRect = getImageSourceRect(data);
  return {
    x: 0,
    y: 0,
    w: sourceRect.w,
    h: sourceRect.h,
  };
}

/**
 * Compute the actual Pixi display transform for an image from canonical scene data.
 * Images render from a top-left local origin, so flip uses a compensating position
 * shift to keep the visible unrotated bounds anchored at data.x/data.y.
 */
export function getImageDisplayTransform(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): ImageDisplayTransform {
  const sx = Math.abs(data.sx);
  const sy = Math.abs(data.sy);
  const visibleRect = getImageVisibleLocalRect(data);
  const scaleX = sx * (data.flipX ? -1 : 1);
  const scaleY = sy * (data.flipY ? -1 : 1);
  return {
    x: data.x + (data.flipX ? visibleRect.w * sx : 0),
    y: data.y + (data.flipY ? visibleRect.h * sy : 0),
    scaleX,
    scaleY,
    angle: data.angle,
  };
}

export function getImageVisibleFrame(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): ImageVisibleFrame {
  return {
    sourceRect: getImageSourceRect(data),
    localRect: getImageVisibleLocalRect(data),
    display: getImageDisplayTransform(data),
  };
}

export function applyImageDisplayTransform(displayObject: Container, data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): void {
  const t = getImageDisplayTransform(data);
  displayObject.position.set(t.x, t.y);
  displayObject.scale.set(t.scaleX, t.scaleY);
  displayObject.angle = t.angle;
}

function transformLocalPoint(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>, localX: number, localY: number): Point2D {
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

export function inverseTransformPoint(point: Point2D, transform: Pick<RectTransformData, 'x' | 'y' | 'sx' | 'sy' | 'angle'>): Point2D {
  const rad = (transform.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const rotatedX = dx * cos + dy * sin;
  const rotatedY = -dx * sin + dy * cos;
  return {
    x: transform.sx === 0 ? 0 : rotatedX / transform.sx,
    y: transform.sy === 0 ? 0 : rotatedY / transform.sy,
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

function getImageLocalPointFromViewNormalized(
  data: Pick<ImageObject, 'w' | 'h' | 'flipX' | 'flipY' | 'crop'>,
  viewX: number,
  viewY: number,
): Point2D {
  const sourceRect = getImageSourceRect(data);
  const sourceX = viewX * data.w;
  const sourceY = viewY * data.h;
  return {
    x: data.flipX ? (sourceRect.x + sourceRect.w) - sourceX : sourceX - sourceRect.x,
    y: data.flipY ? (sourceRect.y + sourceRect.h) - sourceY : sourceY - sourceRect.y,
  };
}

function getImageViewNormalizedFromLocal(
  data: Pick<ImageObject, 'w' | 'h' | 'flipX' | 'flipY' | 'crop'>,
  localX: number,
  localY: number,
): Point2D {
  const sourceRect = getImageSourceRect(data);
  const sourceX = data.flipX ? sourceRect.x + sourceRect.w - localX : sourceRect.x + localX;
  const sourceY = data.flipY ? sourceRect.y + sourceRect.h - localY : sourceRect.y + localY;
  const normX = data.w === 0 ? 0 : sourceX / data.w;
  const normY = data.h === 0 ? 0 : sourceY / data.h;
  return {
    x: data.flipX ? 1 - normX : normX,
    y: data.flipY ? 1 - normY : normY,
  };
}

export function imageViewPointToWorld(
  data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>,
  viewX: number,
  viewY: number,
): Point2D {
  const local = getImageLocalPointFromViewNormalized(data, viewX, viewY);
  return transformLocalPoint(data, local.x, local.y);
}

export function worldToImageViewPoint(
  data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>,
  worldX: number,
  worldY: number,
): Point2D {
  const t = getImageDisplayTransform(data);
  const local = inverseTransformPoint({ x: worldX, y: worldY }, {
    x: t.x,
    y: t.y,
    sx: t.scaleX,
    sy: t.scaleY,
    angle: t.angle,
  });
  return getImageViewNormalizedFromLocal(data, local.x, local.y);
}

export function getImageViewRectWorldCorners(
  data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>,
  rect: CropRect,
): Point2D[] {
  return [
    imageViewPointToWorld(data, rect.x, rect.y),
    imageViewPointToWorld(data, rect.x + rect.w, rect.y),
    imageViewPointToWorld(data, rect.x + rect.w, rect.y + rect.h),
    imageViewPointToWorld(data, rect.x, rect.y + rect.h),
  ];
}

export function getImageVisibleLocalCorners(
  data: Pick<ImageObject, 'w' | 'h' | 'crop'>,
): Point2D[] {
  const rect = getImageVisibleLocalRect(data);
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}

export function getImageTransformedCorners(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): Point2D[] {
  return getImageVisibleLocalCorners(data).map((point) => transformLocalPoint(data, point.x, point.y));
}

export function getImageWorldBounds(data: Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'flipX' | 'flipY' | 'crop'>): { x: number; y: number; w: number; h: number } {
  return getBoundsFromPoints(getImageTransformedCorners(data));
}
