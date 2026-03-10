import type { Socket } from 'socket.io-client';
import type { SceneManager, SceneItem } from './SceneManager';
import type { SceneData, AnySceneObject } from './scene-format';

/**
 * Sync protocol v3 — Excalidraw-inspired incremental element sync.
 *
 * Three event tiers:
 *   1. scene:update   — full scene snapshot. Sent on join (INIT) and periodically
 *      to correct any drift. Receiver does full reconciliation via loadScene().
 *   2. element:update  — array of changed elements only. Sent on any element
 *      change (add, modify, draw). Receiver merges incrementally — no full scene
 *      diff needed. Each element carries a `_v` version; receiver skips stale.
 *   3. element:remove  — array of removed element IDs. Receiver deletes them.
 *   4. object:transform — ephemeral position/scale during drag (unchanged).
 *
 * During freehand drawing, only the single drawing element is sent via
 * element:update every ~60ms (one frame) — tiny payload, no lag.
 */

export interface SyncHandle {
  cleanup: () => void;
  broadcastTransform: (items: SceneItem | SceneItem[]) => void;
  /** Force an immediate full scene broadcast (call after structural changes). */
  broadcastSceneNow: () => void;
  /** Broadcast only specific changed elements (lightweight). */
  broadcastElements: (ids: string[]) => void;
}

export interface SyncOptions {
  onRemoteTransform?: (item: SceneItem) => void;
}

