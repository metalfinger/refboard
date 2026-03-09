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
}
