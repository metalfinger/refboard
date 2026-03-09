import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FabricObject, FabricImage, Group } from 'fabric';
import FabricCanvas, { FabricCanvasHandle } from '../canvas/FabricCanvas';
import { ToolType, activateTool, toolShortcuts } from '../canvas/tools';
import { setupSync, isRemoteUpdate } from '../canvas/sync';
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

  const canvasRef = useRef<FabricCanvasHandle>(null);
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
  const clipboardRef = useRef<FabricObject[]>([]);

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
      const canvas = canvasRef.current?.getCanvas();
      if (!canvas) return;
      setSaveStatus('saving');
      try {
        const state = JSON.stringify((canvas as any).toJSON(['id', 'crossOrigin']));
        // Generate a small thumbnail preview of the canvas content
        let thumbnail: string | undefined;
        const objects = canvas.getObjects();
        if (objects.length > 0) {
          // Use scene-space coordinates (obj.left/top + scaled dimensions)
          // NOT getBoundingRect() which returns viewport/screen-space
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          objects.forEach((obj: any) => {
            const l = obj.left ?? 0;
            const t = obj.top ?? 0;
            const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
            const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
            minX = Math.min(minX, l);
            minY = Math.min(minY, t);
            maxX = Math.max(maxX, l + w);
            maxY = Math.max(maxY, t + h);
          });
          const sceneW = maxX - minX;
          const sceneH = maxY - minY;
          if (sceneW > 0 && sceneH > 0) {
            const origVpt = [...canvas.viewportTransform!];
            try {
              const thumbSize = 400;
              const scale = Math.min(thumbSize / sceneW, thumbSize / sceneH);
              const pw = Math.ceil(sceneW * scale);
              const ph = Math.ceil(sceneH * scale);
              canvas.setViewportTransform([
                scale, 0, 0, scale,
                -minX * scale, -minY * scale,
              ]);
              const thumbCanvas = canvas.toCanvasElement(1, {
                left: 0, top: 0, width: pw, height: ph,
              });
              thumbnail = thumbCanvas.toDataURL('image/webp', 0.6);
            } catch (thumbErr) {
              console.warn('Thumbnail generation failed:', thumbErr);
            } finally {
              // ALWAYS restore viewport — even if toCanvasElement/toDataURL throws
              canvas.setViewportTransform(origVpt as any);
              canvas.requestRenderAll();
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

  // Canvas change handler — skips remote updates to avoid resetting save timer
  const onCanvasChange = useCallback(() => {
    if (isRemoteUpdate()) return;
    scheduleSave();
    if (undoRef.current && !undoRef.current.isLocked()) {
      undoRef.current.saveState();
      setCanUndo(undoRef.current.canUndo());
      setCanRedo(undoRef.current.canRedo());
    }
    const z = canvasRef.current?.getZoom() ?? 1;
    setZoom(z);
    const canvas = canvasRef.current?.getCanvas();
    if (canvas) {
      if (canvas.viewportTransform) {
        setCanvasTransform([...canvas.viewportTransform]);
      }
      setObjectCount(canvas.getObjects().length);
    }
  }, [scheduleSave]);

  // Toast helper
  const showToast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  // Setup socket, sync, drag/drop, paste after canvas is ready
  useEffect(() => {
    if (!boardData || !resolvedBoardId) return;

    const timer = setTimeout(() => {
      const canvas = canvasRef.current?.getCanvas();
      if (!canvas) return;

      undoRef.current = new UndoManager(canvas);

      if (user) {
        const socket = connectSocket();

        syncCleanupRef.current = setupSync(canvas, socket, resolvedBoardId);

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

        canvas.on('mouse:move', (e: any) => {
          const pointer = canvas.getScenePoint(e.e);
          socket.emit('cursor:move', {
            boardId: resolvedBoardId,
            x: pointer.x,
            y: pointer.y,
          });
        });
      }

      if (!isPublicView || user) {
        dropCleanupRef.current = setupDragDrop(canvas, resolvedBoardId, onCanvasChange);
        pasteCleanupRef.current = setupPaste(canvas, resolvedBoardId, onCanvasChange);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      syncCleanupRef.current?.();
      dropCleanupRef.current?.();
      pasteCleanupRef.current?.();
      disconnectSocket();
    };
  }, [boardData, resolvedBoardId, user, isPublicView, onCanvasChange, showToast]);

  // Apply tool changes
  useEffect(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    toolCleanupRef.current?.();
    toolCleanupRef.current = activateTool(canvas, activeTool, { color, strokeWidth, fontSize });
  }, [activeTool, color, strokeWidth, fontSize]);

  // Clone a fabric object using Fabric's native clone() method
  const cloneFabricObject = useCallback(async (obj: any, offsetX = 0, offsetY = 0): Promise<any> => {
    const cloned = await obj.clone();
    cloned.set({
      left: (cloned.left || 0) + offsetX,
      top: (cloned.top || 0) + offsetY,
    });
    (cloned as any).id = crypto.randomUUID();
    return cloned;
  }, []);

  // Write canvas content to system clipboard as PNG.
  // If objects are provided, crop to their bounds. Otherwise copy entire canvas.
  const writeCanvasToClipboard = useCallback(async (objects?: FabricObject[]) => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    try {
      // Save & clear selection so handles don't appear in screenshot
      const activeObj = canvas.getActiveObject();
      canvas.discardActiveObject();
      // renderAll is SYNCHRONOUS — ensures handles are gone before capture
      canvas.renderAll();

      // Capture full canvas — may throw if canvas is tainted (images without crossOrigin)
      let fullCanvas: HTMLCanvasElement;
      try {
        fullCanvas = (canvas as any).toCanvasElement(1);
      } catch (taintErr) {
        // Canvas is tainted — fall back to re-rendering without tainted images
        console.warn('Canvas tainted, attempting fallback:', taintErr);
        if (activeObj) {
          canvas.setActiveObject(activeObj);
          canvas.renderAll();
        }
        showToast('Copy failed — try re-opening the board');
        return;
      }

      // Restore selection immediately
      if (activeObj) {
        canvas.setActiveObject(activeObj);
        canvas.renderAll();
      }

      let outputCanvas: HTMLCanvasElement;

      if (objects && objects.length > 0) {
        // Compute bounding rect of the specified objects.
        // getBoundingRect returns screen-space coords (includes viewport transform).
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const obj of objects) {
          const br = obj.getBoundingRect();
          minX = Math.min(minX, br.left);
          minY = Math.min(minY, br.top);
          maxX = Math.max(maxX, br.left + br.width);
          maxY = Math.max(maxY, br.top + br.height);
        }

        const pad = 10;
        const cx = Math.max(0, Math.floor(minX - pad));
        const cy = Math.max(0, Math.floor(minY - pad));
        const cw = Math.min(Math.ceil(maxX - minX + pad * 2), fullCanvas.width - cx);
        const ch = Math.min(Math.ceil(maxY - minY + pad * 2), fullCanvas.height - cy);
        if (cw <= 0 || ch <= 0) return;

        outputCanvas = document.createElement('canvas');
        outputCanvas.width = cw;
        outputCanvas.height = ch;
        const ctx = outputCanvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(fullCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
      } else {
        // No specific objects → copy entire canvas as-is
        outputCanvas = fullCanvas;
      }

      // Convert to blob using promise wrapper (keeps user activation alive)
      const blob = await new Promise<Blob>((resolve, reject) => {
        outputCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('toBlob returned null'));
        }, 'image/png');
      });

      // Write to system clipboard — requires HTTPS or localhost
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch (err: any) {
      console.error('writeCanvasToClipboard failed:', err);
      showToast('Copy failed: ' + (err.message || 'clipboard not available'));
    }
  }, [showToast]);

  // Refresh layer list from canvas
  // Auto-name counters
  const nameCounters = useRef<Record<string, number>>({});

  function autoName(obj: any, i: number): string {
    if (obj.name) return obj.name;
    const type = obj.type || 'object';
    if (type === 'image') {
      nameCounters.current.image = (nameCounters.current.image || 0) + 1;
      return `Image ${nameCounters.current.image}`;
    }
    if (type === 'i-text') return (obj.text || 'Text').slice(0, 20);
    if (type === 'path') {
      nameCounters.current.path = (nameCounters.current.path || 0) + 1;
      return `Drawing ${nameCounters.current.path}`;
    }
    if (type === 'group') return `Group (${obj._objects?.length || 0})`;
    return `${type} ${i + 1}`;
  }

  function buildLayerItem(obj: any, i: number): any {
    const id = obj.id || `layer-${i}`;
    const isGroup = obj.type === 'group';
    let children: any[] | undefined;
    if (isGroup && obj._objects) {
      children = obj._objects.map((child: any, ci: number) => buildLayerItem(child, ci));
    }
    return {
      id,
      name: autoName(obj, i),
      type: obj.type || 'object',
      visible: obj.visible !== false,
      locked: !obj.selectable,
      isGroup,
      children,
    };
  }

  const refreshLayers = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    nameCounters.current = {};
    const objects = canvas.getObjects();
    const layers = objects.map((obj: any, i: number) => buildLayerItem(obj, i));
    setLayerList(layers);
    const activeIds = canvas.getActiveObjects().map((o: any) => o.id).filter(Boolean);
    setSelectedLayerIds(activeIds);
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
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length < 2) return;
    canvas.discardActiveObject();
    const group = new Group(active, {});
    (group as any).id = crypto.randomUUID();
    active.forEach((obj) => canvas.remove(obj));
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    onCanvasChange();
    refreshLayers();
  }, [onCanvasChange, refreshLayers]);

  // Ungroup selected group
  const handleUngroup = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'group') return;
    const group = active as Group;
    const items = group.removeAll();
    canvas.remove(group);
    items.forEach((obj: any) => {
      obj.id = obj.id || crypto.randomUUID();
      canvas.add(obj);
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    onCanvasChange();
    refreshLayers();
  }, [onCanvasChange, refreshLayers]);

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contextMenuItems = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    const active = canvas ? canvas.getActiveObjects() : [];
    const hasSel = active.length > 0;
    const multiSel = active.length >= 2;
    const run = (fn: (objs: FabricObject[]) => void) => {
      if (!canvas) return;
      const { objects, restore } = ops.breakSelection(canvas);
      fn(objects);
      restore();
      canvas.requestRenderAll(); onCanvasChange();
    };
    return [
      { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => {
        if (!canvas) return;
        if (hasSel) { clipboardRef.current = [...active]; writeCanvasToClipboard(active); }
        else writeCanvasToClipboard();
      } },
      { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => {
        if (!canvas || !hasSel) return;
        clipboardRef.current = [...active];
        active.forEach((o) => canvas.remove(o));
        canvas.discardActiveObject(); canvas.requestRenderAll(); onCanvasChange();
      }, disabled: !hasSel },
      { label: 'Paste', shortcut: 'Ctrl+V', onClick: async () => {
        if (!canvas || clipboardRef.current.length === 0) return;
        for (const o of clipboardRef.current) {
          try { const c = await cloneFabricObject(o, 20, 20); canvas.add(c); } catch {}
        }
        canvas.requestRenderAll(); onCanvasChange();
      }, disabled: clipboardRef.current.length === 0 },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: async () => {
        if (!canvas || !hasSel) return;
        for (const o of active) {
          try { const c = await cloneFabricObject(o, 20, 20); canvas.add(c); } catch {}
        }
        canvas.discardActiveObject(); canvas.requestRenderAll(); onCanvasChange();
      }, disabled: !hasSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // — Alignment —
      { label: 'Align Left', shortcut: 'Ctrl+\u2190', onClick: () => run((o) => ops.alignLeft(o)), disabled: !multiSel },
      { label: 'Align Right', shortcut: 'Ctrl+\u2192', onClick: () => run((o) => ops.alignRight(o)), disabled: !multiSel },
      { label: 'Align Top', shortcut: 'Ctrl+\u2191', onClick: () => run((o) => ops.alignTop(o)), disabled: !multiSel },
      { label: 'Align Bottom', shortcut: 'Ctrl+\u2193', onClick: () => run((o) => ops.alignBottom(o)), disabled: !multiSel },
      { label: 'Distribute H', shortcut: '', onClick: () => run((o) => ops.distributeHorizontal(o)), disabled: active.length < 3 },
      { label: 'Distribute V', shortcut: '', onClick: () => run((o) => ops.distributeVertical(o)), disabled: active.length < 3 },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // — Layer ordering —
      { label: 'Bring Forward', shortcut: ']', onClick: () => {
        if (!canvas) return;
        active.forEach((o) => (canvas as any).bringObjectForward(o));
        canvas.requestRenderAll(); onCanvasChange();
      }, disabled: !hasSel },
      { label: 'Send Backward', shortcut: '[', onClick: () => {
        if (!canvas) return;
        active.forEach((o) => (canvas as any).sendObjectBackwards(o));
        canvas.requestRenderAll(); onCanvasChange();
      }, disabled: !hasSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // — Group —
      { label: 'Group', shortcut: 'Ctrl+G', onClick: handleGroup, disabled: !multiSel },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: handleUngroup,
        disabled: !canvas || canvas.getActiveObject()?.type !== 'group' },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // — Arrangement —
      { label: 'Arrange Pack', shortcut: 'Ctrl+Shift+P', onClick: () => run((o) => ops.arrangeOptimal(o)), disabled: !multiSel },
      { label: 'Arrange Grid', shortcut: '', onClick: () => run((o) => ops.arrangeGrid(o)), disabled: !multiSel },
      { label: 'Arrange Row', shortcut: '', onClick: () => run((o) => ops.arrangeRow(o)), disabled: !multiSel },
      { label: 'Arrange Column', shortcut: '', onClick: () => run((o) => ops.arrangeColumn(o)), disabled: !multiSel },
      { label: 'Stack', shortcut: 'Ctrl+Alt+S', onClick: () => run((o) => ops.stackObjects(o)), disabled: !multiSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // — Normalize —
      { label: 'Normalize Size', shortcut: '', onClick: () => run((o) => ops.normalizeSize(o)), disabled: !multiSel },
      { label: 'Normalize Width', shortcut: '', onClick: () => run((o) => ops.normalizeWidth(o)), disabled: !multiSel },
      { label: 'Normalize Height', shortcut: '', onClick: () => run((o) => ops.normalizeHeight(o)), disabled: !multiSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      // — Image —
      { label: 'Flip Horizontal', shortcut: 'Alt+Shift+H', onClick: () => run((o) => ops.flipHorizontal(o)), disabled: !hasSel },
      { label: 'Flip Vertical', shortcut: 'Alt+Shift+V', onClick: () => run((o) => ops.flipVertical(o)), disabled: !hasSel },
      { label: 'Reset Transform', shortcut: 'Ctrl+Shift+T', onClick: () => run((o) => ops.resetTransform(o)), disabled: !hasSel },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Select All', shortcut: 'Ctrl+A', onClick: () => {
        if (!canvas) return;
        canvas.discardActiveObject();
        const fabricNs = (window as any).fabric;
        if (fabricNs?.ActiveSelection) {
          const sel = new fabricNs.ActiveSelection(canvas.getObjects(), { canvas });
          canvas.setActiveObject(sel);
        }
        canvas.requestRenderAll();
      } },
      { label: 'Fit All', shortcut: 'Ctrl+0', onClick: () => canvasRef.current?.fitAll() },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Delete', shortcut: 'Del', onClick: () => {
        if (!canvas) return;
        active.forEach((o) => canvas.remove(o));
        canvas.discardActiveObject(); canvas.requestRenderAll(); onCanvasChange();
      }, disabled: !hasSel, danger: true },
    ];
  }, [writeCanvasToClipboard, onCanvasChange, handleGroup, handleUngroup, cloneFabricObject]);

  // Keyboard shortcuts — registry-based approach
  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const canvas = canvasRef.current?.getCanvas();
      if (!canvas) return;

      // Tool shortcuts (bare keys 1-5, v/h/p/t/e — no modifiers)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = toolShortcuts[e.key.toLowerCase()];
        if (tool) {
          setActiveTool(tool);
          return;
        }
      }

      // Special: Ctrl+V paste — if internal clipboard is empty, let browser/setupPaste handle it
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey && !e.altKey) {
        if (clipboardRef.current.length === 0) return;
      }

      // Build context for shortcut handlers
      const ctx: ShortcutContext = {
        canvas,
        getActiveObjects: () => canvas.getActiveObjects(),
        getActiveObject: () => canvas.getActiveObject() || null,
        clipboardRef,
        cloneFabricObject,
        writeCanvasToClipboard,
        onCanvasChange,
        showToast,
        fitAll: () => canvasRef.current?.fitAll(),
        setActiveTool,
        undoRef,
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
        const activeCount = canvas.getActiveObjects().length;
        if (def.needsSelection && activeCount === 0) continue;
        if (def.minSelection && activeCount < def.minSelection) continue;

        e.preventDefault();
        await def.handler(ctx);

        // Update zoom display after any action
        setZoom(canvas.getZoom());
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCanvasChange, writeCanvasToClipboard, handleGroup, handleUngroup, cloneFabricObject, showToast, refreshLayers]);

  // Save on page unload
  useEffect(() => {
    function onBeforeUnload() {
      const canvas = canvasRef.current?.getCanvas();
      if (!canvas || !resolvedBoardId) return;
      const state = JSON.stringify((canvas as any).toJSON(['id', 'crossOrigin']));
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
          const canvas = canvasRef.current?.getCanvas();
          if (!canvas) return;
          const z = Math.min(canvas.getZoom() * 1.2, 5);
          const center = canvas.getCenterPoint();
          canvas.zoomToPoint(center, z);
          canvas.requestRenderAll();
          setZoom(z);
        }}
        onZoomOut={() => {
          const canvas = canvasRef.current?.getCanvas();
          if (!canvas) return;
          const z = Math.max(canvas.getZoom() / 1.2, 0.1);
          const center = canvas.getCenterPoint();
          canvas.zoomToPoint(center, z);
          canvas.requestRenderAll();
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
        <FabricCanvas
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
        {objectCount === 0 && !canvasState?.objects?.length && (
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
              const canvas = canvasRef.current?.getCanvas();
              if (!canvas) return;
              const obj = canvas.getObjects().find((o: any) => o.id === id);
              if (obj) {
                canvas.discardActiveObject();
                canvas.setActiveObject(obj);
                canvas.requestRenderAll();
              }
            }}
            onToggleVisible={(id) => {
              const canvas = canvasRef.current?.getCanvas();
              if (!canvas) return;
              const obj = canvas.getObjects().find((o: any) => o.id === id);
              if (obj) {
                obj.set('visible', !obj.visible);
                canvas.requestRenderAll();
                onCanvasChange();
                refreshLayers();
              }
            }}
            onToggleLock={(id) => {
              const canvas = canvasRef.current?.getCanvas();
              if (!canvas) return;
              const obj = canvas.getObjects().find((o: any) => o.id === id);
              if (obj) {
                obj.set({ selectable: !obj.selectable, evented: !obj.evented } as any);
                canvas.requestRenderAll();
                refreshLayers();
              }
            }}
            onReorder={(from, to) => {
              const canvas = canvasRef.current?.getCanvas();
              if (!canvas) return;
              const objects = canvas.getObjects();
              if (from < 0 || from >= objects.length || to < 0 || to >= objects.length) return;
              const obj = objects[from];
              canvas.remove(obj);
              const insertAt = to > from ? to : to;
              canvas.insertAt(insertAt, obj);
              canvas.requestRenderAll();
              onCanvasChange();
              refreshLayers();
            }}
            onDelete={(id) => {
              const canvas = canvasRef.current?.getCanvas();
              if (!canvas) return;
              const obj = canvas.getObjects().find((o: any) => o.id === id);
              if (obj) {
                canvas.remove(obj);
                canvas.discardActiveObject();
                canvas.requestRenderAll();
                onCanvasChange();
                refreshLayers();
              }
            }}
            onRename={(id, name) => {
              const canvas = canvasRef.current?.getCanvas();
              if (!canvas) return;
              const obj = canvas.getObjects().find((o: any) => o.id === id);
              if (obj) {
                (obj as any).name = name;
                refreshLayers();
              }
            }}
            onGroup={handleGroup}
            onUngroup={handleUngroup}
            hasSelection={canvasRef.current?.getCanvas()?.getActiveObjects()?.length! > 1}
            hasGroupSelection={canvasRef.current?.getCanvas()?.getActiveObject()?.type === 'group'}
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
