import type { SceneManager, SceneItem } from './SceneManager';
import { getItemWorldBounds } from './SceneManager';
import type { GroupObject } from './scene-format';

export interface ReviewTarget {
  objectId: string;
  objectType: string;
  worldX: number;
  worldY: number;
  pinX: number;
  pinY: number;
}

/**
 * Returns true if the item is a valid target for comment attachment.
 * Groups are NOT commentable — comments should attach to stable children.
 */
export function isCommentableObject(item: SceneItem): boolean {
  if (item.data.type === 'group') return false;
  if (!item.data.visible) return false;
  return true;
}

/**
 * Point-in-bounds test using world-space coordinates.
 */
function pointInBounds(
  wx: number,
  wy: number,
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
}

/**
 * Resolve the deepest commentable child inside a group under the given world point.
 * Walks children in front-to-back order (highest z first) and recurses into nested groups.
 */
function resolveGroupChild(
  scene: SceneManager,
  group: SceneItem,
  worldX: number,
  worldY: number,
): SceneItem | null {
  const groupData = group.data as GroupObject;

  // Collect children that exist in the scene, sorted front-to-back (highest z first)
  const children: SceneItem[] = [];
  for (const childId of groupData.children) {
    const child = scene.getById(childId);
    if (child) children.push(child);
  }
  children.sort((a, b) => (b.data.z || 0) - (a.data.z || 0));

  for (const child of children) {
    if (!child.data.visible) continue;
    const bounds = getItemWorldBounds(child);
    if (!pointInBounds(worldX, worldY, bounds)) continue;

    // Nested group — recurse
    if (child.data.type === 'group') {
      const nested = resolveGroupChild(scene, child, worldX, worldY);
      if (nested) return nested;
      // No valid child inside nested group under this point — skip
      continue;
    }

    // Found a commentable child
    if (isCommentableObject(child)) return child;
  }

  return null;
}

/**
 * Resolve a world-space click into a valid review anchor target.
 *
 * - If the topmost hit is a commentable non-group object, returns it.
 * - If the topmost hit is a group, descends into children to find the deepest
 *   valid child under the click point.
 * - Returns null if no valid target exists (empty space, group with no child
 *   under the cursor, etc.)
 *
 * @param clickRadius - World-space radius for forgiving hit detection
 */
export function resolveReviewTargetAtPoint(params: {
  scene: SceneManager;
  worldX: number;
  worldY: number;
  clickRadius: number;
}): ReviewTarget | null {
  const { scene, worldX, worldY, clickRadius } = params;

  // Query spatial grid with a small radius for forgiving click detection
  const hitItems = scene.queryRegion(
    worldX - clickRadius,
    worldY - clickRadius,
    clickRadius * 2,
    clickRadius * 2,
  );

  if (hitItems.length === 0) return null;

  // Sort topmost first (highest z)
  hitItems.sort((a, b) => (b.data.z || 0) - (a.data.z || 0));

  for (const item of hitItems) {
    if (!item.data.visible) continue;

    // If it's a group, try to resolve to a child
    if (item.data.type === 'group') {
      const child = resolveGroupChild(scene, item, worldX, worldY);
      if (child) return buildTarget(child, worldX, worldY);
      // No valid child under point — continue checking other hits
      continue;
    }

    // Non-group: check if commentable
    if (isCommentableObject(item)) {
      return buildTarget(item, worldX, worldY);
    }
  }

  return null;
}

/**
 * Build a ReviewTarget from a resolved SceneItem and the click point.
 */
function buildTarget(item: SceneItem, worldX: number, worldY: number): ReviewTarget {
  const bounds = getItemWorldBounds(item);
  const pinX = bounds.w > 0 ? Math.max(0, Math.min(1, (worldX - bounds.x) / bounds.w)) : 0.5;
  const pinY = bounds.h > 0 ? Math.max(0, Math.min(1, (worldY - bounds.y) / bounds.h)) : 0.5;

  return {
    objectId: item.id,
    objectType: item.data.type,
    worldX,
    worldY,
    pinX,
    pinY,
  };
}
