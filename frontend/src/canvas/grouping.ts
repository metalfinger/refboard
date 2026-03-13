/**
 * Grouping module — group/ungroup operations for scene items.
 *
 * Data model:
 *  - Group children store LOCAL x/y (relative to group origin) in data.x/y
 *  - The group's data.x/y is the world-space top-left of the bounding box
 *  - On serialize, children's data.x/y are local coords → correct on reload
 *  - On ungroup, children's data.x/y are converted back to world coords
 */

import type { Viewport } from 'pixi-viewport';
import type { SceneManager, SceneItem } from './SceneManager';
import { getItemWorldBounds, rebuildGroupChildSet } from './SceneManager';
import type { SelectionManager } from './SelectionManager';
import type { GroupObject, ImageObject } from './scene-format';
import { randomFrameColor } from './sprites/FrameSprite';
import { applyImageDisplayTransform, getImageDisplayTransform, getImageVisibleLocalRect, transformPoint } from './imageTransforms';

/**
 * Group selected items into a single group container.
 * Requires at least 2 selected items.
 */
export function groupItems(
  scene: SceneManager,
  selection: SelectionManager,
  onChange: () => void,
): void {
  const selected = selection.getSelectedItems();
  if (selected.length < 2) return;

  // Allow nested groups — groups can contain other groups

  // Compute the bounding box of all selected items
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of selected) {
    const b = getItemWorldBounds(item);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  const groupX = minX;
  const groupY = minY;
  const groupW = maxX - minX;
  const groupH = maxY - minY;

  const groupData: GroupObject = {
    id: crypto.randomUUID(),
    type: 'group',
    x: groupX,
    y: groupY,
    w: groupW,
    h: groupH,
    sx: 1,
    sy: 1,
    angle: 0,
    z: scene.nextZ(),
    opacity: 1,
    locked: false,
    name: '',
    visible: true,
    children: selected.map((s) => s.id),
    bgColor: randomFrameColor(),
    label: '',
    padding: 12,
  };

  // Create the group container
  scene._createItem(groupData, false);
  const groupItem = scene.getById(groupData.id);
  if (!groupItem) return;

  // Reparent each selected item into the group container
  for (const child of selected) {
    const obj = child.displayObject;

    // Convert world position to local (relative to group origin)
    const localX = child.data.x - groupX;
    const localY = child.data.y - groupY;

    // Update DATA to store local coords (critical for serialization)
    child.data.x = localX;
    child.data.y = localY;

    // Reparent display object
    obj.parent?.removeChild(obj);
    groupItem.displayObject.addChild(obj);
    if (child.type === 'image') {
      applyImageDisplayTransform(obj, child.data as ImageObject);
    } else {
      obj.position.set(localX, localY);
    }
  }

  selection.clear();
  selection.selectOnly(groupItem.id);
  rebuildGroupChildSet(scene);
  scene._applyZOrder();
  onChange();
}

/**
 * Ungroup the selected group, reparenting children back to the viewport.
 * Propagates group's scale, angle, and opacity to each child so visual
 * appearance is preserved after ungrouping.
 * Requires exactly 1 selected item of type 'group'.
 */
