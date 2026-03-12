/**
 * SceneManager — central object model replacing Fabric.js canvas object management.
 *
 * Owns the SceneItem map, handles diff-based scene loading, z-ordering,
 * and spring-animated add/remove operations.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { TextureManager } from './TextureManager';
import { ImageSprite } from './sprites/ImageSprite';
import { AnimatedGifSprite } from './sprites/AnimatedGifSprite';
import { VideoSprite } from './sprites/VideoSprite';
import { DrawingSprite } from './sprites/DrawingSprite';
import { FrameSprite } from './sprites/FrameSprite';
import { SpringManager, Spring, PRESETS } from './spring';
import { reparentGroupChildren } from './grouping';
import { SpatialGrid } from './SpatialGrid';
import type {
  SceneData,
  AnySceneObject,
  ImageObject,
  VideoObject,
  TextObject,
  DrawingObject,
  GroupObject,
  SceneObject,
} from './scene-format';

// ---------------------------------------------------------------------------
// GIF detection
// ---------------------------------------------------------------------------

/** Check if an asset key points to a GIF file.
 *  Strips query strings and fragments before checking extension. */
function isGifAsset(asset: string): boolean {
  // Strip query string and fragment
  const clean = asset.split('?')[0].split('#')[0];
  return clean.toLowerCase().endsWith('.gif');
}

// ---------------------------------------------------------------------------
// SceneItem
// ---------------------------------------------------------------------------

export interface SceneItem {
  id: string;
  type: 'image' | 'video' | 'text' | 'drawing' | 'group';
  displayObject: Container;
  data: AnySceneObject;
}

/** Set of child IDs that belong to a group — rebuilt when groups change. */
let _groupChildIds: Set<string> | null = null;

/** Rebuild the set of all group-child IDs. Call after group add/remove/load. */
export function rebuildGroupChildSet(scene: SceneManager): void {
  _groupChildIds = new Set<string>();
  for (const item of scene.items.values()) {
    if (item.data.type !== 'group') continue;
    const gd = item.data as GroupObject;
    for (const cid of gd.children) _groupChildIds.add(cid);
  }
}

/** Returns true if the item is a child of a group (not independently selectable). */
export function isGroupChild(id: string): boolean {
  return _groupChildIds?.has(id) ?? false;
}

/** Single source of truth for an item's world-space bounding rect.
 *  Uses data.sx/sy (not obj.scale which may be mid-animation).
 *  For groups: computes the union of children bounds (w/h on group data may be 0).
 *  For group children: converts local coords to world using parent group transforms. */
export function getItemWorldBounds(item: SceneItem): { x: number; y: number; w: number; h: number } {
  if (item.data.type === 'group') {
    return _getGroupWorldBounds(item);
  }

  // If this item is a child of a group, convert local → world
  const parent = item.displayObject.parent;
  if (parent && parent.label && _groupChildIds?.has(item.id)) {
    const px = parent.position.x;
    const py = parent.position.y;
    const psx = parent.scale.x;
    const psy = parent.scale.y;
    return {
      x: px + item.data.x * psx,
      y: py + item.data.y * psy,
      w: item.data.w * Math.abs(item.data.sx * psx),
      h: item.data.h * Math.abs(item.data.sy * psy),
    };
  }

  return {
    x: item.data.x,
    y: item.data.y,
    w: item.data.w * Math.abs(item.data.sx),
    h: item.data.h * Math.abs(item.data.sy),
  };
}

/**
 * Compute group bounds from its data.w/h (set during grouping) or fall back
 * to stored children data. Children store LOCAL x/y relative to group.
 */
