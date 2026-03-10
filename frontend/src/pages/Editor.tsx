import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PixiCanvas, { PixiCanvasHandle } from '../canvas/PixiCanvas';
import { SelectionManager } from '../canvas/SelectionManager';
import { type SceneItem } from '../canvas/SceneManager';
import { ToolType, activateTool } from '../canvas/tools';
import type { ToolContext } from '../canvas/tools';
import { SyncHandle } from '../canvas/sync';
import { UndoManager } from '../canvas/history';
import { shortcuts as shortcutDefs } from '../canvas/shortcut-definitions';
import { writeCanvasToClipboard as writeClipboard } from '../canvas/clipboard';
import { buildContextMenuItems } from '../canvas/context-menu-items';
import { groupItems, ungroupItems } from '../canvas/grouping';
import { getSocket } from '../socket';
import { useAuth } from '../auth';
import Toolbar from '../components/Toolbar';
import StatusBar, { SaveStatus } from '../components/StatusBar';
import UserCursors from '../components/UserCursors';
import ContextMenu from '../components/ContextMenu';
import LayerPanel from '../components/LayerPanel';
import SelectionToolbar from '../components/SelectionToolbar';
import VideoControls from '../components/VideoControls';
import ShortcutsHelp from '../components/ShortcutsHelp';
import MattermostImport from '../components/MattermostImport';
import Minimap from '../components/Minimap';
import UploadPanel from '../components/UploadPanel';
import { UploadManager } from '../stores/uploadManager';
import { InboxZone } from '../canvas/InboxZone';
import { getItemWorldBounds } from '../canvas/SceneManager';
import { VideoSprite } from '../canvas/sprites/VideoSprite';
import * as ops from '../canvas/operations';

// Hooks
import { useBoardLoader } from '../hooks/useBoardLoader';
import { useSaveManager } from '../hooks/useSaveManager';
import { useCanvasSetup } from '../hooks/useCanvasSetup';
import { useShortcutHandler } from '../hooks/useShortcutHandler';
import { useLayerPanel } from '../hooks/useLayerPanel';
import { useFollowMode } from '../hooks/useFollowMode';

interface EditorProps {
  isPublicView?: boolean;
}

interface OnlineUser {
  userId: string;
  displayName: string;
  color: string;
}

