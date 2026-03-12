import { useEffect, useRef } from 'react';
import type { PixiCanvasHandle } from '../canvas/PixiCanvas';
import { SelectionManager } from '../canvas/SelectionManager';
import { TextEditor } from '../canvas/TextEditor';
import { setupSync, SyncHandle } from '../canvas/sync';
import { setupDragDrop, setupPaste } from '../canvas/image-drop';
import { UndoManager } from '../canvas/history';
import { InboxZone } from '../canvas/InboxZone';
import { LaserPointer } from '../canvas/LaserPointer';
import { VideoSprite } from '../canvas/sprites/VideoSprite';
import { ImageSprite } from '../canvas/sprites/ImageSprite';
import { UploadManager } from '../stores/uploadManager';
import { AnnotationStore } from '../stores/annotationStore';
import { PinOverlay } from '../canvas/PinOverlay';
import { CropOverlay } from '../canvas/CropOverlay';
import { TextSprite } from '../canvas/sprites/TextSprite';
import { StickySprite } from '../canvas/sprites/StickySprite';
import { TextSharpnessManager } from '../canvas/textSharpness';
// PresenceOverlay removed — remote selection highlighting was too heavy for minimal benefit
import { connectSocket, disconnectSocket } from '../socket';
import api from '../api';

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
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  uploadManager: UploadManager;
  onCanvasChange: (changedIds?: string[]) => void;
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
    canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef, canvasContainerRef,
    uploadManager, onCanvasChange, showToast, setOnlineUsers, setSelectedLayerIds,
  } = deps;

  const dropCleanupRef = useRef<(() => void) | null>(null);
  const pasteCleanupRef = useRef<(() => void) | null>(null);
  const laserCleanupRef = useRef<(() => void) | null>(null);
  const sharpnessCleanupRef = useRef<(() => void) | null>(null);
  const annotationStoreRef = useRef<AnnotationStore | null>(null);
  if (!annotationStoreRef.current) annotationStoreRef.current = new AnnotationStore();
  const pinOverlayRef = useRef<PinOverlay | null>(null);
  const textEditorRef = useRef<TextEditor | null>(null);
  if (!textEditorRef.current) textEditorRef.current = new TextEditor();
  const cropOverlayRef = useRef<CropOverlay | null>(null);

  useEffect(() => {
    if (!boardData || !resolvedBoardId) return;

    let attempts = 0;
    const maxAttempts = 100; // 5 seconds max (100 × 50ms)
    const poll = setInterval(() => {
      attempts++;
      const scene = canvasRef.current?.getScene();
      const viewport = canvasRef.current?.getViewport();
      if (!scene || !viewport) {
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          console.error('[canvas-setup] Canvas not ready after 5s, giving up');
        }
        return;
      }
      clearInterval(poll);

      // Create SelectionManager
      const selection = new SelectionManager(viewport, scene);
      selectionRef.current = selection;

      // Wire snap guides to transform box
      selection.transformBox.setSnapGuides(selection.snapGuides);

      // Wire selection change to update layer panel state
      selection.onSelectionChange = (ids: string[]) => {
        setSelectedLayerIds(ids);
      };

      // Inline text editing on double-click
      const textEditor = textEditorRef.current!;
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
          // If user saved empty text, remove the item
          const text = (item.data as any).text?.trim();
          if (!text) {
            scene.removeItem(item.id, true);
          }
          syncRef.current?.broadcastElements([item.id]);
          onCanvasChange();
        });
      };

      // Double-click image: zoom-to-fit (PureRef-style focus)
      selection.onDoubleClickImage = (item) => {
        const padding = 80; // screen pixels of padding around the image
        const screenW = viewport.screenWidth;
        const screenH = viewport.screenHeight;
        const bw = item.data.w * Math.abs(item.data.sx);
        const bh = item.data.h * Math.abs(item.data.sy);
        const scaleX = (screenW - padding * 2) / bw;
        const scaleY = (screenH - padding * 2) / bh;
        const targetScale = Math.min(scaleX, scaleY, 3); // cap at 3x
        const cx = item.data.x + bw / 2;
        const cy = item.data.y + bh / 2;
        viewport.animate({
          time: 300,
          position: { x: cx, y: cy },
          scale: targetScale,
          ease: 'easeOutQuad',
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

      // Zoom-bucket text sharpness — re-rasterize visible text when zoom crosses bucket boundary
      const sharpness = new TextSharpnessManager(viewport, scene);
      const onZoomBucketCheck = () => { sharpness.check(); };
      viewport.on('zoomed', onZoomBucketCheck);
      scene.onItemCreated = (item) => { sharpness.applyToItem(item); };
      sharpnessCleanupRef.current = () => {
        viewport.off('zoomed', onZoomBucketCheck);
        scene.onItemCreated = null;
        sharpness.destroy();
      };

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

        // Wire live drag/resize transforms to sync broadcast + pin position update
        // updatePositions() is the fast path — zero allocations, just position.set()
        selection.onItemsTransform = (items) => {
          syncRef.current?.broadcastTransform(items);
          pinOverlayRef.current?.updatePositions();
        };
        selection.onItemTransform = (item) => {
          syncRef.current?.broadcastTransform(item);
          pinOverlayRef.current?.updatePositions();
        };
        selection.transformBox.onItemTransform = (item) => {
          syncRef.current?.broadcastTransform(item);
          pinOverlayRef.current?.updatePositions();
        };
        selection.onObjectDragEnd = (itemIds) => {
          onCanvasChange(itemIds); // broadcasts elements + saves + undo + spatial refresh
        };
        selection.transformBox.onDragEnd = (itemIds) => {
          // Bake scale into fontSize for text/sticky items after resize
          for (const id of itemIds) {
            const item = scene.getById(id);
            if (!item) continue;
            const absSx = Math.abs(item.data.sx);
            const absSy = Math.abs(item.data.sy);
            if (absSx === 1 && absSy === 1) continue;

            if (item.type === 'text') {
              const scale = (absSx + absSy) / 2;
              const d = item.data as any;
              d.fontSize = Math.round(d.fontSize * scale);
              d.sx = item.data.sx > 0 ? 1 : -1;
              d.sy = item.data.sy > 0 ? 1 : -1;
              if (item.displayObject instanceof TextSprite) {
                item.displayObject.updateFromData(d);
                d.w = item.displayObject.measuredWidth;
                d.h = item.displayObject.measuredHeight;
              }
              item.displayObject.scale.set(d.sx, d.sy);
            } else if (item.type === 'sticky') {
              const d = item.data as any;
              // Bake width only — text re-wraps and height auto-adjusts.
              // fontSize stays stable so the card acts like a resizable text box.
              d.w = Math.max(80, Math.round(d.w * absSx));
              d.sx = item.data.sx > 0 ? 1 : -1;
              d.sy = item.data.sy > 0 ? 1 : -1;
              if (item.displayObject instanceof StickySprite) {
                item.displayObject.updateFromData(d);
                d.h = item.displayObject.computedHeight;
              }
              item.displayObject.scale.set(d.sx, d.sy);
            }
          }
          onCanvasChange(itemIds);
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

        // Media processing pipeline: upgrade videos when poster/metadata arrives
        socket.on('media:job:update', (data: any) => {
          if (!data) return;
          const { imageId, status } = data;
          if (!imageId) return;

          // Surface processing failures to upload manager
          if (status === 'failed') {
            uploadManager.processingFailed(imageId, data.error || 'Video processing failed');
            return;
          }
          if (status !== 'done') return;
          const { posterAssetKey, nativeWidth, nativeHeight, duration } = data;

          // Update upload manager — transitions video jobs from "processing" to "done"
          uploadManager.processingComplete(imageId);

          // Find the video item by matching its DB image ID stored in scene data
          for (const item of scene.items.values()) {
            if (item.data.type !== 'video') continue;
            // The asset key contains the imageId (e.g. boards/{boardId}/{imageId}.mp4)
            if (!item.data.asset?.includes(imageId)) continue;

            // Update scene data model
            const vidData = item.data as any;
            if (posterAssetKey) vidData.poster = posterAssetKey;
            if (nativeWidth) { vidData.nativeW = nativeWidth; vidData.w = nativeWidth; }
            if (nativeHeight) { vidData.nativeH = nativeHeight; vidData.h = nativeHeight; }
            if (duration) vidData.duration = duration;

            // Update rendered VideoSprite (dimensions, shadow, overlay, poster key)
            if (item.displayObject instanceof VideoSprite) {
              item.displayObject.applyProcessedMedia({ posterAssetKey, nativeWidth, nativeHeight });
            }

            // Update spatial index for changed dimensions
            scene.updateSpatialEntry(item);

            // No broadcastElements here — all clients receive the same
            // media:job:update from the server. Echoing would cause fanout churn.
            break;
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

        // ---- Laser pointer (hold L key) ----
        const laserColorHex = userColor(user?.id || '');
        const laserColorNum = parseInt(laserColorHex.replace('#', ''), 16);
        const laser = new LaserPointer(viewport, laserColorNum);

        let laserTimer: ReturnType<typeof setTimeout> | null = null;
        const onLaserMove = (e: any) => {
          if (!laser.isActive) return;
          const world = viewport.toWorld(e.global.x, e.global.y);
          laser.addPoint(world.x, world.y);
          // Throttle broadcast to ~50ms
          if (laserTimer) return;
          socket.volatile.emit('laser:move', {
            boardId: resolvedBoardId,
            points: [{ x: world.x, y: world.y }],
          });
          laserTimer = setTimeout(() => { laserTimer = null; }, 50);
        };
        viewport.on('pointermove', onLaserMove);

        const onKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'l' || e.key === 'L') {
            if (laser.isActive) return;
            laser.start();
          }
        };
        const onKeyUp = (e: KeyboardEvent) => {
          if (e.key === 'l' || e.key === 'L') {
            laser.stop();
            socket.emit('laser:stop', { boardId: resolvedBoardId });
          }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        laserCleanupRef.current = () => {
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
          laser.destroy();
        };

        // Listen for remote laser events
        socket.on('laser:move', (data: any) => {
          if (data.boardId !== resolvedBoardId) return;
          const uid = data.userId;
          if (!uid) return;
          const color = parseInt(userColor(uid).replace('#', ''), 16);
          laser.addRemotePoints(uid, data.points, color);
        });
        socket.on('laser:stop', (_data: any) => {
          // Remote user stopped — points will fade naturally
        });
        socket.on('user:left', (data: any) => {
          const uid = data.userId || data.id;
          if (uid) {
            laser.removeRemote(uid);
          }
        });

        // ── Annotations: load threads, wire socket events ──
        api.get(`/api/boards/${resolvedBoardId}/threads`)
          .then((res) => {
            if (res.data.threads) annotationStoreRef.current?.loadThreads(res.data.threads);
          })
          .catch((err) => console.error('[annotations] load threads error:', err));

        socket.on('thread:add', (data: any) => {
          annotationStoreRef.current?.onThreadAdd(data.thread, data.comment);
        });
        socket.on('thread:status', (data: any) => {
          annotationStoreRef.current?.onThreadStatus(data.threadId, data.status, data.resolvedBy, data.resolvedAt);
        });
        socket.on('thread:delete', (data: any) => {
          annotationStoreRef.current?.onThreadDelete(data.threadId);
        });
        socket.on('comment:add', (data: any) => {
          annotationStoreRef.current?.onCommentAdd(data.threadId, data.comment);
        });
        socket.on('comment:update', (data: any) => {
          annotationStoreRef.current?.onCommentUpdate(data.threadId, data.commentId, data.content, data.editedAt);
        });
        socket.on('comment:delete', (data: any) => {
          annotationStoreRef.current?.onCommentDelete(data.threadId, data.commentId);
        });
        // ── Pin overlay — separate Container, positions from item.data directly ──
        const pinOverlay = new PinOverlay(viewport, scene, annotationStoreRef.current!);
        pinOverlay.visible = true;
        viewport.addChild(pinOverlay);
        pinOverlayRef.current = pinOverlay;

        // Refresh on viewport move (zoom changes scale) and store changes
        const onViewportMoved = () => {
          pinOverlay.refresh();
        };
        viewport.on('moved', onViewportMoved);
        const unsubPinOverlay = annotationStoreRef.current!.subscribe(() => {
          pinOverlay.refresh();
        });
        (pinOverlay as any)._cleanup = () => {
          viewport.off('moved', onViewportMoved);
          unsubPinOverlay();
        };
      }

      // Crop overlay
      const cropOverlay = new CropOverlay(viewport);
      viewport.addChild(cropOverlay);
      cropOverlayRef.current = cropOverlay;

      cropOverlay.onConfirm = (item, crop) => {
        const imgData = item.data as any;
        const isFullImage = crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
        imgData.crop = isFullImage ? undefined : crop;
        if (item.displayObject instanceof ImageSprite) {
          item.displayObject.applyCrop(imgData.crop);
        }
        selection.setEnabled(true);
        onCanvasChange([item.id]);
      };

      cropOverlay.onCancel = () => {
        selection.setEnabled(true);
      };

      // Setup drag/drop and paste
      if (!isPublicView || user) {
        // Use the ref first, fall back to DOM query for the canvas parent
        let dropTarget: HTMLElement | null = canvasContainerRef.current;
        if (!dropTarget) {
          const canvasEl = document.querySelector('canvas');
          dropTarget = canvasEl?.parentElement ?? null;
        }
        if (dropTarget) {
          dropCleanupRef.current = setupDragDrop(dropTarget, viewport, scene, resolvedBoardId, onCanvasChange, selection, uploadManager);
        }
        pasteCleanupRef.current = setupPaste(viewport, scene, resolvedBoardId, onCanvasChange, selection, uploadManager);
      }
    }, 50);

    return () => {
      clearInterval(poll);
      selectionRef.current?.destroy();
      selectionRef.current = null;
      if (inboxZoneRef.current) {
        inboxZoneRef.current.clear();
        inboxZoneRef.current.destroy({ children: true });
        inboxZoneRef.current = null;
      }
      syncRef.current?.cleanup();
      laserCleanupRef.current?.();
      laserCleanupRef.current = null;
      dropCleanupRef.current?.();
      pasteCleanupRef.current?.();
      textEditorRef.current?.stopEditing(false);
      if (cropOverlayRef.current) {
        cropOverlayRef.current.destroy();
        cropOverlayRef.current = null;
      }
      if (pinOverlayRef.current) {
        (pinOverlayRef.current as any)._cleanup?.();
        pinOverlayRef.current.destroy();
        pinOverlayRef.current = null;
      }
      annotationStoreRef.current?.clear();
      sharpnessCleanupRef.current?.();
      sharpnessCleanupRef.current = null;
      disconnectSocket();
    };
  }, [boardData, resolvedBoardId, user, isPublicView, onCanvasChange, showToast, canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef, uploadManager, setOnlineUsers, setSelectedLayerIds]);

  return { annotationStore: annotationStoreRef.current, pinOverlay: pinOverlayRef.current, textEditor: textEditorRef.current, cropOverlayRef };
}