function _getGroupWorldBounds(item: SceneItem): { x: number; y: number; w: number; h: number } {
  const groupX = item.data.x;
  const groupY = item.data.y;
  const groupW = item.data.w;
  const groupH = item.data.h;

  // If group has valid w/h (set during creation), apply scale just like regular items
  if (groupW > 0 && groupH > 0) {
    return {
      x: groupX,
      y: groupY,
      w: groupW * Math.abs(item.data.sx),
      h: groupH * Math.abs(item.data.sy),
    };
  }

  // Fallback: shouldn't happen, but compute from children display objects
  const container = item.displayObject;
  if (container.children.length === 0) {
    return { x: groupX, y: groupY, w: 0, h: 0 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of container.children) {
    const cx = child.x;
    const cy = child.y;
    // Approximate child size from its local bounds
    const lb = child.getLocalBounds();
    const cw = lb.width;
    const ch = lb.height;
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx + cw);
    maxY = Math.max(maxY, cy + ch);
  }

  if (!isFinite(minX)) return { x: groupX, y: groupY, w: 0, h: 0 };
  // Children positions are local to group, so offset by group world position
  return { x: groupX + minX, y: groupY + minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// SceneManager
// ---------------------------------------------------------------------------

export class SceneManager {
  readonly items: Map<string, SceneItem> = new Map();
  readonly viewport: Viewport;
  readonly textures: TextureManager;
  readonly springs: SpringManager;
  readonly spatialGrid: SpatialGrid<SceneItem> = new SpatialGrid<SceneItem>(512);

  private _onChange: (() => void) | null = null;
  private _onItemDimensionsChanged: ((itemId: string) => void) | null = null;
  private _zCounter: number = 0;

  constructor(viewport: Viewport, textures: TextureManager, springs: SpringManager) {
    this.viewport = viewport;
    this.textures = textures;
    this.springs = springs;
  }

  /** Update an item's spatial index entry from its current data. */
  updateSpatialEntry(item: SceneItem): void {
    const { x, y, w, h } = getItemWorldBounds(item);
    this.spatialGrid.upsert(item.id, item, x, y, w, h);
  }

  /** Query items overlapping the given world rectangle. */
  queryRegion(rx: number, ry: number, rw: number, rh: number): SceneItem[] {
    return this.spatialGrid.query(rx, ry, rw, rh).map(e => e.data);
  }

  // -- onChange callback ----------------------------------------------------

  set onChange(fn: (() => void) | null) {
    this._onChange = fn;
  }

  set onItemDimensionsChanged(fn: ((itemId: string) => void) | null) {
    this._onItemDimensionsChanged = fn;
  }

  get onChange(): (() => void) | null {
    return this._onChange;
  }

  // -- Serialization -------------------------------------------------------

  /** Convert all items to v2 scene format, sorted by z. */
  serialize(): SceneData {
    const objects = Array.from(this.items.values())
      .sort((a, b) => a.data.z - b.data.z)
      .map((item) => ({ ...item.data }));

    return {
      v: 2,
      bg: '',
      objects,
    };
  }

  // -- Scene Loading (diff-based) ------------------------------------------

  /**
   * Load a scene using diff-based reconciliation:
   * 1. Remove items not present in incoming data
   * 2. Update existing items with new properties
   * 3. Create new items
   * 4. Apply z-ordering
   */
  async loadScene(scene: SceneData, _animate?: boolean): Promise<void> {
    const incomingById = new Map<string, AnySceneObject>();
    for (const obj of scene.objects) {
      incomingById.set(obj.id, obj);
    }

    // 1. Remove items not in incoming set
    const toRemove: string[] = [];
    for (const id of this.items.keys()) {
      if (!incomingById.has(id)) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      const item = this.items.get(id)!;

      // If removing a group, reparent its PixiJS children to viewport first
      // so they survive the container destruction (they may still be in the
      // incoming set as ungrouped top-level items).
      if (item.data.type === 'group') {
        const container = item.displayObject;
        // Reparent actual scene children (skip internal frame bg/label)
        const toReparent = container.children.filter(
          (c) => !c.label?.startsWith('__frame_'),
        );
        for (const child of toReparent) {
          this.viewport.addChild(child);
        }
      }

      item.displayObject.destroy({ children: true });
      this.spatialGrid.remove(id);
      this.items.delete(id);
    }

    // 2 & 3. Update existing, create new
    const loadPromises: Promise<void>[] = [];

    for (const data of scene.objects) {
      const existing = this.items.get(data.id);
      if (existing) {
        this._updateItem(existing, data);
      } else {
        loadPromises.push(this._createItem(data));
      }

      // Track highest z for nextZ()
      if (data.z >= this._zCounter) {
        this._zCounter = data.z + 1;
      }
    }

    await Promise.all(loadPromises);

    // 4. Reparent group children into their group containers
    reparentGroupChildren(this);
    rebuildGroupChildSet(this);

    // 5. Apply z-ordering
    this._applyZOrder();

    this._onChange?.();
  }

  // -- Item Creation -------------------------------------------------------

  /** Create a PixiJS display object from scene data and add it to the viewport. */
  async _createItem(data: AnySceneObject, _animate?: boolean): Promise<void> {
    let displayObject: Container;

    switch (data.type) {
      case 'image': {
        const imgData = data as ImageObject;
        if (isGifAsset(imgData.asset)) {
          displayObject = new AnimatedGifSprite(imgData.asset, imgData.w, imgData.h, this.textures);
        } else {
          const imgSprite = new ImageSprite(imgData.asset, imgData.w, imgData.h, this.textures);
          if (imgData.crop) imgSprite.applyCrop(imgData.crop);
          displayObject = imgSprite;
        }
        break;
      }

      case 'video': {
        const vidData = data as VideoObject;
        const videoUrl = this.textures.urlForAsset(vidData.asset);
        // Use cached native dimensions if available (avoids re-init just to discover size)
        const vw = vidData.nativeW || vidData.w;
        const vh = vidData.nativeH || vidData.h;
        const videoSprite = new VideoSprite(vidData.asset, vw, vh, videoUrl, vidData.poster, this.textures);
        // Apply cached native dims to scene data so display matches
        if (vidData.nativeW && vidData.nativeH) {
          data.w = vw;
          data.h = vh;
        }
        // Auto-correct dimensions when video metadata loads
        // NOTE: callback must update item.data (the stored copy), not the original `data` param.
        // We wire this after the item is created below (see post-creation video wiring).
        displayObject = videoSprite;
        break;
      }

      case 'text': {
        const txtData = data as TextObject;
        const style = new TextStyle({
          fontSize: txtData.fontSize,
          fill: txtData.fill,
          fontFamily: txtData.fontFamily,
        });
        displayObject = new Text({ text: txtData.text, style });
        break;
      }

      case 'drawing': {
        const drawData = data as DrawingObject;
        displayObject = new DrawingSprite(drawData.points, drawData.color, drawData.strokeWidth);
        break;
      }

      case 'group': {
        const gd = data as GroupObject;
        displayObject = new FrameSprite(gd.w, gd.h, gd.bgColor, gd.label, gd.padding);
        break;
      }

      default:
        displayObject = new Container();
        break;
    }

    // Common properties
    displayObject.position.set(data.x, data.y);
    displayObject.scale.set(data.sx, data.sy);
    displayObject.angle = data.angle;
    displayObject.alpha = data.opacity;
    displayObject.visible = data.visible;
    displayObject.eventMode = data.locked ? 'none' : 'static';
    displayObject.label = data.id;
    displayObject.cursor = 'pointer';

    this.viewport.addChild(displayObject);

    const item: SceneItem = {
      id: data.id,
      type: data.type,
      displayObject,
      data: { ...data },
    };

    this.items.set(data.id, item);
    this.updateSpatialEntry(item);

    // Wire video dimension auto-correction to the STORED item.data (not the original param)
    if (data.type === 'video' && displayObject instanceof VideoSprite) {
      displayObject.onDimensionsKnown = (realW, realH) => {
        item.data.w = realW;
        item.data.h = realH;
        // Cache native dimensions so future scene loads skip re-init for size
        (item.data as VideoObject).nativeW = realW;
        (item.data as VideoObject).nativeH = realH;
        this._onChange?.();
        this._onItemDimensionsChanged?.(item.id);
      };
    }

    // No entrance animation — items must be visible and draggable immediately.
  }

  // -- Item Update ---------------------------------------------------------

  /** Update an existing item's display object properties from new data. */
  _updateItem(item: SceneItem, data: AnySceneObject): void {
    const obj = item.displayObject;

    obj.position.set(data.x, data.y);
    obj.scale.set(data.sx, data.sy);
    obj.angle = data.angle;
    obj.alpha = data.opacity;
    obj.visible = data.visible;
    obj.eventMode = data.locked ? 'none' : 'static';

    // Type-specific updates
    if (data.type === 'drawing' && obj instanceof DrawingSprite) {
      const drawData = data as DrawingObject;
      obj.setPoints(drawData.points);
    }
    if (data.type === 'text' && obj instanceof Text) {
      const txtData = data as TextObject;
      obj.text = txtData.text;
      obj.style.fontSize = txtData.fontSize;
      obj.style.fill = txtData.fill;
    }
    if (data.type === 'group' && obj instanceof FrameSprite) {
      obj.updateFromData(data as GroupObject);
    }
    if (data.type === 'image' && obj instanceof ImageSprite) {
      const imgData = data as ImageObject;
      obj.applyCrop(imgData.crop);
    }

    // Update stored data
    item.data = { ...data };
    item.type = data.type;
    this.updateSpatialEntry(item);
  }

  // -- Z-Ordering ----------------------------------------------------------

  /** Sort items by z and reorder children in both viewport and group containers. */
  _applyZOrder(): void {
    const sorted = Array.from(this.items.values()).sort(
      (a, b) => a.data.z - b.data.z,
    );

    // Reorder top-level items in the viewport
    let vpIndex = 0;
    for (const item of sorted) {
      const child = item.displayObject;
      if (child.parent === this.viewport) {
        // Clamp index to valid range (selection overlay etc. may also be viewport children)
        const maxIdx = this.viewport.children.length - 1;
        const targetIdx = Math.min(vpIndex, maxIdx);
        if (this.viewport.getChildIndex(child) !== targetIdx) {
          this.viewport.setChildIndex(child, targetIdx);
        }
        vpIndex++;
      }
    }

    // Reorder children within each group container
    for (const item of sorted) {
      if (item.data.type !== 'group') continue;
      const groupData = item.data as GroupObject;
      const container = item.displayObject;
      // Sort children by their z value within the group
      const childItems = groupData.children
        .map((id) => this.items.get(id))
        .filter((c): c is SceneItem => !!c)
        .sort((a, b) => a.data.z - b.data.z);

      for (let i = 0; i < childItems.length; i++) {
        const child = childItems[i].displayObject;
        if (child.parent === container) {
          const maxIdx = container.children.length - 1;
          const targetIdx = Math.min(i, maxIdx);
          if (container.getChildIndex(child) !== targetIdx) {
            container.setChildIndex(child, targetIdx);
          }
        }
      }
    }
  }

  // -- Lookup Helpers ------------------------------------------------------

  getById(id: string): SceneItem | undefined {
    return this.items.get(id);
  }

  getAllItems(): SceneItem[] {
    return Array.from(this.items.values());
  }

  /** Get only top-level items (excludes group children). Used for selection/hit testing. */
  getTopLevelItems(): SceneItem[] {
    return Array.from(this.items.values()).filter((item) => !isGroupChild(item.id));
  }

  // -- Remove Item ---------------------------------------------------------

  /** Remove an item, optionally animating scale→0.8 + fade out before destroy.
   *  If item is a group, recursively removes all children from the items map. */
  removeItem(id: string, animate = true): void {
    const item = this.items.get(id);
    if (!item) return;

    // If this is a group, remove children from the items map first
    if (item.data.type === 'group') {
      const groupData = item.data as import('./scene-format').GroupObject;
      for (const childId of groupData.children) {
        this.spatialGrid.remove(childId);
        this.items.delete(childId);
      }
    }

    if (!animate) {
      item.displayObject.destroy({ children: true });
      this.spatialGrid.remove(id);
      this.items.delete(id);
      this._onChange?.();
      return;
    }

    const obj = item.displayObject;

    // Remove from map immediately to prevent double-remove
    this.spatialGrid.remove(id);
    this.items.delete(id);

    // Scale toward center on removal
    const halfW = item.data.w * item.data.sx / 2;
    const halfH = item.data.h * item.data.sy / 2;
    const startX = item.data.x;
    const startY = item.data.y;

    const scaleSpring = new Spring(1.0, 0.8, PRESETS.snappy);
    scaleSpring.onUpdate = (v) => {
      if (!obj.destroyed) {
        obj.scale.set(v * item.data.sx, v * item.data.sy);
        obj.position.set(
          startX + halfW * (1 - v),
          startY + halfH * (1 - v),
        );
      }
    };
    this.springs.add(scaleSpring);

    const alphaSpring = new Spring(obj.alpha, 0, PRESETS.snappy);
    alphaSpring.onUpdate = (v) => {
      if (!obj.destroyed) {
        obj.alpha = Math.max(0, v);
      }
    };
    alphaSpring.onComplete = () => {
      if (!obj.destroyed) {
        obj.destroy({ children: true });
      }
    };
    this.springs.add(alphaSpring);

    this._onChange?.();
  }

  // -- Z Counter -----------------------------------------------------------

  /** Increment and return the next z value. */
  nextZ(): number {
    return this._zCounter++;
  }

  // -- Convenience: Add Image From Upload ----------------------------------

  /** Create an ImageObject from an upload and add it to the scene with animation. */
  addImageFromUpload(
    assetKey: string,
    w: number,
    h: number,
    x: number,
    y: number,
  ): SceneItem {
    const data: ImageObject = {
      id: crypto.randomUUID(),
      type: 'image',
      x,
      y,
      w,
      h,
      sx: 1,
      sy: 1,
      angle: 0,
      z: this.nextZ(),
      opacity: 1,
      locked: false,
      name: '',
      visible: true,
      asset: assetKey,
      filters: [],
    };

    // Fire-and-forget the async creation (animation handles visual feedback)
    this._createItem(data);

    this._applyZOrder();
    this._onChange?.();

    return this.items.get(data.id)!;
  }

  /** Create a VideoObject from an upload and add it to the scene with animation. */
  addVideoFromUpload(
    assetKey: string,
    w: number,
    h: number,
    x: number,
    y: number,
    posterAssetKey?: string,
    duration?: number,
  ): SceneItem {
    const data: VideoObject = {
      id: crypto.randomUUID(),
      type: 'video',
      x,
      y,
      w,
      h,
      sx: 1,
      sy: 1,
      angle: 0,
      z: this.nextZ(),
      opacity: 1,
      locked: false,
      name: '',
      visible: true,
      asset: assetKey,
      muted: true,
      loop: true,
      nativeW: w,
      nativeH: h,
      poster: posterAssetKey,
      duration,
    };

    this._createItem(data);
    this._applyZOrder();
    this._onChange?.();

    return this.items.get(data.id)!;
  }

  // -- Group / Ungroup with Spring Animation --------------------------------

  /**
   * Group 2+ items into a single group item.
   *
   * Animates children ~25px toward the combined center, then reparents them
   * into a Container. Returns the newly created group SceneItem.
   */
  groupItems(ids: string[]): SceneItem | null {
    if (ids.length < 2) return null;

    // Collect valid children
    const children: SceneItem[] = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) children.push(item);
    }
    if (children.length < 2) return null;

    // Calculate combined bounds center
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      const d = child.data;
      const w = ('w' in d ? (d as SceneObject).w : 0) * d.sx;
      const h = ('h' in d ? (d as SceneObject).h : 0) * d.sy;
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + w);
      maxY = Math.max(maxY, d.y + h);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const boundsW = maxX - minX;
    const boundsH = maxY - minY;

    // Create the group data
    const groupData: GroupObject = {
      id: crypto.randomUUID(),
      type: 'group',
      x: cx - boundsW / 2,
      y: cy - boundsH / 2,
      w: boundsW,
      h: boundsH,
      sx: 1,
      sy: 1,
      angle: 0,
      z: this.nextZ(),
      opacity: 1,
      locked: false,
      name: '',
      visible: true,
      children: children.map((c) => c.id),
    };

    // Create a Container for the group
    const container = new Container();
    container.position.set(groupData.x, groupData.y);
    container.label = groupData.id;
    container.cursor = 'pointer';
    container.eventMode = 'static';
    this.viewport.addChild(container);

    const groupItem: SceneItem = {
      id: groupData.id,
      type: 'group',
      displayObject: container,
      data: groupData,
    };
    this.items.set(groupData.id, groupItem);
    this.updateSpatialEntry(groupItem);

    // Animate each child ~25px toward center, then reparent into container
    const CONVERGE_PX = 25;

    for (const child of children) {
      const obj = child.displayObject;
      const dx = cx - (child.data.x + ((child.data as SceneObject).w * child.data.sx) / 2);
      const dy = cy - (child.data.y + ((child.data as SceneObject).h * child.data.sy) / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) continue; // already at center

      const ratio = Math.min(CONVERGE_PX / dist, 1);
      const targetX = child.data.x + dx * ratio;
      const targetY = child.data.y + dy * ratio;

      const startX = obj.x;
      const startY = obj.y;

      // Spring animates a normalized 0→1 progress value
      const spring = new Spring(0, 1, PRESETS.gentle);
      const capturedChild = child;

      spring.onUpdate = (v) => {
        if (!obj.destroyed) {
          obj.x = startX + (targetX - startX) * v;
          obj.y = startY + (targetY - startY) * v;
        }
      };

      spring.onComplete = () => {
        if (!obj.destroyed && !container.destroyed) {
          // Reparent: adjust position relative to container
          obj.x = obj.x - container.x;
          obj.y = obj.y - container.y;
          container.addChild(obj);
          // Update stored data
          capturedChild.data.x = obj.x + container.x;
          capturedChild.data.y = obj.y + container.y;
        }
      };

      this.springs.add(spring);
    }

    this._applyZOrder();
    this._onChange?.();
    return groupItem;
  }

  /**
   * Ungroup a group item, releasing children back to the viewport.
   *
   * Animates children ~25px outward from the group center, then removes
   * the group from the items map. Returns the freed children.
   */
  ungroupItems(groupId: string): SceneItem[] {
    const groupItem = this.items.get(groupId);
    if (!groupItem || groupItem.type !== 'group') return [];

    const groupData = groupItem.data as GroupObject;
    const container = groupItem.displayObject;
    const freed: SceneItem[] = [];

    // Group center in world coords
    const gcx = groupData.x + groupData.w / 2;
    const gcy = groupData.y + groupData.h / 2;

    const SPREAD_PX = 25;

    for (const childId of groupData.children) {
      const child = this.items.get(childId);
      if (!child) continue;

      const obj = child.displayObject;

      // Reparent back to viewport — convert position to world coords
      const worldX = obj.x + container.x;
      const worldY = obj.y + container.y;
      this.viewport.addChild(obj);
      obj.x = worldX;
      obj.y = worldY;

      // Update stored data to world coords
      child.data.x = worldX;
      child.data.y = worldY;

      freed.push(child);

      // Animate outward from group center
      const childCX = worldX + ((child.data as SceneObject).w * child.data.sx) / 2;
      const childCY = worldY + ((child.data as SceneObject).h * child.data.sy) / 2;
      const dx = childCX - gcx;
      const dy = childCY - gcy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) continue;

      const ratio = SPREAD_PX / dist;
      const offsetX = dx * ratio;
      const offsetY = dy * ratio;

      const startX = obj.x;
      const startY = obj.y;
      const targetX = startX + offsetX;
      const targetY = startY + offsetY;

      const spring = new Spring(0, 1, PRESETS.gentle);
      const capturedChild = child;

      spring.onUpdate = (v) => {
        if (!obj.destroyed) {
          obj.x = startX + (targetX - startX) * v;
          obj.y = startY + (targetY - startY) * v;
        }
      };

      spring.onComplete = () => {
        // Update final position in data
        if (!obj.destroyed) {
          capturedChild.data.x = obj.x;
          capturedChild.data.y = obj.y;
        }
      };

      this.springs.add(spring);
    }

    // Remove group container and item
    if (!container.destroyed) {
      container.destroy();
    }
    this.spatialGrid.remove(groupId);
    this.items.delete(groupId);

    this._applyZOrder();
    this._onChange?.();
    return freed;
  }
}
