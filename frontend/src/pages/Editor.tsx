import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import { exportAsImage } from '../canvas/export';
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
import TextFormatToolbar from '../components/TextFormatToolbar';
import { getStickyWidthForSize } from '../canvas/stickyPresets';
import VideoControls from '../components/VideoControls';
import ShortcutsHelp from '../components/ShortcutsHelp';
import MattermostImport from '../components/MattermostImport';
import Minimap from '../components/Minimap';
import UploadPanel from '../components/UploadPanel';
import ExportDialog from '../components/ExportDialog';
import FeedbackPanel from '../components/feedback/FeedbackPanel';
import InlineCommentComposer from '../components/feedback/InlineCommentComposer';
import { useAnchoredOverlayPosition } from '../hooks/useAnchoredOverlayPosition';
import { UploadManager } from '../stores/uploadManager';
import { InboxZone } from '../canvas/InboxZone';
import { getItemWorldBounds } from '../canvas/SceneManager';
import { getPointAnchorWorld } from '../canvas/reviewAnchors';
import { resolveReviewTargetAtPoint } from '../canvas/reviewTargeting';
import type { TextObject, StickyObject, MarkdownObject } from '../canvas/scene-format';
import { VideoSprite } from '../canvas/sprites/VideoSprite';
import { TextSprite } from '../canvas/sprites/TextSprite';
import { StickySprite } from '../canvas/sprites/StickySprite';
import { MarkdownSprite } from '../canvas/sprites/MarkdownSprite';
import * as ops from '../canvas/operations';

/** Types that cannot be rotated, flipped, or cropped. */
const NON_TRANSFORMABLE = new Set(['pdf-page', 'sticky', 'markdown', 'text']);
import ReactDOM from 'react-dom';
import MarkdownReadView from '../components/MarkdownReadView';
import PasteChoicePopup from '../components/PasteChoicePopup';
import MarkdownFormatToolbar from '../components/MarkdownFormatToolbar';
import PdfPickerModal from '../components/PdfPickerModal';
import api, { saveCanvas } from '../api';
const LazyMarkdownEditView = React.lazy(() => import('../components/MarkdownEditView'));

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

export interface DraftPin {
  objectId: string;
  pinX: number;       // 0-1 relative to object bounds
  pinY: number;       // 0-1 relative to object bounds
  worldX: number;     // world-space coords at placement time
  worldY: number;     // world-space coords at placement time
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
  const mdOverlayRef = useRef<any>(null);
  const [uploadManager] = useState(() => new UploadManager());

  // Reset upload manager when switching boards
  useEffect(() => {
    uploadManager.clear();
  }, [boardId, uploadManager]);