export default function Editor({ isPublicView }: EditorProps) {
  const { boardId } = useParams<{ boardId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Refs
  const canvasRef = useRef<PixiCanvasHandle>(null);
  const selectionRef = useRef<SelectionManager | null>(null);
  const undoRef = useRef<UndoManager | null>(null);
  const syncRef = useRef<SyncHandle | null>(null);
  const toolCleanupRef = useRef<(() => void) | null>(null);
  const inboxZoneRef = useRef<InboxZone | null>(null);
  const clipboardRef = useRef<SceneItem[]>([]);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [uploadManager] = useState(() => new UploadManager());

  // UI state
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
  const [showGrid, setShowGrid] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showMmImport, setShowMmImport] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [layerList, setLayerList] = useState<any[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number; count: number } | null>(null);
  const [videoCtrl, setVideoCtrl] = useState<{ videoSprite: VideoSprite; screenRect: { x: number; y: number; w: number; h: number } } | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [minimapData, setMinimapData] = useState<{ items: any[]; viewportBounds: any; contentBounds: any }>({
    items: [], viewportBounds: { x: 0, y: 0, w: 1, h: 1 }, contentBounds: { x: 0, y: 0, w: 1, h: 1 },
  });

  // Derived
  const { boardData, loading, error } = useBoardLoader(boardId);
  const resolvedBoardId = boardId || boardData?.board?.id;

  // Toast helper
  const showToast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  // Save manager
  const { scheduleSave } = useSaveManager({ resolvedBoardId, isPublicView, canvasRef, setSaveStatus });

  // Canvas change handler.
  // Pass changedIds for incremental sync (fast, lightweight).
  // Omit for structural changes — falls through to debounced full scene sync.
  const onCanvasChange = useCallback((changedIds?: string[]) => {
    scheduleSave();
    if (changedIds && changedIds.length > 0) {
      // Incremental: broadcast only changed elements
      syncRef.current?.broadcastElements(changedIds);
      // Keep spatial index in sync for all local mutations (align/flip/arrange/etc.)
      const scene = canvasRef.current?.getScene();
      if (scene) {
        for (const id of changedIds) {
          const item = scene.items.get(id);
          if (item) scene.updateSpatialEntry(item);
        }
      }
    }
    // Full scene sync happens via debounced SceneManager.onChange chain in sync.ts
    if (undoRef.current && !undoRef.current.isLocked()) {
      undoRef.current.saveState();
      setCanUndo(undoRef.current.canUndo());
      setCanRedo(undoRef.current.canRedo());
    }
    const z = canvasRef.current?.getZoom() ?? 1;
    setZoom(z);
    const scene = canvasRef.current?.getScene();
    if (scene) setObjectCount(scene.getAllItems().length);
    const vp = canvasRef.current?.getViewport();
    if (vp) setCanvasTransform([vp.scale.x, 0, 0, vp.scale.y, vp.x, vp.y]);
  }, [scheduleSave]);

  // Follow mode
  const getViewport = useCallback(() => canvasRef.current?.getViewport() ?? null, []);
  const { followingUserId, followingDisplayName, startFollowing, stopFollowing } = useFollowMode({
    socket: getSocket(),
    boardId: resolvedBoardId,
    getViewport,
  });

  // Canvas setup (selection, undo, sync, socket, drag/drop, paste, inbox)
  useCanvasSetup({
    boardData, resolvedBoardId, user, isPublicView,
    canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef, canvasContainerRef,
    uploadManager, onCanvasChange, showToast, setOnlineUsers, setSelectedLayerIds,
  });

  // Tool activation
  useEffect(() => {
    const viewport = canvasRef.current?.getViewport();
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    if (!viewport || !scene || !selection) return;

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
    const ctx: ToolContext = {
      viewport, scene, selection, container: domContainer,
      onChange: onCanvasChange,
      broadcastElements: (ids) => syncRef.current?.broadcastElements(ids),
    };
    toolCleanupRef.current = activateTool(ctx, activeTool, { color, strokeWidth, fontSize });
  }, [activeTool, color, strokeWidth, fontSize, onCanvasChange]);

  // Layer panel
  const { refreshLayers: refreshLayerData, layerHandlers } = useLayerPanel({ canvasRef, selectionRef, onCanvasChange });

  const refreshLayers = useCallback(() => {
    const layers = refreshLayerData();
    setLayerList(layers);
    const selection = selectionRef.current;
    if (selection) setSelectedLayerIds(Array.from(selection.selectedIds));
  }, [refreshLayerData]);

  useEffect(() => {
    if (showLayers) refreshLayers();
  }, [showLayers, refreshLayers, selectedLayerIds]);

  // Grouping
  const handleGroup = useCallback(() => {
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    if (!scene || !selection) return;
    groupItems(scene, selection, () => {
      onCanvasChange();
      refreshLayers();
      syncRef.current?.broadcastSceneNow();
    });
  }, [onCanvasChange, refreshLayers]);

  const handleUngroup = useCallback(() => {
    const scene = canvasRef.current?.getScene();
    const selection = selectionRef.current;
    const viewport = canvasRef.current?.getViewport();
    if (!scene || !selection || !viewport) return;
    ungroupItems(scene, selection, viewport, () => {
      onCanvasChange();
      refreshLayers();
      syncRef.current?.broadcastSceneNow();
    });
  }, [onCanvasChange, refreshLayers]);

  // Clipboard write wrapper
  const writeCanvasToClipboard = useCallback(async (items?: SceneItem[]) => {
    try {
      const app = canvasRef.current?.getApp() ?? null;
      const viewport = canvasRef.current?.getViewport() ?? null;
      await writeClipboard(app, viewport, items);
    } catch (err: any) {
      showToast('Copy failed: ' + (err.message || 'clipboard not available'));
    }
  }, [showToast]);

  // Keyboard shortcuts
  useShortcutHandler({
    canvasRef, selectionRef, undoRef, clipboardRef, resolvedBoardId,
    onCanvasChange, showToast, refreshLayers,
    handleGroup, handleUngroup,
    setActiveTool, setCanUndo, setCanRedo, setZoom,
    setShowGrid, setShowHelp, setFocusMode,
  });

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contextMenuItems = useCallback(() => {
    return buildContextMenuItems({
      scene: canvasRef.current?.getScene() ?? null,
      selection: selectionRef.current,
      viewport: canvasRef.current?.getViewport() ?? null,
      clipboardRef,
      writeCanvasToClipboard,
      onChange: () => { onCanvasChange(); refreshLayers(); },
      refreshLayers,
      handleGroup,
      handleUngroup,
      fitAll: () => canvasRef.current?.fitAll(),
    });
  }, [writeCanvasToClipboard, onCanvasChange, handleGroup, handleUngroup, refreshLayers]);

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

  // Update UI overlays (selection toolbar, video controls, minimap) on demand
  const updateOverlays = useCallback(() => {
    const selection = selectionRef.current;
    const vp = canvasRef.current?.getViewport();
    if (!selection || !vp) { setSelToolbar(null); setVideoCtrl(null); return; }
    const items = selection.getSelectedItems();

    setZoom(canvasRef.current?.getZoom() ?? 1);
    setCanvasTransform([vp.scale.x, 0, 0, vp.scale.y, vp.x, vp.y]);

    // Video controls: show when exactly 1 video is selected
    if (items.length === 1 && items[0].type === 'video' && items[0].displayObject instanceof VideoSprite) {
      const vs = items[0].displayObject as VideoSprite;
      const b = getItemWorldBounds(items[0]);
      const screenTL = vp.toScreen(b.x, b.y);
      const screenBR = vp.toScreen(b.x + b.w, b.y + b.h);
      setVideoCtrl({
        videoSprite: vs,
        screenRect: {
          x: screenTL.x,
          y: screenTL.y,
          w: screenBR.x - screenTL.x,
          h: screenBR.y - screenTL.y,
        },
      });
    } else {
      setVideoCtrl(null);
    }

    if (items.length < 2) { setSelToolbar(null); } else {
      // Compute world bounding box of selection
      let minX = Infinity, minY = Infinity, maxX = -Infinity;
      for (const item of items) {
        const b = getItemWorldBounds(item);
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
      }
      const screenTL = vp.toScreen(minX, minY);
      const screenTR = vp.toScreen(maxX, minY);
      setSelToolbar({ x: (screenTL.x + screenTR.x) / 2, y: screenTL.y, count: items.length });
    }

    // Minimap data
    const scene = canvasRef.current?.getScene();
    if (scene) {
      const allItems = scene.getTopLevelItems();
      const mapItems = allItems.map((it) => {
        const b = getItemWorldBounds(it);
        return { x: b.x, y: b.y, w: b.w, h: b.h, type: it.type, id: it.id };
      });
      const topLeft = vp.toWorld(0, 0);
      const botRight = vp.toWorld(vp.screenWidth, vp.screenHeight);
      const vpBounds = { x: topLeft.x, y: topLeft.y, w: botRight.x - topLeft.x, h: botRight.y - topLeft.y };
      let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
      for (const it of mapItems) {
        if (it.x < cMinX) cMinX = it.x;
        if (it.y < cMinY) cMinY = it.y;
        if (it.x + it.w > cMaxX) cMaxX = it.x + it.w;
        if (it.y + it.h > cMaxY) cMaxY = it.y + it.h;
      }
      if (mapItems.length === 0) { cMinX = 0; cMinY = 0; cMaxX = 1; cMaxY = 1; }
      setMinimapData({
        items: mapItems,
        viewportBounds: vpBounds,
        contentBounds: { x: cMinX, y: cMinY, w: cMaxX - cMinX, h: cMaxY - cMinY },
      });
    }
  }, []);

  // Listen to viewport moved event for overlay updates (throttled)
  // Depends on objectCount so it re-runs after canvas init (viewport becomes available)
  useEffect(() => {
    const vp = canvasRef.current?.getViewport();
    if (!vp) return;
    let rafId: number | null = null;
    const onMoved = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = null; updateOverlays(); });
    };
    vp.on('moved', onMoved);
    // Also listen to wheel events directly for immediate zoom feedback
    const onWheel = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = null; updateOverlays(); });
    };
    vp.on('wheel-scroll', onWheel);
    return () => { vp.off('moved', onMoved); vp.off('wheel-scroll', onWheel); if (rafId) cancelAnimationFrame(rafId); };
  }, [updateOverlays, objectCount]);

  // Also update overlays when selection or scene changes
  useEffect(() => {
    updateOverlays();
  }, [selectedLayerIds, updateOverlays]);

  // (PresenceOverlay removed — selection broadcast no longer needed)

  // -- Render --

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
        display: focusMode ? 'none' : 'flex', alignItems: 'center', justifyContent: 'space-between',
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
      {!focusMode && <Toolbar
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
        onUserClick={startFollowing}
        followingUserId={followingUserId}
        onToggleLayers={() => setShowLayers((v) => !v)}
        showLayers={showLayers}
        onToggleHelp={() => setShowHelp((v) => !v)}
        onMmImport={() => setShowMmImport(true)}
        boardName={board?.name}
      />}

      {/* Canvas */}
      <div ref={canvasContainerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#1e1e1e' }} onContextMenu={handleContextMenu} onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
        {/* Dot grid — behind transparent canvas */}
        {showGrid && (() => {
          const scale = canvasTransform[0] || 1;
          const tx = canvasTransform[4] || 0;
          const ty = canvasTransform[5] || 0;
          let spacing = 20;
          while (spacing * scale < 12) spacing *= 2;
          while (spacing * scale > 50) spacing /= 2;
          const screenSpacing = spacing * scale;
          const dotR = Math.max(0.5, Math.min(1.5, scale * 0.8));
          const ox = tx % screenSpacing;
          const oy = ty % screenSpacing;
          const alpha = Math.max(0.12, Math.min(0.35, scale * 0.18));
          return (
            <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} width="100%" height="100%">
              <defs>
                <pattern id="dotgrid" width={screenSpacing} height={screenSpacing} patternUnits="userSpaceOnUse" x={ox} y={oy}>
                  <circle cx={dotR} cy={dotR} r={dotR} fill={`rgba(255,255,255,${alpha})`} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dotgrid)" />
            </svg>
          );
        })()}
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

        {/* Selection toolbar (floating, above selection) */}
        {selToolbar && selToolbar.count >= 2 && activeTool === ToolType.SELECT && !contextMenu && (
          <SelectionToolbar
            x={selToolbar.x}
            y={selToolbar.y}
            count={selToolbar.count}
            onAlignLeft={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignLeft(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onAlignCenterH={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignCenterH(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onAlignRight={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignRight(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onAlignTop={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignTop(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onAlignCenterV={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignCenterV(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onAlignBottom={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignBottom(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onDistributeH={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.distributeHorizontal(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onDistributeV={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.distributeVertical(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onPack={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeOptimal(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onGrid={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeGrid(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onRow={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeRow(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onColumn={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeColumn(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onStack={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.stackObjects(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onFlipH={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.flipHorizontal(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onFlipV={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.flipVertical(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onGroup={handleGroup}
            onNormSize={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.normalizeSize(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
          />
        )}

        {/* Video controls (floating, below selected video) */}
        {videoCtrl && activeTool === ToolType.SELECT && !contextMenu && (
          <VideoControls
            videoSprite={videoCtrl.videoSprite}
            screenRect={videoCtrl.screenRect}
          />
        )}

        {/* Minimap */}
        {showMinimap && !focusMode && objectCount > 0 && (
          <Minimap
            items={minimapData.items}
            viewportBounds={minimapData.viewportBounds}
            contentBounds={minimapData.contentBounds}
            onNavigate={(wx, wy) => {
              const vp = canvasRef.current?.getViewport();
              if (vp) vp.animate({ time: 200, position: { x: wx, y: wy }, ease: 'easeOutQuad' });
            }}
          />
        )}

        {/* Follow mode banner */}
        {followingDisplayName && (
          <div style={{
            position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 14px', background: 'rgba(74, 144, 217, 0.9)', borderRadius: '8px',
            color: '#fff', fontSize: '12px', fontWeight: 500, zIndex: 200,
            cursor: 'pointer', pointerEvents: 'auto',
          }} onClick={stopFollowing}>
            Following {followingDisplayName} — click to stop
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
            onSelect={layerHandlers.onSelect}
            onToggleVisible={(id) => { layerHandlers.onToggleVisible(id); refreshLayers(); }}
            onToggleLock={(id) => { layerHandlers.onToggleLock(id); refreshLayers(); }}
            onReorder={(from, to) => { layerHandlers.onReorder(from, to); refreshLayers(); }}
            onDelete={(id) => { layerHandlers.onDelete(id); refreshLayers(); }}
            onRename={(id, name) => { layerHandlers.onRename(id, name); refreshLayers(); }}
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

        {/* Upload progress panel */}
        <UploadPanel uploadManager={uploadManager} />

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
      {!focusMode && <StatusBar
        boardName={board?.name || 'Untitled'}
        imageCount={objectCount}
        saveStatus={saveStatus}
      />}

      {/* Shortcuts help overlay */}
      {showHelp && (
        <ShortcutsHelp shortcuts={shortcutDefs} onClose={() => setShowHelp(false)} />
      )}

      {/* Mattermost import modal */}
      {showMmImport && resolvedBoardId && (
        <MattermostImport
          boardId={resolvedBoardId}
          onClose={() => setShowMmImport(false)}
          onMediaArrived={(assets) => {
            if (inboxZoneRef.current) {
              inboxZoneRef.current.addMedia(assets);
            }
          }}
        />
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
