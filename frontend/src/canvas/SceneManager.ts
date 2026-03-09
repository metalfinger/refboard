/**
 * SceneManager — central object model replacing Fabric.js canvas object management.
 *
 * Owns the SceneItem map, handles diff-based scene loading, z-ordering,
 * and spring-animated add/remove operations.
 */

import { Container, Sprite, Texture, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { TextureManager, LODTier } from './TextureManager';
import { SpringManager, Spring, PRESETS } from './spring';
import type {
  SceneData,
  AnySceneObject,
  ImageObject,
  VideoObject,
  TextObject,
  GroupObject,
  SceneObject,
} from './scene-format';

// ---------------------------------------------------------------------------
// SceneItem
// ---------------------------------------------------------------------------

export interface SceneItem {
  id: string;
  type: 'image' | 'video' | 'text' | 'group';
  displayObject: Container;
  data: AnySceneObject;
}

// ---------------------------------------------------------------------------
// SceneManager
// ---------------------------------------------------------------------------

export class SceneManager {
  readonly items: Map<string, SceneItem> = new Map();
  readonly viewport: Viewport;
  readonly textures: TextureManager;
  readonly springs: SpringManager;

  private _onChange: (() => void) | null = null;
  private _zCounter: number = 0;

  constructor(viewport: Viewport, textures: TextureManager, springs: SpringManager) {
    this.viewport = viewport;
    this.textures = textures;
    this.springs = springs;
  }

  // -- onChange callback ----------------------------------------------------

  set onChange(fn: (() => void) | null) {
    this._onChange = fn;
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
  async loadScene(scene: SceneData, animate = false): Promise<void> {
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
      item.displayObject.destroy({ children: true });
      this.items.delete(id);
    }

    // 2 & 3. Update existing, create new
    const loadPromises: Promise<void>[] = [];

    for (const data of scene.objects) {
      const existing = this.items.get(data.id);
      if (existing) {
        this._updateItem(existing, data);
      } else {
        loadPromises.push(this._createItem(data, animate));
      }

      // Track highest z for nextZ()
      if (data.z >= this._zCounter) {
        this._zCounter = data.z + 1;
      }
    }

    await Promise.all(loadPromises);

    // 4. Apply z-ordering
    this._applyZOrder();

    this._onChange?.();
  }

  // -- Item Creation -------------------------------------------------------

  /** Create a PixiJS display object from scene data and add it to the viewport. */
  async _createItem(data: AnySceneObject, animate: boolean): Promise<void> {
    let displayObject: Container;

    switch (data.type) {
      case 'image': {
        const imgData = data as ImageObject;
        const sprite = new Sprite(Texture.EMPTY);
        sprite.width = imgData.w;
        sprite.height = imgData.h;

        // Load texture asynchronously at appropriate LOD
        const zoom = this.viewport.scale.x;
        const tier = this.textures.tierForZoom(zoom);
        this.textures.load(imgData.asset, tier).then((tex) => {
          if (!sprite.destroyed) {
            sprite.texture = tex;
            sprite.width = imgData.w;
            sprite.height = imgData.h;
          }
        });

        displayObject = sprite;
        break;
      }

      case 'video': {
        const vidData = data as VideoObject;
        const gfx = new Graphics();
        gfx.rect(0, 0, vidData.w, vidData.h);
        gfx.fill(0x333333);
        displayObject = gfx;
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

      case 'group': {
        displayObject = new Container();
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

    // Animate entrance: spring scale from 0 → 1.05 → 1.0 with fade-in
    if (animate) {
      displayObject.scale.set(0, 0);
      displayObject.alpha = 0;

      const scaleSpring = new Spring(0, 1.05, PRESETS.bounce);
      scaleSpring.onUpdate = (v) => {
        if (!displayObject.destroyed) {
          displayObject.scale.set(v * data.sx, v * data.sy);
        }
      };
      scaleSpring.onComplete = () => {
        // Second spring: 1.05 → 1.0
        const settleSpring = new Spring(1.05, 1.0, PRESETS.snappy);
        settleSpring.onUpdate = (v) => {
          if (!displayObject.destroyed) {
            displayObject.scale.set(v * data.sx, v * data.sy);
          }
        };
        this.springs.add(settleSpring);
      };
      this.springs.add(scaleSpring);

      const alphaSpring = new Spring(0, data.opacity, PRESETS.gentle);
      alphaSpring.onUpdate = (v) => {
        if (!displayObject.destroyed) {
          displayObject.alpha = v;
        }
      };
      this.springs.add(alphaSpring);
    }
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

    // Update stored data
    item.data = { ...data };
    item.type = data.type;
  }

  // -- Z-Ordering ----------------------------------------------------------

  /** Sort items by z and reorder children in the viewport. */
  _applyZOrder(): void {
    const sorted = Array.from(this.items.values()).sort(
      (a, b) => a.data.z - b.data.z,
    );

    for (let i = 0; i < sorted.length; i++) {
      const child = sorted[i].displayObject;
      if (child.parent === this.viewport) {
        this.viewport.setChildIndex(child, i);
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

  // -- Remove Item ---------------------------------------------------------

  /** Remove an item, optionally animating scale→0.8 + fade out before destroy. */
  removeItem(id: string, animate = true): void {
    const item = this.items.get(id);
    if (!item) return;

    if (!animate) {
      item.displayObject.destroy({ children: true });
      this.items.delete(id);
      this._onChange?.();
      return;
    }

    const obj = item.displayObject;

    // Remove from map immediately to prevent double-remove
    this.items.delete(id);

    const scaleSpring = new Spring(1.0, 0.8, PRESETS.snappy);
    scaleSpring.onUpdate = (v) => {
      if (!obj.destroyed) {
        obj.scale.set(v * (item.data.sx), v * (item.data.sy));
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
    this._createItem(data, true);

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
    this.items.delete(groupId);

    this._applyZOrder();
    this._onChange?.();
    return freed;
  }
}
