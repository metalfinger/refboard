import type { SceneManager } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';

/**
 * Compute the world-space position for a point-pinned anchor.
 * Returns null if the target object no longer exists in the scene.
 */
export function getPointAnchorWorld(
  scene: SceneManager,
  objectId: string,
  pinX: number,
  pinY: number,
): { x: number; y: number } | null {
  const item = scene.items.get(objectId);
  if (!item) return null;
  const b = getItemWorldBounds(item);
  return { x: b.x + pinX * b.w, y: b.y + pinY * b.h };
}

/**
 * Compute the world-space position for an object-level anchor.
 * Default position: top-right corner (90% x, 0% y).
 */
export function getObjectAnchorWorld(
  scene: SceneManager,
  objectId: string,
): { x: number; y: number } | null {
  const item = scene.items.get(objectId);
  if (!item) return null;
  const b = getItemWorldBounds(item);
  return { x: b.x + b.w * 0.9, y: b.y };
}

/**
 * Compute anchor world position for a thread (point or object anchor).
 * This is the unified entry point — replaces PinOverlay._getAnchorWorld().
 */
export function getThreadAnchorWorld(
  scene: SceneManager,
  thread: { object_id: string; anchor_type: string; pin_x: number | null; pin_y: number | null },
): { x: number; y: number } | null {
  if (thread.anchor_type === 'point' && thread.pin_x != null && thread.pin_y != null) {
    return getPointAnchorWorld(scene, thread.object_id, thread.pin_x, thread.pin_y);
  }
  return getObjectAnchorWorld(scene, thread.object_id);
}
