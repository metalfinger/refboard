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
  const [showGrid, setShowGrid] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMmImport, setShowMmImport] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [layerList, setLayerList] = useState<any[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number; count: number } | null>(null);
  const [videoCtrl, setVideoCtrl] = useState<{ videoSprite: VideoSprite; screenRect: { x: number; y: number; w: number; h: number } } | null>(null);

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
    if (scene) setObjectCount(scene.getAllItems().length);
    const vp = canvasRef.current?.getViewport();
    if (vp) setCanvasTransform([vp.scale.x, 0, 0, vp.scale.y, vp.x, vp.y]);
  }, [scheduleSave]);

  // Canvas setup (selection, undo, sync, socket, drag/drop, paste, inbox)
  useCanvasSetup({
    boardData, resolvedBoardId, user, isPublicView,
    canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef,
    onCanvasChange, showToast, setOnlineUsers, setSelectedLayerIds,
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
    if (!showLayers) return;
    refreshLayers();
    const interval = setInterval(refreshLayers, 500);
    return () => clearInterval(interval);
  }, [showLayers, refreshLayers]);

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

  // Zoom poll + selection toolbar position tracking
  useEffect(() => {
    const interval = setInterval(() => {
      setZoom(canvasRef.current?.getZoom() ?? 1);

      // Update selection toolbar position
      const selection = selectionRef.current;
      const vp = canvasRef.current?.getViewport();
      if (!selection || !vp) { setSelToolbar(null); setVideoCtrl(null); return; }
      const items = selection.getSelectedItems();

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

      if (items.length < 2) { setSelToolbar(null); return; }

      // Compute world bounding box of selection
      let minX = Infinity, minY = Infinity, maxX = -Infinity;
      for (const item of items) {
        const b = getItemWorldBounds(item);
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
      }

      // Convert to screen
      const screenTL = vp.toScreen(minX, minY);
      const screenTR = vp.toScreen(maxX, minY);
      const sx = (screenTL.x + screenTR.x) / 2;
      const sy = screenTL.y;
      setSelToolbar({ x: sx, y: sy, count: items.length });
    }, 100);
    return () => clearInterval(interval);
  }, []);

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
        onToggleLayers={() => setShowLayers((v) => !v)}
        showLayers={showLayers}
        onToggleHelp={() => setShowHelp((v) => !v)}
        onMmImport={() => setShowMmImport(true)}
        boardName={board?.name}
      />}

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

        {/* Selection toolbar (floating, above selection) */}
        {selToolbar && selToolbar.count >= 2 && activeTool === ToolType.SELECT && !contextMenu && (
          <SelectionToolbar
            x={selToolbar.x}
            y={selToolbar.y}
            count={selToolbar.count}
            onAlignLeft={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignLeft(s); onCanvasChange(); } }}
            onAlignCenterH={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignCenterH(s); onCanvasChange(); } }}
            onAlignRight={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignRight(s); onCanvasChange(); } }}
            onAlignTop={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignTop(s); onCanvasChange(); } }}
            onAlignCenterV={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignCenterV(s); onCanvasChange(); } }}
            onAlignBottom={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.alignBottom(s); onCanvasChange(); } }}
            onDistributeH={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.distributeHorizontal(s); onCanvasChange(); } }}
            onDistributeV={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.distributeVertical(s); onCanvasChange(); } }}
            onPack={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeOptimal(s); onCanvasChange(); } }}
            onGrid={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeGrid(s); onCanvasChange(); } }}
            onRow={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeRow(s); onCanvasChange(); } }}
            onColumn={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.arrangeColumn(s); onCanvasChange(); } }}
            onStack={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.stackObjects(s); onCanvasChange(); } }}
            onFlipH={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.flipHorizontal(s); onCanvasChange(); } }}
            onFlipV={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.flipVertical(s); onCanvasChange(); } }}
            onGroup={handleGroup}
            onNormSize={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.normalizeSize(s); onCanvasChange(); } }}
          />
        )}

        {/* Video controls (floating, below selected video) */}
        {videoCtrl && activeTool === ToolType.SELECT && !contextMenu && (
          <VideoControls
            videoSprite={videoCtrl.videoSprite}
            screenRect={videoCtrl.screenRect}
          />
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