  // UI state
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [color, setColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [zoom, setZoom] = useState(1);
  const [objectCount, setObjectCount] = useState(0);
  const [sceneLoading, setSceneLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
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
  const [showExport, setShowExport] = useState(false);
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const reviewModeRef = useRef(false);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  // Pulse signal: threadId to open, or null to collapse detail view
  const [expandRequest, setExpandRequest] = useState<{ threadId: string | null; seq: number } | null>(null);
  const [draftPin, setDraftPin] = useState<DraftPin | null>(null);
  const [openThreadDetailId, setOpenThreadDetailId] = useState<string | null>(null);
  const expandSeqRef = useRef(0);
  const [draftCommentText, setDraftCommentText] = useState('');
  const [creatingPointThread, setCreatingPointThread] = useState(false);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [layerList, setLayerList] = useState<any[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number; count: number } | null>(null);
  const [cropToolbar, setCropToolbar] = useState<{ x: number; y: number; name: string } | null>(null);
  const [cropModeActive, setCropModeActive] = useState(false);
  const [textToolbar, setTextToolbar] = useState<
    | { kind: 'text'; x: number; y: number; fontFamily: string; fill: string; items: SceneItem[] }
    | { kind: 'sticky'; x: number; y: number; fontFamily: string; textColor: string; fill: string; stickyFontSize: number; items: SceneItem[] }
    | null
  >(null);
  const [videoCtrl, setVideoCtrl] = useState<{ videoSprite: VideoSprite; screenRect: { x: number; y: number; w: number; h: number } } | null>(null);
  const [pastePopup, setPastePopup] = useState<{ x: number; y: number; text: string; html: string; hasImage: boolean } | null>(null);
  const [mdToolbar, setMdToolbar] = useState<{ x: number; y: number; item: SceneItem } | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [minimapData, setMinimapData] = useState<{ items: any[]; viewportBounds: any; contentBounds: any }>({
    items: [], viewportBounds: { x: 0, y: 0, w: 1, h: 1 }, contentBounds: { x: 0, y: 0, w: 1, h: 1 },
  });
  const [pdfPicker, setPdfPicker] = useState<{
    imageId: string; fileName: string; pageCount: number;
    dimensions: Array<{ w: number; h: number }>;
  } | null>(null);

  // Derived
  const { boardData, loading, error } = useBoardLoader(boardId);
  const resolvedBoardId = boardId || boardData?.board?.id;
  const userRole = boardData?.role || 'viewer';
  const readOnly = !isPublicView && userRole === 'viewer';

  // Set read-only status when board data loads
  useEffect(() => {
    if (boardData && readOnly) {
      setSaveStatus('readonly');
    }
  }, [boardData, readOnly]);

  // Toast helper
  const showToast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  // Save manager
  const { scheduleSave } = useSaveManager({ resolvedBoardId, isPublicView, readOnly, canvasRef, setSaveStatus });

  // Canvas change handler.
  // Pass changedIds for incremental sync (fast, lightweight).
  // Omit for structural changes — falls through to debounced full scene sync.
  const onCanvasChange = useCallback((changedIds?: string[]) => {
    scheduleSave();
    setSceneVersion(v => v + 1);
    // Reposition all markdown overlay divs to match canvas items
    mdOverlayRef.current?.refreshAll();
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
    // Update scene loading state
    const isLoading = canvasRef.current?.isSceneLoading() ?? false;
    setSceneLoading(isLoading);
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

  // Paste detection callbacks — wired into setupPaste via useCanvasSetup
  const handleTextPaste = useCallback((data: { text: string; html: string; hasImage: boolean }) => {
    // Show popup at screen center
    const container = canvasContainerRef.current;
    const rect = container?.getBoundingClientRect();
    const sx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const sy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    setPastePopup({ x: sx, y: sy, text: data.text, html: data.html, hasImage: data.hasImage });
  }, [canvasContainerRef]);

  const handleShortTextPaste = useCallback((text: string) => {
    const scene = canvasRef.current?.getScene();
    const viewport = canvasRef.current?.getViewport();
    if (!scene || !viewport) return;
    const cx = viewport.center.x;
    const cy = viewport.center.y;
    const textData = {
      id: crypto.randomUUID(),
      type: 'text' as const,
      x: cx - 100, y: cy - 20, w: 200, h: 40,
      sx: 1, sy: 1, angle: 0, z: scene.nextZ(),
      opacity: 1, locked: false, name: '', visible: true,
      text,
      fontSize: 24, fontFamily: 'Inter, system-ui, sans-serif',
      fill: '#ffffff',
    };
    scene._createItem(textData, true);
    scene._applyZOrder();
    onCanvasChange([textData.id]);
  }, [canvasRef, onCanvasChange]);

  // PDF upload callback — opens picker for multi-page PDFs
  const onPdfUploaded = useCallback((data: { imageId: string; fileName: string; pageCount: number; dimensions: Array<{ w: number; h: number }>; singlePage: boolean }) => {
    if (data.singlePage) return; // single-page PDFs are placed directly
    setPdfPicker({
      imageId: data.imageId,
      fileName: data.fileName,
      pageCount: data.pageCount,
      dimensions: data.dimensions,
    });
  }, []);

  // Handle placing selected PDF pages from the picker
  const handlePdfPlace = useCallback(async (selectedPages: number[]) => {
    if (!pdfPicker || !resolvedBoardId) return;
    const scene = canvasRef.current?.getScene();
    const viewport = canvasRef.current?.getViewport();
    if (!scene || !viewport) return;

    try {
      // Request hires rendering for selected pages
      await api.post(`/api/boards/${resolvedBoardId}/pdf-pages`, {
        imageId: pdfPicker.imageId,
        pages: selectedPages,
      });
    } catch (err) {
      console.error('[Editor] pdf-pages request failed:', err);
    }

    // Place pages in a grid at viewport center
    const cx = viewport.center.x;
    const cy = viewport.center.y;
    const GAP = 20;
    const cols = Math.ceil(Math.sqrt(selectedPages.length)) || 1;
    let col = 0;
    let cursorY = cy;
    let rowMaxH = 0;
    const colWidths: number[] = new Array(cols).fill(0);
    const newItemIds: string[] = [];

    for (const page of selectedPages) {
      const dim = pdfPicker.dimensions[page - 1] || { w: 612, h: 792 };
      // Cap each page to 600px max dimension
      const maxDim = 600;
      let w = dim.w;
      let h = dim.h;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      let cursorX = cx;
      for (let c = 0; c < col; c++) cursorX += (colWidths[c] || 220) + GAP;

      const item = scene.addPdfPageFromUpload(
        null, null, w, h,
        cursorX, cursorY,
        pdfPicker.imageId, pdfPicker.fileName,
        page, pdfPicker.pageCount,
      );
      newItemIds.push(item.id);
      if (w > (colWidths[col] || 0)) colWidths[col] = w;
      if (h > rowMaxH) rowMaxH = h;

      col++;
      if (col >= cols) {
        col = 0;
        cursorY += rowMaxH + GAP;
        rowMaxH = 0;
      }
    }

    // Select all placed items
    const selection = selectionRef.current;
    if (selection && newItemIds.length > 0) {
      selection.selectOnly(newItemIds[0]);
      for (let i = 1; i < newItemIds.length; i++) {
        selection.toggle(newItemIds[i]);
      }
    }

    onCanvasChange();
    setPdfPicker(null);
  }, [pdfPicker, resolvedBoardId, canvasRef, selectionRef, onCanvasChange]);

  // Memoize pasteOpts so useCanvasSetup's effect doesn't re-run every render
  const pasteOpts = useMemo(() => ({
    onTextPaste: handleTextPaste,
    onShortTextPaste: handleShortTextPaste,
    onPdfUploaded,
  }), [handleTextPaste, handleShortTextPaste, onPdfUploaded]);

  // Canvas setup (selection, undo, sync, socket, drag/drop, paste, inbox, annotations)
  const { annotationStore, pinOverlay, textEditor, cropOverlayRef, mdOverlay } = useCanvasSetup({
    boardData, resolvedBoardId, user, isPublicView,
    canvasRef, selectionRef, undoRef, syncRef, inboxZoneRef, canvasContainerRef,
    uploadManager, onCanvasChange, showToast, setOnlineUsers, setSelectedLayerIds,
    pasteOpts, onPdfUploaded,
    onCropModeChange: setCropModeActive,
  });

  // ── Markdown overlay — sync visible card IDs for React portal rendering ──
  const [mdCardIds, setMdCardIds] = useState<string[]>([]);
  const [editingMdId, setEditingMdId] = useState<string | null>(null);
  const [mdRevision, setMdRevision] = useState(0);

  useEffect(() => {
    if (!mdOverlay) return;
    mdOverlayRef.current = mdOverlay;

    const syncIds = () => {
      const scene = canvasRef.current?.getScene();
      if (!scene) return;
      const ids: string[] = [];
      for (const [id, item] of scene.items) {
        if (item.type === 'markdown' && item.data.visible) {
          ids.push(id);
        }
      }
      setMdCardIds(prev => {
        if (prev.length === ids.length && prev.every((v, i) => v === ids[i])) return prev;
        return ids;
      });
    };

    mdOverlay.onChange = syncIds;
    mdOverlay.onRequestEdit = (id) => {
      setEditingMdId(id);
      if (id) {
        selectionRef.current?.setEnabled(false);
      } else {
        selectionRef.current?.setEnabled(true);
      }
    };
    syncIds();
    return () => {
      mdOverlay.onChange = null;
      mdOverlay.onRequestEdit = null;
    };
  }, [mdOverlay]);

  // Build canvas objects map for FeedbackPanel (memoized on object count changes)
  const canvasObjectMap = React.useMemo(() => {
    const scene = canvasRef.current?.getScene();
    const map = new Map<string, { id: string; name?: string; type: string }>();
    if (scene) {
      for (const item of scene.items.values()) {
        map.set(item.id, { id: item.id, name: item.data.name, type: item.data.type });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectCount]);

  // Track asset load progress during initial load
  useEffect(() => {
    if (!sceneLoading && loadProgress.total > 0 && loadProgress.loaded >= loadProgress.total) return;
    const interval = setInterval(() => {
      const scene = canvasRef.current?.getScene();
      if (!scene) return;
      const progress = scene.getLoadProgress();
      setLoadProgress(progress);
      // Also update sceneLoading flag
      const isLoading = canvasRef.current?.isSceneLoading() ?? false;
      setSceneLoading(isLoading);
    }, 300);
    return () => clearInterval(interval);
  }, [sceneLoading, loadProgress]);

  // Inline composer position — tracks viewport + scene changes for anchored placement
  const composerAnchor = draftPin ? { objectId: draftPin.objectId, pinX: draftPin.pinX, pinY: draftPin.pinY } : null;
  const composerPos = useAnchoredOverlayPosition(
    canvasRef.current?.getViewport() ?? null,
    canvasRef.current?.getScene() ?? null,
    composerAnchor,
    sceneVersion,
  );

  // Keep reviewModeRef in sync for tool handlers to read
  useEffect(() => {
    reviewModeRef.current = reviewMode;
  }, [reviewMode]);

  // Pins visible only in review mode
  useEffect(() => {
    if (!pinOverlay) return;
    pinOverlay.visible = reviewMode;
    if (reviewMode) pinOverlay.refresh();
  }, [pinOverlay, reviewMode]);

  // Sync draft pin to PinOverlay ghost pin
  useEffect(() => {
    if (!pinOverlay) return;
    pinOverlay.setGhostPin(draftPin ? { objectId: draftPin.objectId, pinX: draftPin.pinX, pinY: draftPin.pinY } : null);
  }, [draftPin, pinOverlay]);

  // Sync focused thread to PinOverlay focus visuals
  useEffect(() => {
    if (!pinOverlay) return;
    pinOverlay.setFocusedThread(focusedThreadId);
  }, [focusedThreadId, pinOverlay]);

  // Review-mode pointer handling: pin click + draft pin placement
  useEffect(() => {
    const vp = canvasRef.current?.getViewport();
    if (!vp || !pinOverlay) return;

    let downX = 0;
    let downY = 0;
    let dragOccurred = false;

    const onPointerDown = (e: any) => {
      const screen = e.global || e.data?.global;
      if (!screen) return;
      downX = screen.x;
      downY = screen.y;
      dragOccurred = false;
    };

    const onPointerMove = (e: any) => {
      if (dragOccurred) return;
      const screen = e.global || e.data?.global;
      if (!screen) return;
      const dx = screen.x - downX;
      const dy = screen.y - downY;
      if (dx * dx + dy * dy > 25) { // 5px threshold
        dragOccurred = true;
      }
    };

    const onPointerUp = (e: any) => {
      if (dragOccurred) return;
      if (!reviewMode) return;

      const screen = e.global || e.data?.global;
      if (!screen) return;
      const worldPos = vp.toWorld(screen.x, screen.y);

      // Priority 1: existing pin
      const threadId = pinOverlay.getThreadIdAtPoint(worldPos.x, worldPos.y);
      if (threadId) {
        setFocusedThreadId(threadId);
        setDraftPin(null);
        expandSeqRef.current += 1;
        setExpandRequest({ threadId, seq: expandSeqRef.current });
        return;
      }

      // Priority 2: scene object (place draft pin) — only for editor/owner
      const scene = canvasRef.current?.getScene();
      if (scene && userRole !== 'viewer') {
        const clickRadius = 10 / vp.scale.x;
        const target = resolveReviewTargetAtPoint({
          scene,
          worldX: worldPos.x,
          worldY: worldPos.y,
          clickRadius,
        });
        // Defensive guard: never attach a comment to a group
        if (target && target.objectType !== 'group') {
          setDraftPin({
            objectId: target.objectId,
            pinX: target.pinX,
            pinY: target.pinY,
            worldX: target.worldX,
            worldY: target.worldY,
          });
          setFocusedThreadId(null);
          return;
        }
      }

      // Priority 3: empty canvas — clear draft and focus
      setDraftPin(null);
      setFocusedThreadId(null);
    };

    vp.on('pointerdown', onPointerDown);
    vp.on('pointermove', onPointerMove);
    vp.on('pointerup', onPointerUp);

    return () => {
      vp.off('pointerdown', onPointerDown);
      vp.off('pointermove', onPointerMove);
      vp.off('pointerup', onPointerUp);
    };
  }, [reviewMode, pinOverlay, userRole]);

  // Review-mode Escape priority: draft → thread detail → review mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      if (draftPin) {
        e.preventDefault();
        setDraftPin(null);
        setDraftCommentText('');
        return;
      }
      if (openThreadDetailId) {
        e.preventDefault();
        setFocusedThreadId(null);
        // Send collapse signal to FeedbackPanel
        expandSeqRef.current += 1;
        setExpandRequest({ threadId: null, seq: expandSeqRef.current });
        return;
      }
      if (reviewMode) {
        // Don't exit review mode if user is typing in an unrelated input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        setReviewMode(false);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draftPin, openThreadDetailId, reviewMode]);

  // Create point-pinned thread via REST
  const handleCreatePointThread = useCallback(async (draft: DraftPin, content: string) => {
    if (!resolvedBoardId || creatingPointThread) return;
    const token = localStorage.getItem('refboard_token');
    if (!token) return;
    setCreatingPointThread(true);
    try {
      const res = await fetch(`/api/boards/${resolvedBoardId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          object_id: draft.objectId,
          anchor_type: 'point',
          pin_x: draft.pinX,
          pin_y: draft.pinY,
          content,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || 'Failed to create comment');
        return;
      }
      const data = await res.json();
      // Clear draft, pre-focus the new thread
      setDraftPin(null);
      setDraftCommentText('');
      setFocusedThreadId(data.thread.id);
      expandSeqRef.current += 1;
      setExpandRequest({ threadId: data.thread.id, seq: expandSeqRef.current });
    } catch (err: any) {
      showToast('Failed to create comment: ' + (err.message || 'network error'));
    } finally {
      setCreatingPointThread(false);
    }
  }, [resolvedBoardId, showToast, creatingPointThread]);

  // Clear draft and focus when exiting review mode
  useEffect(() => {
    if (!reviewMode) {
      setDraftPin(null);
      setDraftCommentText('');
      setFocusedThreadId(null);
      setExpandRequest(null);
    }
  }, [reviewMode]);

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
      textEditor: textEditor ?? undefined,
      switchToSelect: () => setActiveTool(ToolType.SELECT),
      onMarkdownCreated: (id) => {
        setEditingMdId(id);
        mdOverlay?.setEditing(id);
        selectionRef.current?.setEnabled(false);
      },
    };
    // reviewMode is read at click time via getter so it stays current
    Object.defineProperty(ctx, 'reviewMode', { get: () => reviewModeRef.current });
    toolCleanupRef.current = activateTool(ctx, activeTool, { color, strokeWidth });
  }, [activeTool, color, strokeWidth, onCanvasChange, textEditor]);

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
      const scene = canvasRef.current?.getScene() ?? undefined;
      await writeClipboard(app, viewport, items, scene);
    } catch (err: any) {
      showToast('Copy failed: ' + (err.message || 'clipboard not available'));
    }
  }, [showToast]);

  const handleRefreshPreview = useCallback(async () => {
    if (!resolvedBoardId || isPublicView || readOnly || refreshingPreview) return;
    const scene = canvasRef.current?.getScene();
    const viewport = canvasRef.current?.getViewport();
    const app = canvasRef.current?.getApp();
    if (!scene || !app) {
      showToast('Preview snapshot is not available');
      return;
    }

    setRefreshingPreview(true);
    try {
      const directCanvas = app.canvas as unknown as HTMLCanvasElement | undefined;
      const sourceCanvas = directCanvas
        ?? (viewport && app.renderer?.extract
          ? (app.renderer.extract.canvas(viewport) as HTMLCanvasElement)
          : undefined);
      if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
        throw new Error('rendered canvas is unavailable');
      }

      const maxWidth = 900;
      const scale = sourceCanvas.width > maxWidth ? maxWidth / sourceCanvas.width : 1;
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
      out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('2D context unavailable');
      ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
      const thumbnail = out.toDataURL('image/jpeg', 0.82);
      await saveCanvas(resolvedBoardId, JSON.stringify(scene.serialize()), thumbnail);
      setSaveStatus('saved');
      showToast('Board preview updated');
    } catch (err: any) {
      showToast('Preview update failed: ' + (err.message || 'unknown error'));
    } finally {
      setRefreshingPreview(false);
    }
  }, [resolvedBoardId, isPublicView, readOnly, refreshingPreview, showToast]);

  const startCropForSelection = useCallback((showInvalidToast = false) => {
    const selection = selectionRef.current;
    if (!selection || !cropOverlayRef.current) return;
    const items = selection.getSelectedItems();
    if (items.length !== 1 || items[0].type !== 'image') {
      if (showInvalidToast) showToast('Select a single image to crop');
      return;
    }
    selection.setEnabled(false);
    cropOverlayRef.current.start(items[0]);
  }, [showToast, cropOverlayRef]);

  // Keyboard shortcuts
  useShortcutHandler({
    canvasRef, selectionRef, undoRef, clipboardRef, resolvedBoardId,
    onCanvasChange, showToast, refreshLayers,
    handleGroup, handleUngroup,
    setActiveTool, setCanUndo, setCanRedo, setZoom,
    setShowGrid, setShowHelp, setFocusMode, setReviewMode,
    startCrop: () => startCropForSelection(true),
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
      startCrop: () => startCropForSelection(false),
    });
  }, [writeCanvasToClipboard, onCanvasChange, handleGroup, handleUngroup, refreshLayers, startCropForSelection]);

  // Save on page unload (only for users with edit access)
  useEffect(() => {
    if (readOnly || isPublicView) return;
    function onBeforeUnload() {
      const scene = canvasRef.current?.getScene();
      if (!scene || !resolvedBoardId) return;
      const token = localStorage.getItem('refboard_token');
      if (!token) return;
      const state = JSON.stringify(scene.serialize());
      // Use fetch with keepalive to include auth header (sendBeacon can't set headers)
      fetch(`/api/boards/${resolvedBoardId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ canvas_state: state }),
        keepalive: true,
      }).catch(() => {});
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [resolvedBoardId, readOnly, isPublicView]);

  // Update UI overlays (selection toolbar, video controls, minimap) on demand
  const updateOverlays = useCallback(() => {
    const selection = selectionRef.current;
    const vp = canvasRef.current?.getViewport();
    if (!selection || !vp) { setSelToolbar(null); setCropToolbar(null); setVideoCtrl(null); return; }
    const items = selection.getSelectedItems();
    const cropActive = cropModeActive && (cropOverlayRef.current?.isActive ?? false);

    setZoom(canvasRef.current?.getZoom() ?? 1);
    setCanvasTransform([vp.scale.x, 0, 0, vp.scale.y, vp.x, vp.y]);

    if (cropActive && items.length === 1 && items[0].type === 'image') {
      const b = getItemWorldBounds(items[0]);
      const screenTL = vp.toScreen(b.x, b.y);
      const screenTR = vp.toScreen(b.x + b.w, b.y);
      setCropToolbar({
        x: (screenTL.x + screenTR.x) / 2,
        y: screenTL.y,
        name: items[0].data.name || 'Image',
      });
      setSelToolbar(null);
      setTextToolbar(null);
      setVideoCtrl(null);
    } else {
      setCropToolbar(null);
    }

    // Video controls: show when exactly 1 video is selected
    if (!cropActive && items.length === 1 && items[0].type === 'video' && items[0].displayObject instanceof VideoSprite) {
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

    // Contextual format toolbar: show when all selected items are the same text-like type
    const textItems = items.filter((it) => it.type === 'text');
    const stickyItems = items.filter((it) => it.type === 'sticky');
    const formatItems = textItems.length === items.length ? textItems
      : stickyItems.length === items.length ? stickyItems
      : null; // mixed or non-text selection → hide

    if (!cropActive && formatItems && formatItems.length > 0) {
      let minX2 = Infinity, minY2 = Infinity, maxX2 = -Infinity, maxY2 = -Infinity;
      for (const item of formatItems) {
        const b = getItemWorldBounds(item);
        if (b.x < minX2) minX2 = b.x;
        if (b.y < minY2) minY2 = b.y;
        if (b.x + b.w > maxX2) maxX2 = b.x + b.w;
        if (b.y + b.h > maxY2) maxY2 = b.y + b.h;
      }
      const screenTL2 = vp.toScreen(minX2, minY2);
      const screenTR2 = vp.toScreen(maxX2, minY2);
      const screenBL2 = vp.toScreen(minX2, maxY2);
      const screenBR2 = vp.toScreen(maxX2, maxY2);
      const useBottom = formatItems.length >= 2;
      const posX = useBottom ? (screenBL2.x + screenBR2.x) / 2 : (screenTL2.x + screenTR2.x) / 2;
      const posY = useBottom ? (screenBL2.y + screenBR2.y) / 2 + 8 : screenTL2.y;

      if (formatItems === textItems) {
        const td = textItems[0].data as TextObject;
        setTextToolbar({
          kind: 'text', x: posX, y: posY,
          fontFamily: td.fontFamily, fill: td.fill,
          items: textItems,
        });
      } else {
        const sd = stickyItems[0].data as StickyObject;
        setTextToolbar({
          kind: 'sticky', x: posX, y: posY,
          fontFamily: sd.fontFamily || 'Inter, system-ui, sans-serif',
          textColor: sd.textColor || '#1a1a1a', fill: sd.fill || '#ffd43b',
          stickyFontSize: sd.fontSize || 14,
          items: stickyItems,
        });
      }
    } else {
      setTextToolbar(null);
    }

    // Markdown format toolbar: show when exactly one markdown card is selected
    const mdItems = items.filter((it) => it.type === 'markdown');
    if (!cropActive && mdItems.length === 1 && items.length === 1) {
      const b = getItemWorldBounds(mdItems[0]);
      const screenTL = vp.toScreen(b.x, b.y);
      const screenTR = vp.toScreen(b.x + b.w, b.y);
      setMdToolbar({ x: (screenTL.x + screenTR.x) / 2, y: screenTL.y, item: mdItems[0] });
    } else {
      setMdToolbar(null);
    }

    if (cropActive || items.length < 2) { setSelToolbar(null); } else {
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

    // Pin positions follow media automatically (children of displayObjects).
    // Only refresh on zoom to update counter-scale.
    pinOverlay?.refresh();
  }, [pinOverlay, cropOverlayRef, cropModeActive]);

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
  }, [selectedLayerIds, sceneVersion, cropModeActive, updateOverlays]);

  // (PresenceOverlay removed — selection broadcast no longer needed)

  // -- Render --

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a1a', color: '#888', fontSize: '13px', gap: '12px', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ width: '24px', height: '24px', border: '2px solid #333', borderTopColor: '#4a9eff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        Loading board
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
        onExport={() => setShowExport(true)}
        onRefreshPreview={readOnly || isPublicView ? undefined : handleRefreshPreview}
        previewRefreshing={refreshingPreview}
        onToggleReview={() => setReviewMode((v) => !v)}
        reviewMode={reviewMode}
        boardName={board?.name}
      />}

      {/* Canvas + Markdown edit panel row */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
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

        {/* Loading overlay — blocks interaction until scene is ready */}
        {(sceneLoading || (objectCount > 0 && loadProgress.total > 0 && loadProgress.loaded < loadProgress.total)) && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 9999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(26, 26, 26, 0.85)', backdropFilter: 'blur(4px)',
            color: '#ccc', userSelect: 'none', fontFamily: 'system-ui, sans-serif',
            gap: '16px',
          }}>
            <div style={{
              width: '32px', height: '32px',
              border: '3px solid #333', borderTopColor: '#4a9eff', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>
              {sceneLoading
                ? `Loading ${loadProgress.total || ''} items…`
                : `Loading assets ${loadProgress.loaded} / ${loadProgress.total}`}
            </div>
            {loadProgress.total > 0 && (
              <div style={{
                width: '200px', height: '4px', borderRadius: '2px',
                background: '#333', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%`,
                  height: '100%', background: '#4a9eff', borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
          </div>
        )}
        {objectCount === 0 && !sceneLoading && (
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
        {selToolbar && selToolbar.count >= 2 && activeTool === ToolType.SELECT && !contextMenu && !cropToolbar && (
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
            onFlipH={() => { const s = selectionRef.current?.getSelectedItems()?.filter(i => !NON_TRANSFORMABLE.has(i.type)); if (s?.length) { ops.flipHorizontal(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onFlipV={() => { const s = selectionRef.current?.getSelectedItems()?.filter(i => !NON_TRANSFORMABLE.has(i.type)); if (s?.length) { ops.flipVertical(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onRotateCW={() => { const s = selectionRef.current?.getSelectedItems()?.filter(i => !NON_TRANSFORMABLE.has(i.type)); if (s?.length) { ops.rotate90(s, true); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onRotateCCW={() => { const s = selectionRef.current?.getSelectedItems()?.filter(i => !NON_TRANSFORMABLE.has(i.type)); if (s?.length) { ops.rotate90(s, false); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
            onGroup={handleGroup}
            onNormSize={() => { const s = selectionRef.current?.getSelectedItems(); if (s) { ops.normalizeSize(s); selectionRef.current?.transformBox.update(s); onCanvasChange(s.map(i => i.id)); } }}
          />
        )}

        {/* Contextual format toolbar (floating, above selected text/sticky items) */}
        {textToolbar && activeTool === ToolType.SELECT && !contextMenu && !cropToolbar && (
          <TextFormatToolbar
            kind={textToolbar.kind}
            x={textToolbar.x}
            y={textToolbar.y}
            fontFamily={textToolbar.fontFamily}
            fill={textToolbar.kind === 'sticky' ? textToolbar.textColor : textToolbar.fill}
            noteFill={textToolbar.kind === 'sticky' ? textToolbar.fill : undefined}
            stickyFontSize={textToolbar.kind === 'sticky' ? textToolbar.stickyFontSize : undefined}
            position={textToolbar.items.length >= 2 ? 'below' : 'above'}
            onFontFamilyChange={(family) => {
              const scene = canvasRef.current?.getScene();
              for (const item of textToolbar.items) {
                if (textToolbar.kind === 'text') {
                  const d = item.data as TextObject;
                  d.fontFamily = family;
                  if (item.displayObject instanceof TextSprite) {
                    item.displayObject.updateFromData(d);
                    d.w = item.displayObject.measuredWidth;
                    d.h = item.displayObject.measuredHeight;
                  }
                } else {
                  const d = item.data as StickyObject;
                  d.fontFamily = family;
                  if (item.displayObject instanceof StickySprite) {
                    item.displayObject.updateFromData(d);
                    d.h = item.displayObject.computedHeight;
                  }
                }
                if (scene) scene.updateSpatialEntry(item);
              }
              selectionRef.current?.transformBox.update(textToolbar.items);
              onCanvasChange(textToolbar.items.map(i => i.id));
              updateOverlays();
            }}
            onFillChange={(textColor) => {
              for (const item of textToolbar.items) {
                if (textToolbar.kind === 'text') {
                  const d = item.data as TextObject;
                  d.fill = textColor;
                  if (item.displayObject instanceof TextSprite) {
                    item.displayObject.updateFromData(d);
                  }
                } else {
                  const d = item.data as StickyObject;
                  d.textColor = textColor;
                  if (item.displayObject instanceof StickySprite) {
                    item.displayObject.updateFromData(d);
                  }
                }
              }
              onCanvasChange(textToolbar.items.map(i => i.id));
              updateOverlays();
            }}
            onNoteFillChange={textToolbar.kind === 'sticky' ? (fillColor) => {
              for (const item of textToolbar.items) {
                const d = item.data as StickyObject;
                d.fill = fillColor;
                if (item.displayObject instanceof StickySprite) {
                  item.displayObject.updateFromData(d);
                }
              }
              onCanvasChange(textToolbar.items.map(i => i.id));
              updateOverlays();
            } : undefined}
            onStickySizeChange={textToolbar.kind === 'sticky' ? (fontSize) => {
              const scene = canvasRef.current?.getScene();
              const newWidth = getStickyWidthForSize(fontSize);
              for (const item of textToolbar.items) {
                const d = item.data as StickyObject;
                d.fontSize = fontSize;
                d.w = newWidth;
                if (item.displayObject instanceof StickySprite) {
                  item.displayObject.updateFromData(d);
                  d.h = item.displayObject.computedHeight;
                }
                if (scene) scene.updateSpatialEntry(item);
              }
              setTextToolbar((prev) => prev && prev.kind === 'sticky' ? { ...prev, stickyFontSize: fontSize } : prev);
              selectionRef.current?.transformBox.update(textToolbar.items);
              onCanvasChange(textToolbar.items.map(i => i.id));
              updateOverlays();
            } : undefined}
          />
        )}

        {/* Markdown format toolbar */}
        {mdToolbar && activeTool === ToolType.SELECT && !contextMenu && !editingMdId && (
          <MarkdownFormatToolbar
            x={mdToolbar.x}
            y={mdToolbar.y}
            accentColor={(mdToolbar.item.data as MarkdownObject).accentColor}
            width={mdToolbar.item.data.w}
            name={mdToolbar.item.data.name || ''}
            onColorChange={(accent, bg) => {
              const data = mdToolbar.item.data as MarkdownObject;
              data.accentColor = accent;
              data.bgColor = bg;
              if (mdToolbar.item.displayObject instanceof MarkdownSprite) {
                mdToolbar.item.displayObject.updateFromData(data);
              }
              mdOverlay?.updateItem(mdToolbar.item.id);
              onCanvasChange([mdToolbar.item.id]);
              updateOverlays();
            }}
            onWidthChange={(w) => {
              const data = mdToolbar.item.data as MarkdownObject;
              data.w = w;
              if (mdToolbar.item.displayObject instanceof MarkdownSprite) {
                mdToolbar.item.displayObject.updateFromData(data);
              }
              mdOverlay?.updateItem(mdToolbar.item.id);
              mdOverlay?.measureHeight(mdToolbar.item.id);
              onCanvasChange([mdToolbar.item.id]);
              selectionRef.current?.transformBox.update([mdToolbar.item]);
              updateOverlays();
            }}
            onNameChange={(n) => {
              mdToolbar.item.data.name = n;
              setMdToolbar({ ...mdToolbar });
              setMdRevision(r => r + 1);
              onCanvasChange([mdToolbar.item.id]);
            }}
          />
        )}

        {/* Video controls (floating, below selected video) */}
        {videoCtrl && activeTool === ToolType.SELECT && !contextMenu && !cropToolbar && (
          <VideoControls
            videoSprite={videoCtrl.videoSprite}
            screenRect={videoCtrl.screenRect}
          />
        )}

        {cropToolbar && activeTool === ToolType.SELECT && !contextMenu && (
          <div
            style={{
              position: 'absolute',
              left: cropToolbar.x,
              top: cropToolbar.y - 10,
              transform: 'translate(-50%, -100%)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 10px',
              background: 'rgba(18, 18, 18, 0.96)',
              border: '1px solid #3a3a3a',
              borderRadius: '12px',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
              zIndex: 140,
              pointerEvents: 'auto',
              color: '#e8e8e8',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '220px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  background: '#214765',
                  color: '#9fd3ff',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  Crop Mode
                </span>
                <span style={{ fontSize: '12px', color: '#b7b7b7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cropToolbar.name}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#8f8f8f' }}>
                Drag inside to move. Drag handles to resize. Enter applies. Esc cancels.
              </div>
            </div>
            <button
              onClick={() => {
                cropOverlayRef.current?.cancel();
                updateOverlays();
              }}
              style={{
                height: '30px',
                padding: '0 12px',
                background: 'transparent',
                border: '1px solid #444',
                borderRadius: '8px',
                color: '#d0d0d0',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                cropOverlayRef.current?.confirm();
                updateOverlays();
              }}
              style={{
                height: '30px',
                padding: '0 12px',
                background: '#4a90d9',
                border: '1px solid #4a90d9',
                borderRadius: '8px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Apply
            </button>
          </div>
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

        {/* Inline comment composer — anchored to draft pin */}
        {reviewMode && draftPin && (
          <InlineCommentComposer
            visible={composerPos.visible}
            x={composerPos.screenX}
            y={composerPos.screenY}
            placement={composerPos.placement}
            objectLabel={
              canvasObjectMap.get(draftPin.objectId)?.name ||
              canvasObjectMap.get(draftPin.objectId)?.type ||
              'Object'
            }
            value={draftCommentText}
            onChange={setDraftCommentText}
            onSubmit={async () => {
              if (!draftPin || !draftCommentText.trim()) return;
              await handleCreatePointThread(draftPin, draftCommentText.trim());
            }}
            onCancel={() => {
              setDraftPin(null);
              setDraftCommentText('');
            }}
            submitting={creatingPointThread}
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

        {/* Paste choice popup */}
        {pastePopup && (
          <PasteChoicePopup
            x={pastePopup.x}
            y={pastePopup.y}
            showImage={pastePopup.hasImage}
            onChoice={async (choice) => {
              setPastePopup(null);
              const scene = canvasRef.current?.getScene();
              const viewport = canvasRef.current?.getViewport();
              if (!scene || !viewport) return;
              if (choice === 'markdown') {
                let content = pastePopup.text;
                if (pastePopup.html) {
                  const { default: TurndownService } = await import('turndown');
                  const td = new TurndownService();
                  content = td.turndown(pastePopup.html);
                }
                const cx = viewport.center.x;
                const cy = viewport.center.y;
                const mdData = {
                  id: crypto.randomUUID(),
                  type: 'markdown' as const,
                  x: cx - 225, y: cy - 30, w: 450, h: 60,
                  sx: 1, sy: 1, angle: 0, z: scene.nextZ(),
                  opacity: 1, locked: false, name: '', visible: true,
                  content,
                  bgColor: '#232336', textColor: '#e0e0e0', accentColor: '#7950f2',
                  padding: 16, cornerRadius: 10,
                };
                scene._createItem(mdData, true);
                scene._applyZOrder();
                onCanvasChange([mdData.id]);
              } else if (choice === 'text') {
                const cx = viewport.center.x;
                const cy = viewport.center.y;
                const textData = {
                  id: crypto.randomUUID(),
                  type: 'text' as const,
                  x: cx - 100, y: cy - 20, w: 200, h: 40,
                  sx: 1, sy: 1, angle: 0, z: scene.nextZ(),
                  opacity: 1, locked: false, name: '', visible: true,
                  text: pastePopup.text,
                  fontSize: 24, fontFamily: 'Inter, system-ui, sans-serif',
                  fill: '#ffffff',
                };
                scene._createItem(textData, true);
                scene._applyZOrder();
                onCanvasChange([textData.id]);
              } else if (choice === 'image') {
                // Image paste handled by existing setupPaste media loop
              }
            }}
            onDismiss={() => setPastePopup(null)}
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

        {/* Feedback / Review panel */}
        {reviewMode && annotationStore && user && resolvedBoardId && (
          <FeedbackPanel
            annotationStore={annotationStore}
            selectedObjectId={draftPin ? null : (selectedLayerIds.length === 1 ? selectedLayerIds[0] : null)}
            userId={user.id}
            boardId={resolvedBoardId}
            token={localStorage.getItem('refboard_token') || ''}
            canvasObjects={canvasObjectMap}
            onError={(msg) => showToast(msg)}
            expandRequest={expandRequest}
            focusedThreadId={focusedThreadId}
            onThreadDetailChange={setOpenThreadDetailId}
            onJumpToObject={(objectId, thread) => {
              const scene = canvasRef.current?.getScene();
              const vp = canvasRef.current?.getViewport();
              if (!scene || !vp) return;
              const item = scene.items.get(objectId);
              if (!item) {
                showToast('This item has been deleted');
                return;
              }
              const b = getItemWorldBounds(item);

              // For point-pinned threads, center on pin location
              let centerX = b.x + b.w / 2;
              let centerY = b.y + b.h / 2;
              if (thread?.anchor_type === 'point' && thread.pin_x != null && thread.pin_y != null) {
                const pinWorld = getPointAnchorWorld(scene, objectId, thread.pin_x, thread.pin_y);
                if (pinWorld) {
                  centerX = pinWorld.x;
                  centerY = pinWorld.y;
                }
              }

              // Pan only by default; zoom in if object is too small on screen
              const screenW = b.w * vp.scale.x;
              if (screenW < 50) {
                const targetScale = Math.min((vp.screenWidth * 0.6) / b.w, 5);
                vp.animate({ time: 300, position: { x: centerX, y: centerY }, scale: targetScale, ease: 'easeOutQuad' });
              } else {
                vp.animate({ time: 300, position: { x: centerX, y: centerY }, ease: 'easeOutQuad' });
              }
              selectionRef.current?.selectOnly(objectId);
            }}
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

      {/* Markdown editor side panel */}
      {editingMdId && (() => {
        const item = canvasRef.current?.getScene()?.getById(editingMdId);
        if (!item || item.type !== 'markdown') return null;
        const data = item.data as MarkdownObject;
        return (
          <div style={{
            width: '70%', minWidth: '400px', maxWidth: '900px',
            background: '#1a1a2e',
            borderLeft: '1px solid #333',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <React.Suspense fallback={
              <div style={{ padding: 24, color: '#888', fontSize: 13 }}>Loading editor...</div>
            }>
              <LazyMarkdownEditView
                key={`${editingMdId}-edit`}
                initialContent={data.content}
                accentColor={data.accentColor}
                onSave={(newContent) => {
                  const savedId = editingMdId!;
                  data.content = newContent;
                  const itemRef = canvasRef.current?.getScene()?.getById(savedId);
                  if (itemRef?.displayObject instanceof MarkdownSprite) {
                    itemRef.displayObject.updateFromData(data);
                  }
                  setEditingMdId(null);
                  mdOverlay?.setEditing(null);
                  selectionRef.current?.setEnabled(true);
                  setMdRevision(r => r + 1);
                  onCanvasChange([savedId]);
                  mdOverlay?.updateItem(savedId);
                  // Measure height after React re-renders the portal with new content.
                  // Multiple passes: react-markdown renders async, DOM needs layout time.
                  const measure = () => mdOverlay?.measureHeight(savedId);
                  setTimeout(measure, 50);
                  setTimeout(measure, 200);
                  setTimeout(measure, 500);
                }}
                onCancel={() => {
                  setEditingMdId(null);
                  mdOverlay?.setEditing(null);
                  selectionRef.current?.setEnabled(true);
                }}
              />
            </React.Suspense>
          </div>
        );
      })()}
      </div>{/* end flex row */}

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

      {/* Markdown card portals (read-only previews on canvas) */}
      {mdCardIds.map(id => {
        const mountPoint = mdOverlay?.getMountPoint(id);
        const item = canvasRef.current?.getScene()?.getById(id);
        if (!mountPoint || !item || item.type !== 'markdown') return null;
        const data = item.data as MarkdownObject;
        return ReactDOM.createPortal(
          <MarkdownReadView
            key={`${id}-${mdRevision}`}
            content={data.content}
            name={data.name}
            textColor={data.textColor}
            accentColor={data.accentColor}
            bgColor={data.bgColor}
            padding={data.padding}
            onCheckboxToggle={(newContent) => {
              data.content = newContent;
              onCanvasChange([id]);
              mdOverlay?.measureHeight(id);
            }}
          />,
          mountPoint,
        );
      })}

      {/* PDF page picker modal */}
      {pdfPicker && resolvedBoardId && (
        <PdfPickerModal
          imageId={pdfPicker.imageId}
          fileName={pdfPicker.fileName}
          pageCount={pdfPicker.pageCount}
          dimensions={pdfPicker.dimensions}
          boardId={resolvedBoardId}
          onPlace={handlePdfPlace}
          onCancel={() => setPdfPicker(null)}
        />
      )}

      {/* Export dialog */}
      {showExport && (
        <ExportDialog
          selectedItems={selectionRef.current?.getSelectedItems() ?? []}
          allItems={canvasRef.current?.getScene()?.getAllItems() ?? []}
          boardName={board?.name || 'export'}
          onExport={async (items, options) => {
            setShowExport(false);
            try {
              const app = canvasRef.current?.getApp() ?? null;
              const viewport = canvasRef.current?.getViewport() ?? null;
              const scene = canvasRef.current?.getScene() ?? undefined;
              await exportAsImage(app, viewport, items, options, scene);
              showToast('Exported successfully');
            } catch (err: any) {
              showToast('Export failed: ' + (err.message || 'unknown error'));
            }
          }}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

function StatusIndicator({ status }: { status: SaveStatus }) {
  const cfg: Record<SaveStatus, { color: string; label: string }> = {
    saved: { color: '#4ade80', label: 'Saved' },
    saving: { color: '#facc15', label: 'Saving...' },
    unsaved: { color: '#f87171', label: 'Unsaved' },
    readonly: { color: '#4dabf7', label: 'Read-only' },
  };
  const s = cfg[status] || cfg.saved;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.color }} />
      <span style={{ fontSize: '10px', color: '#666' }}>{s.label}</span>
    </div>
  );
}