export function ungroupItems(
  scene: SceneManager,
  selection: SelectionManager,
  viewport: Viewport,
  onChange: () => void,
): void {
  const selected = selection.getSelectedItems();
  if (selected.length !== 1) return;
  const groupItem = selected[0];
  if (groupItem.data.type !== 'group') return;

  const groupData = groupItem.data as GroupObject;
  const groupX = groupData.x;
  const groupY = groupData.y;
  const groupSx = groupData.sx;
  const groupSy = groupData.sy;
  const groupAngle = groupData.angle;
  const childIds: string[] = [];

  // Reparent each child back to the viewport, propagating group transforms
  for (const childId of groupData.children) {
    const childItem = scene.getById(childId);
    if (!childItem) continue;

    const obj = childItem.displayObject;

    if (childItem.type === 'image') {
      const imgData = childItem.data as ImageObject;

      // For images, transform the display position (with flip compensation) to world,
      // then back-calculate canonical data.x/y from the new scale/angle.
      // This is necessary because data.x/y is the canonical anchor, not the visual
      // top-left — the flip offset must be rotated through the group transform.
      const localDisplay = getImageDisplayTransform(imgData);
      const worldDisplay = transformPoint(
        { x: localDisplay.x, y: localDisplay.y },
        { x: groupX, y: groupY, sx: groupSx, sy: groupSy, angle: groupAngle },
      );

      // Propagate group scale and angle.
      // NOTE: This decomposition (multiply scales, add angles) is only exact for
      // uniform group scaling or axis-aligned children. Non-uniform group scale
      // combined with a rotated child produces shear that cannot be represented
      // by sx/sy + angle alone. In practice groups are rarely non-uniformly
      // scaled, so this is an acceptable limitation.
      imgData.sx *= groupSx;
      imgData.sy *= groupSy;
      imgData.angle = (imgData.angle || 0) + groupAngle;

      // Back-calculate canonical x/y: display.x = data.x + flipOffset
      const newSx = Math.abs(imgData.sx);
      const newSy = Math.abs(imgData.sy);
      const visibleRect = getImageVisibleLocalRect(imgData);
      imgData.x = worldDisplay.x - (imgData.flipX ? visibleRect.w * newSx : 0);
      imgData.y = worldDisplay.y - (imgData.flipY ? visibleRect.h * newSy : 0);

      // Reparent display object
      obj.parent?.removeChild(obj);
      viewport.addChild(obj);
      applyImageDisplayTransform(obj, imgData);
    } else {
      // Convert local position to world space, accounting for group scale
      const worldOrigin = transformPoint(
        { x: childItem.data.x, y: childItem.data.y },
        { x: groupX, y: groupY, sx: groupSx, sy: groupSy, angle: groupAngle },
      );

      // Propagate group scale and angle
      childItem.data.sx *= groupSx;
      childItem.data.sy *= groupSy;
      childItem.data.angle = (childItem.data.angle || 0) + groupAngle;

      // Update DATA to store world coords
      childItem.data.x = worldOrigin.x;
      childItem.data.y = worldOrigin.y;

      // Reparent display object
      obj.parent?.removeChild(obj);
      viewport.addChild(obj);
      obj.position.set(worldOrigin.x, worldOrigin.y);
      obj.scale.set(childItem.data.sx, childItem.data.sy);
      obj.angle = childItem.data.angle;
    }

    childIds.push(childId);
  }

  // Remove the group item itself (don't destroy children — they're reparented)
  const groupObj = groupItem.displayObject;
  groupObj.parent?.removeChild(groupObj);
  groupObj.destroy();
  scene.items.delete(groupItem.id);

  // Select the ungrouped children
  selection.clear();
  for (const id of childIds) {
    selection.selectedIds.add(id);
  }
  selection.transformBox.update(selection.getSelectedItems());

  rebuildGroupChildSet(scene);
  scene._applyZOrder();
  onChange();
}

/**
 * After loading a scene, reparent group children into their group containers.
 * Called by SceneManager.loadScene() after all items are created.
 */
export function reparentGroupChildren(scene: SceneManager): void {
  for (const item of scene.items.values()) {
    if (item.data.type !== 'group') continue;
    const groupData = item.data as GroupObject;
    const groupContainer = item.displayObject;

    for (const childId of groupData.children) {
      const childItem = scene.getById(childId);
      if (!childItem) continue;

      const obj = childItem.displayObject;
      // Only reparent if currently in viewport (not already in a group)
      if (obj.parent !== groupContainer) {
        obj.parent?.removeChild(obj);
        groupContainer.addChild(obj);
        // data.x/y are already local coords (saved that way)
        if (childItem.type === 'image') {
          applyImageDisplayTransform(obj, childItem.data as ImageObject);
        } else {
          obj.position.set(childItem.data.x, childItem.data.y);
        }
      }
    }
  }
}
