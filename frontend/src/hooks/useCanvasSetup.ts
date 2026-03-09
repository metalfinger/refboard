import { useEffect, useRef } from 'react';
import type { PixiCanvasHandle } from '../canvas/PixiCanvas';
import { SelectionManager } from '../canvas/SelectionManager';
import { TextEditor } from '../canvas/TextEditor';
import { setupSync, SyncHandle } from '../canvas/sync';
import { setupDragDrop, setupPaste } from '../canvas/image-drop';
import { UndoManager } from '../canvas/history';
import { InboxZone } from '../canvas/InboxZone';
import { connectSocket, disconnectSocket } from '../socket';

interface OnlineUser {
  userId: string;
  displayName: string;
  color: string;
}

const CURSOR_COLORS = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9',
  '#4dabf7', '#7950f2', '#e64980', '#20c997', '#ff922b',
];

function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

interface CanvasSetupDeps {
  boardData: any;
  resolvedBoardId: string | undefined;
  user: any;
  isPublicView?: boolean;
  canvasRef: React.RefObject<PixiCanvasHandle | null>;
  selectionRef: React.MutableRefObject<SelectionManager | null>;
  undoRef: React.MutableRefObject<UndoManager | null>;
  syncRef: React.MutableRefObject<SyncHandle | null>;
  inboxZoneRef: React.MutableRefObject<InboxZone | null>;
  onCanvasChange: () => void;
  showToast: (msg: string) => void;
  setOnlineUsers: React.Dispatch<React.SetStateAction<OnlineUser[]>>;
  setSelectedLayerIds: React.Dispatch<React.SetStateAction<string[]>>;
}

/**
 * Sets up the canvas infrastructure: selection, undo, sync, socket, drag/drop, paste, inbox zone.
 * Runs once when boardData is loaded and canvas is ready.
 */
export function useCanvasSetup(deps: CanvasSetupDeps) {
  const {
    boardData, resolvedBoardId, user, isPublicView,
    canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef,
    onCanvasChange, showToast, setOnlineUsers, setSelectedLayerIds,
  } = deps;

  const dropCleanupRef = useRef<(() => void) | null>(null);
  const pasteCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!boardData || !resolvedBoardId) return;

    const timer = setTimeout(() => {
      const scene = canvasRef.current?.getScene();
      const viewport = canvasRef.current?.getViewport();
      if (!scene || !viewport) return;

      // Create SelectionManager
      const selection = new SelectionManager(viewport, scene);
      selectionRef.current = selection;

      // Wire selection change to update layer panel state
      selection.onSelectionChange = (ids: string[]) => {
        setSelectedLayerIds(ids);
      };

      // Inline text editing on double-click
      const textEditor = new TextEditor();
      // Find the DOM container for the canvas (parent of the <canvas> element)
      const canvasElements = document.querySelectorAll('canvas');
      let domContainer: HTMLElement | null = null;
      for (const c of canvasElements) {
        if (c.parentElement && c.width > 100) {
          domContainer = c.parentElement;
          break;
        }
      }
      selection.onDoubleClickText = (item) => {
        if (!domContainer) return;
        textEditor.startEditing(item, viewport, domContainer, () => {
          syncRef.current?.broadcastElements([item.id]);
          onCanvasChange();
        });
      };

      // Refresh transform box when item dimensions change (e.g. video metadata loaded)
      scene.onItemDimensionsChanged = (itemId: string) => {
        if (selection.selectedIds.has(itemId)) {
          selection.transformBox.update(selection.getSelectedItems());
        }
      };

      // Create UndoManager
      undoRef.current = new UndoManager(scene);

      // Create InboxZone and add to viewport
      const inboxZone = new InboxZone(scene.textures, scene.springs);
      viewport.addChild(inboxZone);
      inboxZoneRef.current = inboxZone;

      if (user) {
        const socket = connectSocket();

        syncRef.current = setupSync(scene, socket, resolvedBoardId, {
          onRemoteTransform: (item) => {
            if (selection.selectedIds.has(item.id)) {
              selection.transformBox.update(selection.getSelectedItems());
            }
          },
        });

        // Wire live drag/resize transforms to sync broadcast
        selection.onItemTransform = (item) => {
          syncRef.current?.broadcastTransform(item);
        };
        selection.transformBox.onItemTransform = (item) => {
          syncRef.current?.broadcastTransform(item);
        };

        socket.on('user:joined', (data: any) => {
          const uid = data.userId || data.id;
          const name = data.displayName || data.display_name || data.username || '';
          setOnlineUsers((prev) => {
            if (prev.find((u) => u.userId === uid)) return prev;
            return [...prev, { userId: uid, displayName: name, color: userColor(uid) }];
          });
          if (name) showToast(`${name} joined`);
        });

        socket.on('user:left', (data: any) => {
          const uid = data.userId || data.id;
          const name = data.displayName || data.display_name || data.username || '';
          setOnlineUsers((prev) => prev.filter((u) => u.userId !== uid));
          if (name) showToast(`${name} left`);
        });

        socket.on('room:users', (data: any) => {
          if (Array.isArray(data.users)) {
            setOnlineUsers(data.users.map((u: any) => ({
              userId: u.userId || u.id,
              displayName: u.displayName || u.display_name || u.username || '',
              color: userColor(u.userId || u.id),
            })));
          }
        });

        socket.on('board:media-arrived', (data: any) => {
          const assets = data?.assets;
          if (Array.isArray(assets) && assets.length > 0 && inboxZoneRef.current) {
            inboxZoneRef.current.addMedia(assets);
            showToast(`${assets.length} image${assets.length !== 1 ? 's' : ''} arrived in Inbox`);
          }
        });

        // Cursor tracking — throttled to ~30fps to avoid flooding the socket
        let cursorTimer: ReturnType<typeof setTimeout> | null = null;
        const onPointerMove = (e: any) => {
          if (cursorTimer) return;
          const world = viewport.toWorld(e.global.x, e.global.y);
          socket.emit('cursor:move', {
            boardId: resolvedBoardId,
            x: world.x,
            y: world.y,
          });
          cursorTimer = setTimeout(() => { cursorTimer = null; }, 33);
        };
        viewport.on('pointermove', onPointerMove);
      }

      // Setup drag/drop and paste
      if (!isPublicView || user) {
        const canvasElements = document.querySelectorAll('canvas');
        let domContainer: HTMLElement | null = null;
        for (const c of canvasElements) {
          if (c.parentElement && c.width > 100) {
            domContainer = c.parentElement;
            break;
          }
        }

        if (domContainer) {
          dropCleanupRef.current = setupDragDrop(domContainer, viewport, scene, resolvedBoardId, onCanvasChange);
          pasteCleanupRef.current = setupPaste(viewport, scene, resolvedBoardId, onCanvasChange);
        } else {
          pasteCleanupRef.current = setupPaste(viewport, scene, resolvedBoardId, onCanvasChange);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      selectionRef.current?.destroy();
      selectionRef.current = null;
      if (inboxZoneRef.current) {
        inboxZoneRef.current.clear();
        inboxZoneRef.current.destroy({ children: true });
        inboxZoneRef.current = null;
      }
      syncRef.current?.cleanup();
      dropCleanupRef.current?.();
      pasteCleanupRef.current?.();
      disconnectSocket();
    };
  }, [boardData, resolvedBoardId, user, isPublicView, onCanvasChange, showToast, canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef, setOnlineUsers, setSelectedLayerIds]);
}
