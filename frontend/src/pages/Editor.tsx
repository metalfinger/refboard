import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PixiCanvas, { PixiCanvasHandle } from '../canvas/PixiCanvas';
import { SelectionManager } from '../canvas/SelectionManager';
import type { SceneItem } from '../canvas/SceneManager';
import type { AnySceneObject, GroupObject } from '../canvas/scene-format';
import { ToolType, activateTool, toolShortcuts } from '../canvas/tools';
import type { ToolContext } from '../canvas/tools';
import { setupSync } from '../canvas/sync';
import { setupDragDrop, setupPaste } from '../canvas/image-drop';
import { UndoManager } from '../canvas/history';
import { ShortcutContext, matchesShortcut, sortBySpecificity } from '../canvas/shortcuts';
import { shortcuts as shortcutDefs } from '../canvas/shortcut-definitions';
import * as ops from '../canvas/operations';
import { connectSocket, disconnectSocket, getSocket } from '../socket';
import { getBoard, saveCanvas } from '../api';
import { useAuth } from '../auth';
import Toolbar from '../components/Toolbar';
import StatusBar, { SaveStatus } from '../components/StatusBar';
import UserCursors from '../components/UserCursors';
import ContextMenu from '../components/ContextMenu';
import LayerPanel from '../components/LayerPanel';
import ShortcutsHelp from '../components/ShortcutsHelp';

// Pre-sort shortcuts by specificity (most modifiers first) for correct matching
const sortedShortcuts = sortBySpecificity(shortcutDefs);

interface EditorProps {
  isPublicView?: boolean;
}

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

