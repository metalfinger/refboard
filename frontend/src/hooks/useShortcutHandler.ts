import { useEffect } from 'react';
import type { PixiCanvasHandle } from '../canvas/PixiCanvas';
import type { SelectionManager } from '../canvas/SelectionManager';
import type { UndoManager } from '../canvas/history';
import type { SceneItem } from '../canvas/SceneManager';
import { getItemWorldBounds } from '../canvas/SceneManager';
import { ToolType, toolShortcuts } from '../canvas/tools';
import { ShortcutContext, matchesShortcut, sortBySpecificity } from '../canvas/shortcuts';
import { shortcuts as shortcutDefs } from '../canvas/shortcut-definitions';
import { writeCanvasToClipboard, pasteFromSystemClipboard } from '../canvas/clipboard';

// Pre-sort shortcuts by specificity (most modifiers first) for correct matching
const sortedShortcuts = sortBySpecificity(shortcutDefs);

interface ShortcutHandlerDeps {
  canvasRef: React.RefObject<PixiCanvasHandle | null>;
  selectionRef: React.RefObject<SelectionManager | null>;
  undoRef: React.RefObject<UndoManager | null>;
  clipboardRef: React.MutableRefObject<SceneItem[]>;
  resolvedBoardId: string | undefined;
  onCanvasChange: (changedIds?: string[]) => void;
  showToast: (msg: string) => void;
  refreshLayers: () => void;
  handleGroup: () => void;
  handleUngroup: () => void;
  setActiveTool: (t: ToolType) => void;
  setCanUndo: (v: boolean) => void;
  setCanRedo: (v: boolean) => void;
  setZoom: (z: number) => void;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;
  setReviewMode: React.Dispatch<React.SetStateAction<boolean>>;
  startCrop?: () => void;
}

/**
 * Keyboard shortcut handler — registry-based, delegates to shortcut-definitions.
 */
export function useShortcutHandler(deps: ShortcutHandlerDeps) {
  const {
    canvasRef, selectionRef, undoRef, clipboardRef, resolvedBoardId,
    onCanvasChange, showToast, refreshLayers,
    handleGroup, handleUngroup,
    setActiveTool, setCanUndo, setCanRedo, setZoom,
    setShowGrid, setShowHelp, setFocusMode, setReviewMode,
    startCrop,
  } = deps;

  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;

      const scene = canvasRef.current?.getScene();
      const selection = selectionRef.current;
      const viewport = canvasRef.current?.getViewport();
      if (!scene || !selection || !viewport) return;

      // Tool shortcuts (bare keys only for the primary visible tools)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = toolShortcuts[e.key.toLowerCase()];
        if (tool) {
          setActiveTool(tool);
          return;
        }
      }

      // Build context for shortcut handlers
      const ctx: ShortcutContext = {
        scene,
        selection,
        history: undoRef.current!,
        viewport,
        onChange: onCanvasChange,
        clipboardRef,
        writeCanvasToClipboard: async (items?: SceneItem[]) => {
          try {
            const app = canvasRef.current?.getApp() ?? null;
            await writeCanvasToClipboard(app, viewport, items);
          } catch (err: any) {
            showToast('Copy failed: ' + (err.message || 'clipboard not available'));
          }
        },
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
        toggleFocusMode: () => setFocusMode((v) => !v),
        toggleReviewMode: () => setReviewMode((v) => !v),
        startCrop,
        pasteFromSystemClipboard: async (): Promise<string> => {
          if (!resolvedBoardId) return 'No board';
          const msg = await pasteFromSystemClipboard(scene, viewport, resolvedBoardId, onCanvasChange);
          if (msg !== 'No image in clipboard') showToast(msg);
          return msg;
        },
        fitSelection: () => {
          const vp = canvasRef.current?.getViewport();
          if (!vp || !selection) return;
          const items = selection.getSelectedItems();
          if (items.length === 0) return;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const item of items) {
            const { x: ix, y: iy, w: iw, h: ih } = getItemWorldBounds(item);
            if (ix < minX) minX = ix;
            if (iy < minY) minY = iy;
            if (ix + iw > maxX) maxX = ix + iw;
            if (iy + ih > maxY) maxY = iy + ih;
          }
          const padding = 60;
          const contentW = maxX - minX + padding * 2;
          const contentH = maxY - minY + padding * 2;
          const scaleX = vp.screenWidth / contentW;
          const scaleY = vp.screenHeight / contentH;
          const targetScale = Math.min(scaleX, scaleY, 5);
          vp.animate({
            position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
            scale: targetScale,
            time: 300,
            ease: 'easeOutQuad',
          });
        },
      };

      // Match against sorted registry (most-specific first)
      for (const def of sortedShortcuts) {
        if (!matchesShortcut(e, def)) continue;

        // Check selection requirements
        const activeCount = selection.selectedIds.size;
        if (def.needsSelection && activeCount === 0) continue;
        if (def.minSelection && activeCount < def.minSelection) continue;

        if (def.preventDefault !== false) {
          e.preventDefault();
        }
        await def.handler(ctx);

        // Update zoom display after any action
        setZoom(canvasRef.current?.getZoom() ?? 1);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    canvasRef, selectionRef, undoRef, clipboardRef, resolvedBoardId,
    onCanvasChange, showToast, refreshLayers,
    handleGroup, handleUngroup,
    setActiveTool, setCanUndo, setCanRedo, setZoom,
    setShowGrid, setShowHelp, setFocusMode, setReviewMode,
  ]);
}