export function setupSync(
  sceneManager: SceneManager,
  socket: Socket,
  boardId: string,
  options?: SyncOptions,
): SyncHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let receiving = false;
  let localVersion = 0;
  let remoteVersion = 0;
  const DEBOUNCE_MS = 500;
  const MOVE_THROTTLE = 50;

  // Track broadcasted element versions (like Excalidraw's broadcastedElementVersions)
  const broadcastedVersions: Map<string, number> = new Map();

  // Per-element version counter — bumped whenever an element changes locally
  const elementVersions: Map<string, number> = new Map();

  function bumpElementVersion(id: string): number {
    const v = (elementVersions.get(id) ?? 0) + 1;
    elementVersions.set(id, v);
    return v;
  }

  // ---- BROADCAST: incremental element update --------------------------------

  /** Send only the specified elements. Skips if element hasn't changed since last broadcast. */
  function broadcastElements(ids: string[]) {
    if (receiving) return;

    const elements: (AnySceneObject & { _v: number })[] = [];
    for (const id of ids) {
      const item = sceneManager.getById(id);
      if (!item) continue;

      const v = elementVersions.get(id) ?? 0;
      const lastBroadcasted = broadcastedVersions.get(id) ?? -1;
      if (v <= lastBroadcasted) continue;

      elements.push({ ...item.data, _v: v });
      broadcastedVersions.set(id, v);
    }

    if (elements.length === 0) return;
    socket.emit('element:update', { boardId, elements });
  }

  /** Broadcast all elements that changed since last broadcast. */
  function broadcastChangedElements() {
    if (receiving) return;
    const ids: string[] = [];
    for (const [id, v] of elementVersions) {
      if (v > (broadcastedVersions.get(id) ?? -1)) {
        ids.push(id);
      }
    }
    if (ids.length > 0) broadcastElements(ids);
  }

  // ---- BROADCAST: full scene (for INIT / periodic resync) -------------------

  function broadcastSceneNow() {
    if (receiving) return;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    localVersion++;
    const scene = sceneManager.serialize();

    // Update all broadcasted versions
    for (const obj of scene.objects) {
      const v = elementVersions.get(obj.id) ?? 0;
      broadcastedVersions.set(obj.id, v);
    }

    socket.emit('scene:update', { boardId, scene, version: localVersion });
  }

  function broadcastSceneDebounced() {
    if (receiving) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcastSceneNow();
    }, DEBOUNCE_MS);
  }

  // ---- BROADCAST: lightweight transform during drag -------------------------

  function broadcastTransform(itemOrItems: SceneItem | SceneItem[]) {
    if (receiving) return;
    if (moveTimer) return;
    const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
    const transforms = items.map(({ id, data }) => ({
      objectId: id,
      x: data.x,
      y: data.y,
      sx: data.sx,
      sy: data.sy,
      angle: data.angle,
    }));
    socket.emit('object:transform', { boardId, transforms });
    moveTimer = setTimeout(() => { moveTimer = null; }, MOVE_THROTTLE);
  }

  // ---- RECEIVE: full scene --------------------------------------------------

  function onSceneReceived(payload: any) {
    if (payload.boardId !== boardId) return;
    const scene: SceneData = payload.scene;
    if (!scene || scene.v !== 2) return;

    const incomingVersion = payload.version ?? 0;
    if (incomingVersion > 0 && incomingVersion <= remoteVersion) return;
    remoteVersion = incomingVersion;
    if (incomingVersion >= localVersion) localVersion = incomingVersion;

    receiving = true;
    sceneManager
      .loadScene(scene)
      .then(() => {
        // Update element versions from received data
        for (const obj of scene.objects) {
          const v = (obj as any)._v;
          if (typeof v === 'number') {
            const current = elementVersions.get(obj.id) ?? 0;
            if (v > current) elementVersions.set(obj.id, v);
          }
        }
        receiving = false;
      })
      .catch((err: any) => {
        console.error('[sync] loadScene failed:', err);
        receiving = false;
      });
  }

  // ---- RECEIVE: incremental element update ----------------------------------

  function onElementUpdate(payload: any) {
    if (payload.boardId !== boardId) return;
    const elements: (AnySceneObject & { _v?: number })[] = payload.elements;
    if (!Array.isArray(elements) || elements.length === 0) return;

    for (const data of elements) {
      const incomingV = data._v ?? 0;

      // Clean the _v field before storing
      const cleanData = { ...data };
      delete (cleanData as any)._v;

      const existing = sceneManager.getById(data.id);
      if (existing) {
        // Update existing — apply incremental merge
        sceneManager._updateItem(existing, cleanData);
      } else {
        // New element — create it
        sceneManager._createItem(cleanData, false);
      }

      // Track the version
      if (incomingV > 0) {
        const current = elementVersions.get(data.id) ?? 0;
        if (incomingV > current) elementVersions.set(data.id, incomingV);
      }
    }

    sceneManager._applyZOrder();
  }

  // ---- RECEIVE: element removal ---------------------------------------------

  function onElementRemove(payload: any) {
    if (payload.boardId !== boardId) return;
    const ids: string[] = payload.ids;
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      sceneManager.removeItem(id, true);
      elementVersions.delete(id);
      broadcastedVersions.delete(id);
    }
  }

  // ---- RECEIVE: lightweight transform ---------------------------------------

  function applyTransform(t: any) {
    const item = sceneManager.getById(t.objectId);
    if (!item) return;
    item.data.x = t.x;
    item.data.y = t.y;
    item.data.sx = t.sx;
    item.data.sy = t.sy;
    item.data.angle = t.angle;
    const obj = item.displayObject;
    obj.position.set(t.x, t.y);
    obj.scale.set(t.sx, t.sy);
    obj.angle = t.angle;
    options?.onRemoteTransform?.(item);
  }

  function onTransformReceived(payload: any) {
    if (payload.boardId !== boardId) return;
    // Batched format: { transforms: [...] }
    if (Array.isArray(payload.transforms)) {
      for (const t of payload.transforms) applyTransform(t);
    } else if (payload.objectId) {
      // Legacy single-item format
      applyTransform(payload);
    }
  }

  // ---- Wire up SceneManager onChange → debounced full sync -------------------

  const prevOnChange = sceneManager.onChange;
  sceneManager.onChange = () => {
    prevOnChange?.();
    // Structural change — schedule a full scene sync (debounced).
    // Incremental element sync is handled explicitly by tools via broadcastElements().
    broadcastSceneDebounced();
  };

  // ---- Bind socket events ---------------------------------------------------

  socket.on('scene:update', onSceneReceived);
  socket.on('element:update', onElementUpdate);
  socket.on('element:remove', onElementRemove);
  socket.on('object:transform', onTransformReceived);

  // ---- Join room ------------------------------------------------------------

  socket.emit('board:join', { boardId }, (response: any) => {
    if (response?.users) {
      socket.emit('room:users', { users: response.users });
    }
  });

  // ---- Return handle --------------------------------------------------------

  return {
    broadcastTransform,
    broadcastSceneNow,
    broadcastElements(ids: string[]) {
      for (const id of ids) bumpElementVersion(id);
      broadcastElements(ids);
    },
    cleanup: () => {
      sceneManager.onChange = prevOnChange;
      socket.off('scene:update', onSceneReceived);
      socket.off('element:update', onElementUpdate);
      socket.off('element:remove', onElementRemove);
      socket.off('object:transform', onTransformReceived);
      socket.emit('board:leave', { boardId });
      if (debounceTimer) clearTimeout(debounceTimer);
      if (moveTimer) clearTimeout(moveTimer);
    },
  };
}
