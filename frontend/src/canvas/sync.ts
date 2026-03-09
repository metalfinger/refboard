import { Canvas, FabricObject } from 'fabric';
import { Socket } from 'socket.io-client';

/**
 * Full-scene sync approach (like Excalidraw):
 *
 * 1. On any change → broadcast full canvas JSON (throttled)
 * 2. On receive → loadFromJSON to replace entire canvas
 * 3. During drag → lightweight position events for smooth real-time
 * 4. No per-object tracking, no ID matching race conditions
 *
 * Images are URLs (stored in MinIO), so canvas JSON stays small.
 */

let _suppress = false;

export function isRemoteUpdate(): boolean {
  return _suppress;
}

export function suppressBroadcasts() {
  _suppress = true;
}

export function resumeBroadcasts() {
  _suppress = false;
}

export function setupSync(
  canvas: Canvas,
  socket: Socket,
  boardId: string
): () => void {
  let sceneTimer: ReturnType<typeof setTimeout> | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let userInteracting = false;
  let pendingScene: any = null;
  const SCENE_THROTTLE = 300; // ms
  const MOVE_THROTTLE = 50; // ms

  // ---- Ensure objects have IDs ----

  function ensureId(obj: FabricObject): string {
    if (!(obj as any).id) {
      (obj as any).id = crypto.randomUUID();
    }
    return (obj as any).id;
  }

  // ---- BROADCAST: full scene (throttled) ----

  function scheduleBroadcast() {
    if (_suppress) return;
    if (sceneTimer) clearTimeout(sceneTimer);
    sceneTimer = setTimeout(() => {
      sceneTimer = null;
      if (_suppress) return;
      // Ensure all objects have IDs before serializing
      canvas.getObjects().forEach(ensureId);
      const scene = (canvas as any).toJSON(['id']);
      socket.emit('scene:update', { boardId, scene });
    }, SCENE_THROTTLE);
  }

  // ---- BROADCAST: lightweight transform during drag ----

  function emitTransform(obj: FabricObject) {
    if (_suppress) return;
    const id = (obj as any).id;
    if (!id) return;
    socket.emit('object:transform', {
      boardId, objectId: id,
      left: obj.left, top: obj.top,
      scaleX: obj.scaleX, scaleY: obj.scaleY,
      angle: obj.angle,
    });
  }

  // ---- RECEIVE: full scene ----

  function applyRemoteScene(scene: any) {
    if (userInteracting) {
      // Defer — apply when user finishes interaction
      pendingScene = scene;
      return;
    }
    doApplyScene(scene);
  }

  function doApplyScene(scene: any) {
    _suppress = true;
    canvas.loadFromJSON(scene)
      .then(() => {
        canvas.requestRenderAll();
        // Small delay for any deferred Fabric events
        setTimeout(() => { _suppress = false; }, 50);
      })
      .catch((err: any) => {
        console.error('[sync] loadFromJSON failed:', err);
        _suppress = false;
      });
  }

  // ---- RECEIVE: lightweight transform ----

  function applyRemoteTransform(payload: any) {
    if (payload.boardId !== boardId) return;
    const obj = canvas.getObjects().find((o) => (o as any).id === payload.objectId);
    if (!obj) return;

    _suppress = true;
    obj.set({
      left: payload.left,
      top: payload.top,
      scaleX: payload.scaleX,
      scaleY: payload.scaleY,
      angle: payload.angle,
    });
    obj.setCoords();
    canvas.requestRenderAll();
    _suppress = false;
  }

  // ---- Canvas event handlers ----

  function onObjectAdded() {
    if (!_suppress) scheduleBroadcast();
  }

  function onObjectModified() {
    if (!_suppress) scheduleBroadcast();
  }

  function onObjectRemoved() {
    if (!_suppress) scheduleBroadcast();
  }

  function onPathCreated() {
    if (!_suppress) scheduleBroadcast();
  }

  function onObjectMoving(e: any) {
    if (_suppress) return;
    // Throttle transform events
    if (moveTimer) return;
    emitTransform(e.target);
    moveTimer = setTimeout(() => { moveTimer = null; }, MOVE_THROTTLE);
  }

  function onMouseDown() {
    userInteracting = true;
  }

  function onMouseUp() {
    userInteracting = false;
    if (pendingScene) {
      doApplyScene(pendingScene);
      pendingScene = null;
    }
  }

  // ---- Bind canvas events ----

  canvas.on('object:added', onObjectAdded);
  canvas.on('object:modified', onObjectModified);
  canvas.on('object:removed', onObjectRemoved);
  canvas.on('path:created', onPathCreated);
  canvas.on('object:moving', onObjectMoving);
  canvas.on('object:scaling', onObjectMoving);
  canvas.on('object:rotating', onObjectMoving);
  canvas.on('mouse:down', onMouseDown);
  canvas.on('mouse:up', onMouseUp);

  // ---- Bind socket events ----

  function onSceneUpdate(payload: any) {
    if (payload.boardId !== boardId) return;
    applyRemoteScene(payload.scene);
  }

  socket.on('scene:update', onSceneUpdate);
  socket.on('object:transform', applyRemoteTransform);

  // ---- Join room ----

  socket.emit('board:join', { boardId }, (response: any) => {
    if (response?.users) {
      socket.emit('room:users', { users: response.users });
    }
  });

  // ---- Cleanup ----

  return () => {
    canvas.off('object:added', onObjectAdded);
    canvas.off('object:modified', onObjectModified);
    canvas.off('object:removed', onObjectRemoved);
    canvas.off('path:created', onPathCreated);
    canvas.off('object:moving', onObjectMoving);
    canvas.off('object:scaling', onObjectMoving);
    canvas.off('object:rotating', onObjectMoving);
    canvas.off('mouse:down', onMouseDown);
    canvas.off('mouse:up', onMouseUp);

    socket.off('scene:update', onSceneUpdate);
    socket.off('object:transform', applyRemoteTransform);

    socket.emit('board:leave', { boardId });

    if (sceneTimer) clearTimeout(sceneTimer);
    if (moveTimer) clearTimeout(moveTimer);
  };
}