export default function Editor({ isPublicView }: EditorProps) {
  const { boardId } = useParams<{ boardId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const canvasRef = useRef<PixiCanvasHandle>(null);
  const selectionRef = useRef<SelectionManager | null>(null);
  const undoRef = useRef<UndoManager | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncCleanupRef = useRef<(() => void) | null>(null);
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const pasteCleanupRef = useRef<(() => void) | null>(null);
  const toolCleanupRef = useRef<(() => void) | null>(null);

  const [boardData, setBoardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [color, setColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fontSize, setFontSize] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [objectCount, setObjectCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canvasTransform, setCanvasTransform] = useState([1, 0, 0, 1, 0, 0]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [showLayers, setShowLayers] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [layerList, setLayerList] = useState<any[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const clipboardRef = useRef<SceneItem[]>([]);

  const resolvedBoardId = boardId || boardData?.board?.id;

  // Load board data
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!boardId) {
          setError('No board specified');
          setLoading(false);
          return;
        }
        const res = await getBoard(boardId);
        if (!cancelled) {
          setBoardData(res.data);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Failed to load board');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [boardId]);

  // Debounced save
  const scheduleSave = useCallback(() => {
    if (!resolvedBoardId || isPublicView) return;
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const scene = canvasRef.current?.getScene();
      if (!scene) return;
      setSaveStatus('saving');
      try {
        const state = JSON.stringify(scene.serialize());

        // Generate thumbnail from PixiJS renderer
        let thumbnail: string | undefined;
        const items = scene.getAllItems();
        if (items.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const item of items) {
            const d = item.data;
            const w = d.w * d.sx;
            const h = d.h * d.sy;
            minX = Math.min(minX, d.x);
            minY = Math.min(minY, d.y);
            maxX = Math.max(maxX, d.x + w);
            maxY = Math.max(maxY, d.y + h);
          }
          const sceneW = maxX - minX;
          const sceneH = maxY - minY;
          if (sceneW > 0 && sceneH > 0) {
            try {
              const viewport = canvasRef.current?.getViewport();
              if (viewport) {
                // Use PixiJS renderer extract API
                const app = (viewport as any).parent?.parent;
                const renderer = app?.__pixiApplication?.renderer || (viewport as any).__renderer;
                // Simpler approach: extract the viewport as a canvas
                // We need the Application's renderer. Access it from the PixiCanvas internals.
                // For now, generate thumbnail from item bounds data
                const thumbSize = 400;
                const scale = Math.min(thumbSize / sceneW, thumbSize / sceneH);
                const pw = Math.ceil(sceneW * scale);
                const ph = Math.ceil(sceneH * scale);
                const offscreen = document.createElement('canvas');
                offscreen.width = pw;
                offscreen.height = ph;
                const ctx = offscreen.getContext('2d');
                if (ctx) {
                  ctx.fillStyle = '#1e1e1e';
                  ctx.fillRect(0, 0, pw, ph);
                  // Draw colored rectangles as placeholder thumbnail
                  for (const item of items) {
                    const d = item.data;
                    const rx = (d.x - minX) * scale;
                    const ry = (d.y - minY) * scale;
                    const rw = d.w * d.sx * scale;
                    const rh = d.h * d.sy * scale;
                    ctx.fillStyle = d.type === 'text' ? '#555' : '#444';
                    ctx.fillRect(rx, ry, rw, rh);
                  }
                  thumbnail = offscreen.toDataURL('image/webp', 0.6);
                }
              }
            } catch (thumbErr) {
              console.warn('Thumbnail generation failed:', thumbErr);
            }
          }
        }
        await saveCanvas(resolvedBoardId, state, thumbnail);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, 2000);
  }, [resolvedBoardId, isPublicView]);

  // Canvas change handler
  const onCanvasChange = useCallback(() => {
    scheduleSave();
    if (undoRef.current && !undoRef.current.isLocked()) {
      undoRef.current.saveState();
      setCanUndo(undoRef.current.canUndo());
      setCanRedo(undoRef.current.canRedo());
    }
    const z = canvasRef.current?.getZoom() ?? 1;
    setZoom(z);
    const scene = canvasRef.current?.getScene();
    if (scene) {
      setObjectCount(scene.getAllItems().length);
    }
    // Update canvas transform for grid overlay
    const vp = canvasRef.current?.getViewport();
    if (vp) {
      setCanvasTransform([vp.scale.x, 0, 0, vp.scale.y, vp.x, vp.y]);
    }
  }, [scheduleSave]);

  // Toast helper
  const showToast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  // Setup socket, sync, drag/drop, paste, selection after canvas is ready
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

      // Create UndoManager
      undoRef.current = new UndoManager(scene);

      if (user) {
        const socket = connectSocket();

        syncCleanupRef.current = setupSync(scene, socket, resolvedBoardId);

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

        // Cursor tracking: listen on viewport for pointermove
        const onPointerMove = (e: any) => {
          const world = viewport.toWorld(e.global.x, e.global.y);
          socket.emit('cursor:move', {
            boardId: resolvedBoardId,
            x: world.x,
            y: world.y,
          });
        };
        viewport.on('pointermove', onPointerMove);
      }

      // Setup drag/drop and paste (new signatures take container, viewport, scene)
      const container = viewport.parent?.parent as any;
      const canvasEl = container?.canvas?.parentElement || document.querySelector('[data-pixi-container]');
      const containerEl = (viewport as any).__pixiContainer || canvasEl?.parentElement;

      if (!isPublicView || user) {
        // Get the actual DOM container from the PixiCanvas div
        const pixiContainer = document.querySelector('[data-pixi-container]') as HTMLElement
          || (viewport as any)._events?.pointermove?.[0]?.context?.containerRef?.current
          || document.querySelector('.pixi-canvas-container') as HTMLElement;

        // Find the container div that holds the pixi canvas
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
          // Fallback: just set up paste (works on document level)
          pasteCleanupRef.current = setupPaste(viewport, scene, resolvedBoardId, onCanvasChange);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      selectionRef.current?.destroy();
      selectionRef.current = null;
      syncCleanupRef.current?.();
      dropCleanupRef.current?.();
      pasteCleanupRef.current?.();
      disconnectSocket();
    };
  }, [boardData, resolvedBoardId, user, isPublicView, onCanvasChange, showToast]);

  // Apply tool changes
  useEffect(() => {
    const viewport = canvasRef.current?.getViewport();
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    if (!viewport || !scene || !selection) return;

    // Find the DOM container for cursor changes
    const canvasElements = document.querySelectorAll('canvas');
    let domContainer: HTMLElement | null = null;
    for (const c of canvasElements) {
      if (c.parentElement && c.width > 100) {
        domContainer = c.parentElement;
        break;
      }
    }
    if (!domContainer) return;

    toolCleanupRef.current?.();
    const ctx: ToolContext = { viewport, scene, selection, container: domContainer, onChange: onCanvasChange };
    toolCleanupRef.current = activateTool(ctx, activeTool, { color, strokeWidth, fontSize });
  }, [activeTool, color, strokeWidth, fontSize, onCanvasChange]);

  // Write selected items (or full viewport) to system clipboard as PNG
  const writeCanvasToClipboard = useCallback(async (items?: SceneItem[]) => {
    const viewport = canvasRef.current?.getViewport();
    if (!viewport) return;

    try {
      // Use PixiJS extract API to get the viewport as a canvas
      const app = (viewport.parent as any)?.__pixiApplication;
      if (!app?.renderer?.extract) {
        showToast('Copy failed: renderer not available');
        return;
      }

      const fullCanvas = app.renderer.extract.canvas(viewport) as HTMLCanvasElement;

      let outputCanvas: HTMLCanvasElement;

      if (items && items.length > 0) {
        // Compute bounding rect of selected items in world space
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const item of items) {
          const bounds = item.displayObject.getBounds();
          minX = Math.min(minX, bounds.x);
          minY = Math.min(minY, bounds.y);
          maxX = Math.max(maxX, bounds.x + bounds.width);
          maxY = Math.max(maxY, bounds.y + bounds.height);
        }

        // Convert world bounds to screen coords
        const topLeft = viewport.toScreen(minX, minY);
        const bottomRight = viewport.toScreen(maxX, maxY);

        const pad = 10;
        const cx = Math.max(0, Math.floor(topLeft.x - pad));
        const cy = Math.max(0, Math.floor(topLeft.y - pad));
        const cw = Math.min(Math.ceil(bottomRight.x - topLeft.x + pad * 2), fullCanvas.width - cx);
        const ch = Math.min(Math.ceil(bottomRight.y - topLeft.y + pad * 2), fullCanvas.height - cy);
        if (cw <= 0 || ch <= 0) return;

        outputCanvas = document.createElement('canvas');
        outputCanvas.width = cw;
        outputCanvas.height = ch;
        const ctx = outputCanvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(fullCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
      } else {
        outputCanvas = fullCanvas;
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        outputCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('toBlob returned null'));
        }, 'image/png');
      });

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch (err: any) {
      console.error('writeCanvasToClipboard failed:', err);
      showToast('Copy failed: ' + (err.message || 'clipboard not available'));
    }
  }, [showToast]);

  // Refresh layer list from scene
  const nameCounters = useRef<Record<string, number>>({});

  function autoName(item: SceneItem, i: number): string {
    if (item.data.name) return item.data.name;
    const type = item.data.type;
    if (type === 'image') {
      nameCounters.current.image = (nameCounters.current.image || 0) + 1;
      return `Image ${nameCounters.current.image}`;
    }
    if (type === 'text') {
      const textData = item.data as any;
      return (textData.text || 'Text').slice(0, 20);
    }
    if (type === 'group') {
      const groupData = item.data as GroupObject;
      return `Group (${groupData.children?.length || 0})`;
    }
    return `${type} ${i + 1}`;
  }

  function buildLayerItem(item: SceneItem, i: number): any {
    const isGroup = item.data.type === 'group';
    let children: any[] | undefined;
    if (isGroup) {
      const groupData = item.data as GroupObject;
      const scene = canvasRef.current?.getScene();
      if (scene && groupData.children) {
        children = groupData.children.map((childId, ci) => {
          const childItem = scene.getById(childId);
          if (childItem) return buildLayerItem(childItem, ci);
          return { id: childId, name: `Missing ${childId.slice(0, 6)}`, type: 'unknown', visible: true, locked: false, isGroup: false };
        });
      }
    }
    return {
      id: item.id,
      name: autoName(item, i),
      type: item.data.type,
      visible: item.data.visible,
      locked: item.data.locked,
      isGroup,
      children,
    };
  }

  const refreshLayers = useCallback(() => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return;
    nameCounters.current = {};
    const items = scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
    const layers = items.map((item, i) => buildLayerItem(item, i));
    setLayerList(layers);

    const selection = selectionRef.current;
    if (selection) {
      setSelectedLayerIds(Array.from(selection.selectedIds));
    }
  }, []);

  // Update layers whenever canvas changes
  useEffect(() => {
    if (!showLayers) return;
    refreshLayers();
    const interval = setInterval(refreshLayers, 500);
    return () => clearInterval(interval);
  }, [showLayers, refreshLayers]);

  // Group selected objects
  const handleGroup = useCallback(() => {
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    if (!scene || !selection) return;
    const selected = selection.getSelectedItems();
    if (selected.length < 2) return;

    // Create a group item containing the selected items' IDs
    const groupData: GroupObject = {
      id: crypto.randomUUID(),
      type: 'group',
      x: Math.min(...selected.map((s) => s.data.x)),
      y: Math.min(...selected.map((s) => s.data.y)),
      w: 0,
      h: 0,
      sx: 1,
      sy: 1,
      angle: 0,
      z: scene.nextZ(),
      opacity: 1,
      locked: false,
      name: '',
      visible: true,
      children: selected.map((s) => s.id),
    };

    // Create the group container and reparent children
    scene._createItem(groupData, false);
    const groupItem = scene.getById(groupData.id);
    if (groupItem) {
      for (const child of selected) {
        // Reparent display object into group container
        child.displayObject.parent?.removeChild(child.displayObject);
        groupItem.displayObject.addChild(child.displayObject);
        // Adjust child position relative to group
        child.displayObject.position.set(
          child.data.x - groupData.x,
          child.data.y - groupData.y,
        );
      }
    }

    selection.clear();
    if (groupItem) selection.selectOnly(groupItem.id);
    scene._applyZOrder();
    onCanvasChange();
    refreshLayers();
  }, [onCanvasChange, refreshLayers]);

  // Ungroup selected group
  const handleUngroup = useCallback(() => {
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    if (!scene || !selection) return;
    const selected = selection.getSelectedItems();
    if (selected.length !== 1) return;
    const groupItem = selected[0];
    if (groupItem.data.type !== 'group') return;

    const groupData = groupItem.data as GroupObject;
    const viewport = canvasRef.current?.getViewport();
    if (!viewport) return;

    // Reparent children back to viewport
    for (const childId of groupData.children) {
      const childItem = scene.getById(childId);
      if (childItem) {
        // Convert position back to world space
        childItem.data.x += groupData.x;
        childItem.data.y += groupData.y;
        childItem.displayObject.parent?.removeChild(childItem.displayObject);
        viewport.addChild(childItem.displayObject);
        childItem.displayObject.position.set(childItem.data.x, childItem.data.y);
      }
    }

    // Remove the group item
    scene.removeItem(groupItem.id, false);
    selection.clear();
    scene._applyZOrder();
    onCanvasChange();
    refreshLayers();
  }, [onCanvasChange, refreshLayers]);

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contextMenuItems = useCallback(() => {
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    const selected = selection ? selection.getSelectedItems() : [];
    const hasSel = selected.length > 0;
    const multiSel = selected.length >= 2;

    return [
      { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => {
        if (hasSel) { clipboardRef.current = [...selected]; writeCanvasToClipboard(selected); }
        else writeCanvasToClipboard();
      } },
      { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => {
        if (!scene || !hasSel || !selection) return;
        clipboardRef.current = [...selected];
        for (const item of selected) scene.removeItem(item.id, true);
        selection.clear();
        onCanvasChange();
      }, disabled: !hasSel },
      { label: 'Paste', shortcut: 'Ctrl+V', onClick: async () => {
        if (!scene || clipboardRef.current.length === 0) return;
        for (const original of clipboardRef.current) {
          const newData = {
            ...original.data,
            id: crypto.randomUUID(),
            x: original.data.x + 20,
            y: original.data.y + 20,
            z: scene.nextZ(),
          };
          await scene._createItem(newData, true);
        }
        scene._applyZOrder();
        onCanvasChange();
      }, disabled: clipboardRef.current.length === 0 },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: async () => {
        if (!scene || !hasSel) return;
        for (const original of selected) {
          const newData = {
            ...original.data,
            id: crypto.randomUUID(),
            x: original.data.x + 20,
            y: original.data.y + 20,
            z: scene.nextZ(),
          };
          await scene._createItem(newData, true);
        }
        if (selection) selection.clear();
        scene._applyZOrder();
        onCanvasChange();
      }, disabled: !hasSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // -- Alignment --
      { label: 'Align Left', shortcut: 'Ctrl+\u2190', onClick: () => { ops.alignLeft(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Align Right', shortcut: 'Ctrl+\u2192', onClick: () => { ops.alignRight(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Align Top', shortcut: 'Ctrl+\u2191', onClick: () => { ops.alignTop(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Align Bottom', shortcut: 'Ctrl+\u2193', onClick: () => { ops.alignBottom(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Distribute H', shortcut: '', onClick: () => { ops.distributeHorizontal(selected); onCanvasChange(); }, disabled: selected.length < 3 },
      { label: 'Distribute V', shortcut: '', onClick: () => { ops.distributeVertical(selected); onCanvasChange(); }, disabled: selected.length < 3 },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // -- Layer ordering --
      { label: 'Bring Forward', shortcut: ']', onClick: () => {
        if (!scene) return;
        const all = scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
        const selectedIds = new Set(selected.map((s) => s.id));
        for (let i = all.length - 2; i >= 0; i--) {
          if (selectedIds.has(all[i].id) && !selectedIds.has(all[i + 1].id)) {
            const tmp = all[i].data.z;
            all[i].data.z = all[i + 1].data.z;
            all[i + 1].data.z = tmp;
          }
        }
        scene._applyZOrder();
        onCanvasChange();
      }, disabled: !hasSel },
      { label: 'Send Backward', shortcut: '[', onClick: () => {
        if (!scene) return;
        const all = scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
        const selectedIds = new Set(selected.map((s) => s.id));
        for (let i = 1; i < all.length; i++) {
          if (selectedIds.has(all[i].id) && !selectedIds.has(all[i - 1].id)) {
            const tmp = all[i].data.z;
            all[i].data.z = all[i - 1].data.z;
            all[i - 1].data.z = tmp;
          }
        }
        scene._applyZOrder();
        onCanvasChange();
      }, disabled: !hasSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // -- Group --
      { label: 'Group', shortcut: 'Ctrl+G', onClick: handleGroup, disabled: !multiSel },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: handleUngroup,
        disabled: selected.length !== 1 || selected[0]?.data.type !== 'group' },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // -- Arrangement --
      { label: 'Arrange Pack', shortcut: 'Ctrl+Shift+P', onClick: () => { ops.arrangeOptimal(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Arrange Grid', shortcut: '', onClick: () => { ops.arrangeGrid(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Arrange Row', shortcut: '', onClick: () => { ops.arrangeRow(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Arrange Column', shortcut: '', onClick: () => { ops.arrangeColumn(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Stack', shortcut: 'Ctrl+Alt+S', onClick: () => { ops.stackObjects(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // -- Normalize --
      { label: 'Normalize Size', shortcut: '', onClick: () => { ops.normalizeSize(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Normalize Width', shortcut: '', onClick: () => { ops.normalizeWidth(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: 'Normalize Height', shortcut: '', onClick: () => { ops.normalizeHeight(selected); onCanvasChange(); }, disabled: !multiSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // -- Image --
      { label: 'Flip Horizontal', shortcut: 'Alt+Shift+H', onClick: () => { ops.flipHorizontal(selected); onCanvasChange(); }, disabled: !hasSel },
      { label: 'Flip Vertical', shortcut: 'Alt+Shift+V', onClick: () => { ops.flipVertical(selected); onCanvasChange(); }, disabled: !hasSel },
      { label: 'Reset Transform', shortcut: 'Ctrl+Shift+T', onClick: () => { ops.resetTransform(selected); onCanvasChange(); }, disabled: !hasSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Select All', shortcut: 'Ctrl+A', onClick: () => {
        if (selection) selection.selectAll();
      } },
      { label: 'Fit All', shortcut: 'Ctrl+0', onClick: () => canvasRef.current?.fitAll() },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Delete', shortcut: 'Del', onClick: () => {
        if (!scene || !selection) return;
        for (const item of selected) scene.removeItem(item.id, true);
        selection.clear();
        onCanvasChange();
      }, disabled: !hasSel, danger: true },
    ];
  }, [writeCanvasToClipboard, onCanvasChange, handleGroup, handleUngroup]);

  // Keyboard shortcuts -- registry-based approach
  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const scene = canvasRef.current?.getScene();
      const selection = selectionRef.current;
      const viewport = canvasRef.current?.getViewport();
      if (!scene || !selection || !viewport) return;

      // Tool shortcuts (bare keys 1-5, v/h/p/t/e -- no modifiers)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = toolShortcuts[e.key.toLowerCase()];
        if (tool) {
          setActiveTool(tool);
          return;
        }
      }

      // Special: Ctrl+V paste -- if internal clipboard is empty, let browser/setupPaste handle it
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey && !e.altKey) {
        if (clipboardRef.current.length === 0) return;
      }

      // Build context for shortcut handlers
      const ctx: ShortcutContext = {
        scene,
        selection,
        history: undoRef.current!,
        viewport,
        onChange: onCanvasChange,
        clipboardRef,
        writeCanvasToClipboard,
        showToast,
        fitAll: () => canvasRef.current?.fitAll(),
        setActiveTool,
        setCanUndo,
        setCanRedo,
        refreshLayers,
        handleGroup,
        handleUngroup,
        toggleGrid: () => setShowGrid((v) => !v),
        toggleShowHelp: () => setShowHelp((v) => !v),
      };

      // Match against sorted registry (most-specific first)
      for (const def of sortedShortcuts) {
        if (!matchesShortcut(e, def)) continue;

        // Check selection requirements
        const activeCount = selection.selectedIds.size;
        if (def.needsSelection && activeCount === 0) continue;
        if (def.minSelection && activeCount < def.minSelection) continue;

        e.preventDefault();
        await def.handler(ctx);

        // Update zoom display after any action
        setZoom(canvasRef.current?.getZoom() ?? 1);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCanvasChange, writeCanvasToClipboard, handleGroup, handleUngroup, showToast, refreshLayers]);

  // Save on page unload
  useEffect(() => {
    function onBeforeUnload() {
      const scene = canvasRef.current?.getScene();
      if (!scene || !resolvedBoardId) return;
      const state = JSON.stringify(scene.serialize());
      const blob = new Blob([JSON.stringify({ canvas_state: state })], { type: 'application/json' });
      navigator.sendBeacon(`/api/boards/${resolvedBoardId}/save`, blob);
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [resolvedBoardId]);

  // Update zoom from canvas
  useEffect(() => {
    const interval = setInterval(() => {
      const z = canvasRef.current?.getZoom() ?? 1;
      setZoom(z);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a1a', color: '#666', fontSize: '14px' }}>
        Loading board...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a1a', color: '#e0e0e0', gap: '16px' }}>
        <div style={{ color: '#ff6b6b', fontSize: '14px' }}>{error}</div>
        <button onClick={() => navigate('/')} style={{ padding: '8px 20px', background: '#4a9eff', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>
          Back to boards
        </button>
      </div>
    );
  }

  const board = boardData?.board;
  const collection = boardData?.collection;
  const canvasState = board?.canvas_state;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a1a' }}>
      {/* Breadcrumb header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', height: '32px', background: '#1e1e1e',
        borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0', fontSize: '12px', minWidth: 0 }}>
          {user && (
            <>
              <span
                style={{ color: '#666', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => navigate('/')}
                onMouseEnter={(e) => e.currentTarget.style.color = '#aaa'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
              >
                {user.display_name || user.username || user.email}
              </span>
              <span style={{ color: '#444', margin: '0 6px' }}>/</span>
            </>
          )}
          {collection && (
            <>
              <span
                style={{ color: '#888', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => navigate(`/collection/${collection.id}`)}
                onMouseEnter={(e) => e.currentTarget.style.color = '#ccc'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#888'}
              >
                {collection.name}
              </span>
              <span style={{ color: '#444', margin: '0 6px' }}>/</span>
            </>
          )}
          <span style={{ color: '#ccc', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {board?.name || 'Untitled'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusIndicator status={saveStatus} />
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        color={color}
        onColorChange={setColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        zoom={zoom}
        onFitAll={() => canvasRef.current?.fitAll()}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => {
          undoRef.current?.undo();
          setCanUndo(undoRef.current?.canUndo() ?? false);
          setCanRedo(undoRef.current?.canRedo() ?? false);
        }}
        onRedo={() => {
          undoRef.current?.redo();
          setCanUndo(undoRef.current?.canUndo() ?? false);
          setCanRedo(undoRef.current?.canRedo() ?? false);
        }}
        onZoomIn={() => {
          const vp = canvasRef.current?.getViewport();
          if (!vp) return;
          const z = Math.min(vp.scale.x * 1.2, 5);
          canvasRef.current?.setZoom(z);
          setZoom(z);
        }}
        onZoomOut={() => {
          const vp = canvasRef.current?.getViewport();
          if (!vp) return;
          const z = Math.max(vp.scale.x / 1.2, 0.1);
          canvasRef.current?.setZoom(z);
          setZoom(z);
        }}
        onlineUsers={onlineUsers}
        onToggleLayers={() => setShowLayers((v) => !v)}
        showLayers={showLayers}
        onToggleHelp={() => setShowHelp((v) => !v)}
        boardName={board?.name}
      />

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }} onContextMenu={handleContextMenu}>
        <PixiCanvas
          ref={canvasRef}
          canvasState={canvasState}
          currentTool={activeTool}
          boardId={resolvedBoardId}
          onChange={onCanvasChange}
        />
        <UserCursors
          socket={getSocket()}
          boardId={resolvedBoardId || ''}
          canvasTransform={canvasTransform}
        />

        {/* Grid overlay */}
        {showGrid && (
          <svg
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
            width="100%" height="100%"
          >
            <defs>
              <pattern id="grid50" width={50 * (canvasTransform[0] || 1)} height={50 * (canvasTransform[3] || 1)} patternUnits="userSpaceOnUse"
                x={(canvasTransform[4] || 0) % (50 * (canvasTransform[0] || 1))}
                y={(canvasTransform[5] || 0) % (50 * (canvasTransform[3] || 1))}>
                <line x1="0" y1="0" x2={50 * (canvasTransform[0] || 1)} y2="0" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                <line x1="0" y1="0" x2="0" y2={50 * (canvasTransform[3] || 1)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid50)" />
          </svg>
        )}

        {/* Empty canvas guide */}
        {objectCount === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            pointerEvents: 'none', textAlign: 'center', color: '#555', userSelect: 'none',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>+</div>
            <div style={{ fontSize: '14px', marginBottom: '6px' }}>Drop images here</div>
            <div style={{ fontSize: '11px', color: '#444' }}>
              or paste from clipboard (Ctrl+V) · Draw (P) · Add text (T)
            </div>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems()}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Layer panel */}
        {showLayers && (
          <LayerPanel
            layers={layerList}
            selectedIds={selectedLayerIds}
            onSelect={(id) => {
              const selection = selectionRef.current;
              if (selection) {
                selection.selectOnly(id);
              }
            }}
            onToggleVisible={(id) => {
              const scene = canvasRef.current?.getScene();
              if (!scene) return;
              const item = scene.getById(id);
              if (item) {
                item.data.visible = !item.data.visible;
                item.displayObject.visible = item.data.visible;
                onCanvasChange();
                refreshLayers();
              }
            }}
            onToggleLock={(id) => {
              const scene = canvasRef.current?.getScene();
              if (!scene) return;
              const item = scene.getById(id);
              if (item) {
                item.data.locked = !item.data.locked;
                item.displayObject.eventMode = item.data.locked ? 'none' : 'static';
                refreshLayers();
              }
            }}
            onReorder={(from, to) => {
              const scene = canvasRef.current?.getScene();
              if (!scene) return;
              const items = scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
              if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
              // Swap z values
              const tmp = items[from].data.z;
              items[from].data.z = items[to].data.z;
              items[to].data.z = tmp;
              scene._applyZOrder();
              onCanvasChange();
              refreshLayers();
            }}
            onDelete={(id) => {
              const scene = canvasRef.current?.getScene();
              const selection = selectionRef.current;
              if (!scene) return;
              scene.removeItem(id, true);
              if (selection) selection.clear();
              onCanvasChange();
              refreshLayers();
            }}
            onRename={(id, name) => {
              const scene = canvasRef.current?.getScene();
              if (!scene) return;
              const item = scene.getById(id);
              if (item) {
                item.data.name = name;
                refreshLayers();
              }
            }}
            onGroup={handleGroup}
            onUngroup={handleUngroup}
            hasSelection={(selectionRef.current?.selectedIds.size ?? 0) > 1}
            hasGroupSelection={(() => {
              const sel = selectionRef.current;
              if (!sel || sel.selectedIds.size !== 1) return false;
              const scene = canvasRef.current?.getScene();
              if (!scene) return false;
              const id = Array.from(sel.selectedIds)[0];
              const item = scene.getById(id);
              return item?.data.type === 'group';
            })()}
          />
        )}

        {/* Toasts */}
        <div style={{
          position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center',
          pointerEvents: 'none', zIndex: 500,
        }}>
          {toasts.map((t) => (
            <div key={t.id} style={{
              padding: '6px 16px', background: 'rgba(20,20,20,0.95)', border: '1px solid #333',
              borderRadius: '8px', color: '#ccc', fontSize: '12px',
              backdropFilter: 'blur(8px)',
            }}>
              {t.text}
            </div>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        boardName={board?.name || 'Untitled'}
        imageCount={objectCount}
        saveStatus={saveStatus}
      />

      {/* Shortcuts help overlay */}
      {showHelp && (
        <ShortcutsHelp shortcuts={shortcutDefs} onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}

function StatusIndicator({ status }: { status: SaveStatus }) {
  const cfg = {
    saved: { color: '#4ade80', label: 'Saved' },
    saving: { color: '#facc15', label: 'Saving...' },
    unsaved: { color: '#f87171', label: 'Unsaved' },
  };
  const s = cfg[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.color }} />
      <span style={{ fontSize: '10px', color: '#666' }}>{s.label}</span>
    </div>
  );
}
