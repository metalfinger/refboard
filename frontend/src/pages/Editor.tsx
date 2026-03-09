import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FabricObject, FabricImage, Group } from 'fabric';
import FabricCanvas, { FabricCanvasHandle } from '../canvas/FabricCanvas';
import { ToolType, activateTool, toolShortcuts } from '../canvas/tools';
import { setupSync, isRemoteUpdate } from '../canvas/sync';
import { setupDragDrop, setupPaste } from '../canvas/image-drop';
import { UndoManager } from '../canvas/history';
import { connectSocket, disconnectSocket, getSocket } from '../socket';
import { getBoard, saveCanvas } from '../api';
import { useAuth } from '../auth';
import Toolbar from '../components/Toolbar';
import StatusBar, { SaveStatus } from '../components/StatusBar';
import UserCursors from '../components/UserCursors';
import ContextMenu from '../components/ContextMenu';
import LayerPanel from '../components/LayerPanel';

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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canvasTransform, setCanvasTransform] = useState([1, 0, 0, 1, 0, 0]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [showLayers, setShowLayers] = useState(false);
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
        const state = JSON.stringify((canvas as any).toJSON(['id']));
        await saveCanvas(resolvedBoardId, state);
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
    if (canvas?.viewportTransform) {
      setCanvasTransform([...canvas.viewportTransform]);
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

  // Copy selection as cropped image to system clipboard (for pasting in Paint etc.)
  const copySelectionToClipboard = useCallback(async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    const active = canvas.getActiveObjects();
    if (active.length === 0) return;

    try {
      // Temporarily hide selection handles by deselecting
      const activeObj = canvas.getActiveObject();
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      // Use Fabric's toCanvasElement to render the canvas without selection handles
      const fullCanvas = (canvas as any).toCanvasElement(1);

      // Get bounding rect of selected objects on the rendered canvas
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      active.forEach((obj) => {
        const bound = obj.getBoundingRect();
        minX = Math.min(minX, bound.left);
        minY = Math.min(minY, bound.top);
        maxX = Math.max(maxX, bound.left + bound.width);
        maxY = Math.max(maxY, bound.top + bound.height);
      });

      // Re-select immediately
      if (activeObj) {
        canvas.setActiveObject(activeObj);
      }
      canvas.requestRenderAll();

      const padding = 8;
      const cropX = Math.max(0, Math.floor(minX - padding));
      const cropY = Math.max(0, Math.floor(minY - padding));
      const cropW = Math.min(Math.ceil(maxX - minX + padding * 2), fullCanvas.width - cropX);
      const cropH = Math.min(Math.ceil(maxY - minY + padding * 2), fullCanvas.height - cropY);

      if (cropW <= 0 || cropH <= 0) return;

      // Crop to selection bounds
      const offscreen = document.createElement('canvas');
      offscreen.width = cropW;
      offscreen.height = cropH;
      const ctx = offscreen.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cropW, cropH);
      ctx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Write to system clipboard
      offscreen.toBlob(async (blob: Blob | null) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
        } catch {
          // Clipboard API not available (needs HTTPS)
        }
      }, 'image/png');
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  }, []);

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

  // Arrange selected objects
  const arrangeObjects = useCallback((mode: 'grid' | 'row' | 'column') => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length < 2) return;

    const gap = 20;
    const sorted = [...active].sort((a, b) => (a.left || 0) - (b.left || 0));
    const startX = sorted[0].left || 0;
    const startY = sorted[0].top || 0;

    if (mode === 'row') {
      let x = startX;
      sorted.forEach((obj) => {
        obj.set({ left: x } as any);
        obj.setCoords();
        x += (obj.width || 100) * (obj.scaleX || 1) + gap;
      });
    } else if (mode === 'column') {
      let y = startY;
      sorted.forEach((obj) => {
        obj.set({ left: startX, top: y } as any);
        obj.setCoords();
        y += (obj.height || 100) * (obj.scaleY || 1) + gap;
      });
    } else {
      // Grid
      const cols = Math.ceil(Math.sqrt(active.length));
      let maxH = 0;
      sorted.forEach((obj, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const w = (obj.width || 100) * (obj.scaleX || 1);
        const h = (obj.height || 100) * (obj.scaleY || 1);
        if (col === 0 && i > 0) maxH = 0;
        obj.set({
          left: startX + col * (200 + gap),
          top: startY + row * (200 + gap),
        } as any);
        obj.setCoords();
        maxH = Math.max(maxH, h);
      });
    }

    canvas.discardActiveObject();
    canvas.requestRenderAll();
    onCanvasChange();
  }, [onCanvasChange]);

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contextMenuItems = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    const hasSelection = canvas ? canvas.getActiveObjects().length > 0 : false;
    return [
      { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => {
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          clipboardRef.current = [...active];
          copySelectionToClipboard();
        }
      }, disabled: !hasSelection },
      { label: 'Paste', shortcut: 'Ctrl+V', onClick: async () => {
        if (!canvas || clipboardRef.current.length === 0) return;
        for (const original of clipboardRef.current) {
          try {
            const obj = await cloneFabricObject(original, 20, 20);
            canvas.add(obj);
          } catch {}
        }
        canvas.requestRenderAll();
        onCanvasChange();
      }, disabled: clipboardRef.current.length === 0 },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: async () => {
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        for (const original of active) {
          try {
            const obj = await cloneFabricObject(original, 20, 20);
            canvas.add(obj);
          } catch {}
        }
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        onCanvasChange();
      }, disabled: !hasSelection },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Bring Forward', shortcut: ']', onClick: () => {
        if (!canvas) return;
        canvas.getActiveObjects().forEach((obj) => canvas.bringObjectForward(obj));
        canvas.requestRenderAll();
        onCanvasChange();
      }, disabled: !hasSelection },
      { label: 'Send Backward', shortcut: '[', onClick: () => {
        if (!canvas) return;
        canvas.getActiveObjects().forEach((obj) => canvas.sendObjectBackwards(obj));
        canvas.requestRenderAll();
        onCanvasChange();
      }, disabled: !hasSelection },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Group', shortcut: 'Ctrl+G', onClick: handleGroup,
        disabled: !canvas || canvas.getActiveObjects().length < 2 },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: handleUngroup,
        disabled: !canvas || canvas.getActiveObject()?.type !== 'group' },
      { label: '', shortcut: '', onClick: () => {}, divider: true },
      { label: 'Arrange Grid', shortcut: '', onClick: () => arrangeObjects('grid'),
        disabled: !canvas || canvas.getActiveObjects().length < 2 },
      { label: 'Arrange Row', shortcut: '', onClick: () => arrangeObjects('row'),
        disabled: !canvas || canvas.getActiveObjects().length < 2 },
      { label: 'Arrange Column', shortcut: '', onClick: () => arrangeObjects('column'),
        disabled: !canvas || canvas.getActiveObjects().length < 2 },
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
        const active = canvas.getActiveObjects();
        active.forEach((obj) => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        onCanvasChange();
      }, disabled: !hasSelection, danger: true },
    ];
  }, [copySelectionToClipboard, onCanvasChange, handleGroup, handleUngroup, arrangeObjects, cloneFabricObject]);

  // Keyboard shortcuts
  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const tool = toolShortcuts[e.key.toLowerCase()];
      if (tool && !e.ctrlKey && !e.metaKey) {
        setActiveTool(tool);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current?.undo();
        setCanUndo(undoRef.current?.canUndo() ?? false);
        setCanRedo(undoRef.current?.canRedo() ?? false);
        onCanvasChange();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        undoRef.current?.redo();
        setCanUndo(undoRef.current?.canUndo() ?? false);
        setCanRedo(undoRef.current?.canRedo() ?? false);
        onCanvasChange();
        return;
      }

      // Group (Ctrl+G)
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        handleGroup();
        return;
      }
      // Ungroup (Ctrl+Shift+G)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        handleUngroup();
        return;
      }

      // Copy selected objects (internal clipboard + system clipboard image)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          // Store actual object refs for cloning later
          clipboardRef.current = [...active];
          // Write image to system clipboard (async, doesn't block)
          copySelectionToClipboard();
          showToast('Copied');
        }
        return;
      }

      // Paste canvas objects (Ctrl+V) — only if we have internal clipboard
      // Image paste from system clipboard is handled by setupPaste in image-drop.ts
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardRef.current.length === 0) return; // let setupPaste handle it
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        e.preventDefault();
        const newObjs: FabricObject[] = [];
        for (const original of clipboardRef.current) {
          try {
            const obj = await cloneFabricObject(original, 20, 20);
            canvas.add(obj);
            newObjs.push(obj);
          } catch (err) {
            console.error('Paste object failed:', err);
          }
        }
        // Update clipboard to cloned positions for subsequent pastes
        clipboardRef.current = newObjs;
        canvas.requestRenderAll();
        onCanvasChange();
        return;
      }

      // Copy as image to system clipboard (Ctrl+Shift+C)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        copySelectionToClipboard();
        return;
      }

      // Duplicate selected (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        if (active.length === 0) return;
        for (const original of active) {
          try {
            const obj = await cloneFabricObject(original, 20, 20);
            canvas.add(obj);
          } catch (err) {
            console.error('Duplicate failed:', err);
          }
        }
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        onCanvasChange();
        return;
      }

      // Layer ordering
      if (e.key === ']') {
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        active.forEach((obj) => (canvas as any).bringObjectForward(obj));
        canvas.requestRenderAll();
        onCanvasChange();
        return;
      }
      if (e.key === '[') {
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        active.forEach((obj) => (canvas as any).sendObjectBackwards(obj));
        canvas.requestRenderAll();
        onCanvasChange();
        return;
      }

      // Zoom in/out with Ctrl+=/Ctrl+-
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const z = Math.min(canvas.getZoom() * 1.2, 5);
        const center = canvas.getCenterPoint();
        canvas.zoomToPoint(center, z);
        canvas.requestRenderAll();
        setZoom(z);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const z = Math.max(canvas.getZoom() / 1.2, 0.1);
        const center = canvas.getCenterPoint();
        canvas.zoomToPoint(center, z);
        canvas.requestRenderAll();
        setZoom(z);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          active.forEach((obj) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          onCanvasChange();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const canvas = canvasRef.current?.getCanvas();
        if (!canvas) return;
        canvas.discardActiveObject();
        const fabricNs = (window as any).fabric;
        if (fabricNs?.ActiveSelection) {
          const sel = new fabricNs.ActiveSelection(canvas.getObjects(), { canvas });
          canvas.setActiveObject(sel);
        }
        canvas.requestRenderAll();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        canvasRef.current?.fitAll();
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCanvasChange, copySelectionToClipboard, handleGroup, handleUngroup]);

  // Save on page unload
  useEffect(() => {
    function onBeforeUnload() {
      const canvas = canvasRef.current?.getCanvas();
      if (!canvas || !resolvedBoardId) return;
      const state = JSON.stringify((canvas as any).toJSON(['id']));
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
  const imageCount = boardData?.images?.length ?? 0;

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
        boardName={board?.name}
      />

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }} onContextMenu={handleContextMenu}>
        <FabricCanvas
          ref={canvasRef}
          canvasState={canvasState}
          currentTool={activeTool}
          onChange={onCanvasChange}
        />
        <UserCursors
          socket={getSocket()}
          boardId={resolvedBoardId || ''}
          canvasTransform={canvasTransform}
        />

        {/* Empty canvas guide */}
        {imageCount === 0 && !canvasState?.objects?.length && (
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
        imageCount={imageCount}
        saveStatus={saveStatus}
      />
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
