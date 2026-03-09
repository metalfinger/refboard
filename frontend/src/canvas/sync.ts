import type { Socket } from 'socket.io-client';
import type { SceneManager, SceneItem } from './SceneManager';
import type { SceneData } from './scene-format';

/**
 * Full-scene sync (v2 format, PixiJS / SceneManager):
 *
 * 1. On any change → broadcast serialized SceneData (throttled 300ms)
 * 2. On receive → sceneManager.loadScene() (diff-based, no flicker)
 * 3. During drag → lightweight transform events (throttled 50ms)
 *
 * Diff-based loading doesn't trigger change events for unchanged objects,
 * so no suppress/resume logic is needed.
 */

export function setupSync(
  sceneManager: SceneManager,
  socket: Socket,
  boardId: string,
): () => void {
  let sceneTimer: ReturnType<typeof setTimeout> | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let receiving = false; // true while applying a remote scene/transform
  const SCENE_THROTTLE = 300; // ms
  const MOVE_THROTTLE = 50; // ms

  // ---- BROADCAST: full scene (throttled) --------------------------------

  function broadcastScene() {
    if (receiving) return;
    if (sceneTimer) clearTimeout(sceneTimer);
    sceneTimer = setTimeout(() => {
      sceneTimer = null;
      if (receiving) return;
      const scene = sceneManager.serialize();
      socket.emit('scene:update', { boardId, scene });
    }, SCENE_THROTTLE);
  }

  // ---- BROADCAST: lightweight transform during drag ---------------------

  function broadcastTransform(item: SceneItem) {
    if (receiving) return;
    if (moveTimer) return; // throttled
    const { id, data } = item;
    socket.emit('object:transform', {
      boardId,
      objectId: id,
      x: data.x,
      y: data.y,
      sx: data.sx,
      sy: data.sy,
      angle: data.angle,
    });
    moveTimer = setTimeout(() => {
      moveTimer = null;
    }, MOVE_THROTTLE);
  }

  // ---- RECEIVE: full scene ----------------------------------------------

  function onSceneReceived(payload: any) {
    if (payload.boardId !== boardId) return;
    const scene: SceneData = payload.scene;
    if (!scene || scene.v !== 2) return;

    receiving = true;
    sceneManager
      .loadScene(scene)
      .then(() => {
        receiving = false;
      })
      .catch((err: any) => {
        console.error('[sync] loadScene failed:', err);
        receiving = false;
      });
  }

  // ---- RECEIVE: lightweight transform -----------------------------------

  function onTransformReceived(payload: any) {
    if (payload.boardId !== boardId) return;
    const item = sceneManager.getById(payload.objectId);
    if (!item) return;

    // Update data model
    item.data.x = payload.x;
    item.data.y = payload.y;
    item.data.sx = payload.sx;
    item.data.sy = payload.sy;
    item.data.angle = payload.angle;

    // Update display object
    const obj = item.displayObject;
    obj.position.set(payload.x, payload.y);
    obj.scale.set(payload.sx, payload.sy);
    obj.angle = payload.angle;
    // No onChange — this is a remote update
  }

  // ---- Wire up SceneManager onChange → broadcastScene --------------------

  const prevOnChange = sceneManager.onChange;
  sceneManager.onChange = () => {
    prevOnChange?.();
    broadcastScene();
  };

  // ---- Bind socket events -----------------------------------------------

  socket.on('scene:update', onSceneReceived);
  socket.on('object:transform', onTransformReceived);

  // ---- Join room --------------------------------------------------------

  socket.emit('board:join', { boardId }, (response: any) => {
    if (response?.users) {
      socket.emit('room:users', { users: response.users });
    }
  });

  // ---- Cleanup ----------------------------------------------------------

  return () => {
    // Restore previous onChange
    sceneManager.onChange = prevOnChange;

    socket.off('scene:update', onSceneReceived);
    socket.off('object:transform', onTransformReceived);

    socket.emit('board:leave', { boardId });

    if (sceneTimer) clearTimeout(sceneTimer);
    if (moveTimer) clearTimeout(moveTimer);
  };
}

// Note: broadcastTransform for drag events will be wired via Editor integration.
// SelectionManager / TransformBox will call it directly once connected.
