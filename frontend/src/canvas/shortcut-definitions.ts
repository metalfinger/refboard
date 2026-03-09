/**
 * All shortcut definitions — the single source of truth for keyboard shortcuts.
 * Used by the keyboard handler AND the ShortcutsHelp overlay.
 *
 * BUGS FIXED in this revision:
 * - Ctrl+Y conflict (was both redo AND overlay-compare) → overlay moved to Ctrl+Shift+Y
 * - Ctrl+P (browser print) → changed to Ctrl+Shift+P for arrange optimal
 * - '?' key (Shift+/) → e.key is '?' not '/', fixed matcher key
 * - ArrowUp/Down with selection → layer ordering uses ] / [ again (arrows cycle/nudge)
 * - ArrowLeft/Right bare → only cycle when nothing selected, otherwise no-op
 * - ActiveSelection coordinates → use withBreak() for position-dependent ops
 * - Added Ctrl+S (prevent browser save-as)
 */

import { ShortcutDef } from './shortcuts';
import { FabricObject } from 'fabric';
import * as ops from './operations';

/** Helper: break ActiveSelection, run operation on canvas-level coords, restore selection */
function withBreak(ctx: { canvas: any; onCanvasChange: () => void }, fn: (objs: FabricObject[]) => void) {
  const { objects, restore } = ops.breakSelection(ctx.canvas);
  fn(objects);
  restore();
  ctx.canvas.requestRenderAll();
  ctx.onCanvasChange();
}

export const shortcuts: ShortcutDef[] = [

  // ═══════════════════════════════════════
  //  ALIGNMENT  (Ctrl + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'align-left', keys: { key: 'arrowleft', ctrl: true },
    category: 'alignment', description: 'Align left', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.alignLeft(objs)),
  },
  {
    id: 'align-right', keys: { key: 'arrowright', ctrl: true },
    category: 'alignment', description: 'Align right', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.alignRight(objs)),
  },
  {
    id: 'align-top', keys: { key: 'arrowup', ctrl: true },
    category: 'alignment', description: 'Align top', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.alignTop(objs)),
  },
  {
    id: 'align-bottom', keys: { key: 'arrowdown', ctrl: true },
    category: 'alignment', description: 'Align bottom', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.alignBottom(objs)),
  },

  // ═══════════════════════════════════════
  //  DISTRIBUTE  (Ctrl + Alt + Shift + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'distribute-h', keys: { key: 'arrowup', ctrl: true, alt: true, shift: true },
    category: 'alignment', description: 'Distribute horizontal', needsSelection: true, minSelection: 3,
    handler: (ctx) => withBreak(ctx, (objs) => ops.distributeHorizontal(objs)),
  },
  {
    id: 'distribute-v', keys: { key: 'arrowdown', ctrl: true, alt: true, shift: true },
    category: 'alignment', description: 'Distribute vertical', needsSelection: true, minSelection: 3,
    handler: (ctx) => withBreak(ctx, (objs) => ops.distributeVertical(objs)),
  },

  // ═══════════════════════════════════════
  //  NORMALIZE  (Ctrl + Alt + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'normalize-size', keys: { key: 'arrowup', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize size (same area)', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.normalizeSize(objs)),
  },
  {
    id: 'normalize-scale', keys: { key: 'arrowdown', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize scale', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.normalizeScale(objs)),
  },
  {
    id: 'normalize-height', keys: { key: 'arrowleft', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize height', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.normalizeHeight(objs)),
  },
  {
    id: 'normalize-width', keys: { key: 'arrowright', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize width', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.normalizeWidth(objs)),
  },

  // ═══════════════════════════════════════
  //  ARRANGEMENT
  // ═══════════════════════════════════════

  // FIX: Changed from Ctrl+P (browser print) to Ctrl+Shift+P
  {
    id: 'arrange-optimal', keys: { key: 'p', ctrl: true, shift: true },
    category: 'arrangement', description: 'Arrange optimal (pack)', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.arrangeOptimal(objs)),
  },
  {
    id: 'arrange-by-name', keys: { key: 'n', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange by name', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.arrangeByName(objs)),
  },
  {
    id: 'arrange-by-order', keys: { key: 'o', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange by z-order', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      const { objects, restore } = ops.breakSelection(ctx.canvas);
      ops.arrangeByZOrder(objects, ctx.canvas.getObjects());
      restore();
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },
  {
    id: 'arrange-random', keys: { key: 'r', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange randomly', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.arrangeRandomly(objs)),
  },
  {
    id: 'stack', keys: { key: 's', ctrl: true, alt: true },
    category: 'arrangement', description: 'Stack (pile on top)', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.stackObjects(objs)),
  },

  // ═══════════════════════════════════════
  //  IMAGE MANIPULATION
  // ═══════════════════════════════════════

  {
    id: 'flip-h', keys: { key: 'h', alt: true, shift: true },
    category: 'image', description: 'Flip horizontal', needsSelection: true,
    handler: (ctx) => {
      ops.flipHorizontal(ctx.getActiveObjects());
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },
  {
    id: 'flip-v', keys: { key: 'v', alt: true, shift: true },
    category: 'image', description: 'Flip vertical', needsSelection: true,
    handler: (ctx) => {
      ops.flipVertical(ctx.getActiveObjects());
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },
  {
    id: 'reset-transform', keys: { key: 't', ctrl: true, shift: true },
    category: 'image', description: 'Reset transform', needsSelection: true,
    handler: (ctx) => {
      ops.resetTransform(ctx.getActiveObjects());
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },
  {
    id: 'toggle-grayscale', keys: { key: 'g', alt: true },
    category: 'image', description: 'Toggle grayscale', needsSelection: true,
    handler: (ctx) => {
      ops.toggleGrayscale(ctx.getActiveObjects());
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },
  {
    id: 'toggle-locked', keys: { key: 'l', alt: true },
    category: 'image', description: 'Toggle locked', needsSelection: true,
    handler: (ctx) => {
      ops.toggleLocked(ctx.getActiveObjects());
      ctx.canvas.requestRenderAll(); ctx.refreshLayers();
    },
  },
  // FIX: Changed from Ctrl+Y (conflicts with redo) to Ctrl+Shift+Y
  {
    id: 'overlay-compare', keys: { key: 'y', ctrl: true, shift: true },
    category: 'image', description: 'Overlay / compare', needsSelection: true, minSelection: 2,
    handler: (ctx) => withBreak(ctx, (objs) => ops.overlayCompare(objs)),
  },

  // ═══════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════

  {
    id: 'clear-selection', keys: { key: 'escape' },
    category: 'navigation', description: 'Clear selection',
    handler: (ctx) => {
      ctx.canvas.discardActiveObject();
      ctx.canvas.requestRenderAll();
    },
  },
  {
    id: 'focus-all', keys: { key: '0', ctrl: true },
    category: 'navigation', description: 'Fit all in view',
    handler: (ctx) => ctx.fitAll(),
  },
  // FIX: Bare arrow Left/Right only cycle when nothing is selected.
  // When something IS selected, they're no-ops (prevent accidental cycling).
  // Layer ordering uses ] / [ (restored) to avoid arrow conflicts.
  {
    id: 'cycle-next', keys: { key: 'arrowright' },
    category: 'navigation', description: 'Select next object',
    handler: (ctx) => {
      // Only cycle when nothing selected — if selected, do nothing
      if (ctx.getActiveObjects().length > 0) return;
      const objects = ctx.canvas.getObjects();
      if (objects.length === 0) return;
      ctx.canvas.setActiveObject(objects[0]);
      ctx.canvas.requestRenderAll();
    },
  },
  {
    id: 'cycle-prev', keys: { key: 'arrowleft' },
    category: 'navigation', description: 'Select previous object',
    handler: (ctx) => {
      if (ctx.getActiveObjects().length > 0) return;
      const objects = ctx.canvas.getObjects();
      if (objects.length === 0) return;
      ctx.canvas.setActiveObject(objects[objects.length - 1]);
      ctx.canvas.requestRenderAll();
    },
  },
  // FIX: Layer ordering restored to ] / [ (not arrow keys — those conflict with cycle/nudge)
  {
    id: 'send-to-front', keys: { key: ']' },
    category: 'navigation', description: 'Bring forward',
    needsSelection: true,
    handler: (ctx) => {
      ctx.getActiveObjects().forEach((obj) => (ctx.canvas as any).bringObjectForward(obj));
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },
  {
    id: 'send-to-back', keys: { key: '[' },
    category: 'navigation', description: 'Send backward',
    needsSelection: true,
    handler: (ctx) => {
      ctx.getActiveObjects().forEach((obj) => (ctx.canvas as any).sendObjectBackwards(obj));
      ctx.canvas.requestRenderAll(); ctx.onCanvasChange();
    },
  },

  // ═══════════════════════════════════════
  //  EDITING
  // ═══════════════════════════════════════

  {
    id: 'select-all', keys: { key: 'a', ctrl: true },
    category: 'editing', description: 'Select all',
    handler: (ctx) => {
      ctx.canvas.discardActiveObject();
      const fabricNs = (window as any).fabric;
      if (fabricNs?.ActiveSelection) {
        const sel = new fabricNs.ActiveSelection(ctx.canvas.getObjects(), { canvas: ctx.canvas });
        ctx.canvas.setActiveObject(sel);
      }
      ctx.canvas.requestRenderAll();
    },
  },
  {
    id: 'copy', keys: { key: 'c', ctrl: true },
    category: 'editing', description: 'Copy',
    handler: (ctx) => {
      const active = ctx.getActiveObjects();
      if (active.length > 0) {
        ctx.clipboardRef.current = [...active];
        ctx.writeCanvasToClipboard(active);
        ctx.showToast('Copied');
      } else {
        ctx.writeCanvasToClipboard();
        ctx.showToast('Copied canvas');
      }
    },
  },
  {
    id: 'copy-as-image', keys: { key: 'c', ctrl: true, shift: true },
    category: 'editing', description: 'Copy as image to clipboard',
    handler: (ctx) => {
      const active = ctx.getActiveObjects();
      ctx.writeCanvasToClipboard(active.length > 0 ? active : undefined);
    },
  },
  {
    id: 'paste', keys: { key: 'v', ctrl: true },
    category: 'editing', description: 'Paste',
    handler: async (ctx) => {
      if (ctx.clipboardRef.current.length === 0) return;
      const newObjs: FabricObject[] = [];
      for (const original of ctx.clipboardRef.current) {
        try {
          const obj = await ctx.cloneFabricObject(original, 20, 20);
          ctx.canvas.add(obj);
          newObjs.push(obj);
        } catch (err) {
          console.error('Paste object failed:', err);
        }
      }
      ctx.clipboardRef.current = newObjs;
      ctx.canvas.requestRenderAll();
      ctx.onCanvasChange();
    },
  },
  {
    id: 'cut', keys: { key: 'x', ctrl: true },
    category: 'editing', description: 'Cut',
    handler: (ctx) => {
      const active = ctx.getActiveObjects();
      if (active.length === 0) return;
      ctx.clipboardRef.current = [...active];
      ctx.writeCanvasToClipboard(active);
      active.forEach((obj) => ctx.canvas.remove(obj));
      ctx.canvas.discardActiveObject();
      ctx.canvas.requestRenderAll();
      ctx.onCanvasChange();
      ctx.showToast('Cut');
    },
  },
  {
    id: 'duplicate', keys: { key: 'd', ctrl: true },
    category: 'editing', description: 'Duplicate',
    handler: async (ctx) => {
      const active = ctx.getActiveObjects();
      if (active.length === 0) return;
      for (const original of active) {
        try {
          const obj = await ctx.cloneFabricObject(original, 20, 20);
          ctx.canvas.add(obj);
        } catch (err) {
          console.error('Duplicate failed:', err);
        }
      }
      ctx.canvas.discardActiveObject();
      ctx.canvas.requestRenderAll();
      ctx.onCanvasChange();
    },
  },
  {
    id: 'delete', keys: { key: 'delete' },
    category: 'editing', description: 'Delete selected',
    needsSelection: true,
    handler: (ctx) => {
      const active = ctx.getActiveObjects();
      active.forEach((obj) => ctx.canvas.remove(obj));
      ctx.canvas.discardActiveObject();
      ctx.canvas.requestRenderAll();
      ctx.onCanvasChange();
    },
  },
  {
    id: 'delete-backspace', keys: { key: 'backspace' },
    category: 'editing', description: 'Delete selected',
    needsSelection: true,
    handler: (ctx) => {
      const active = ctx.getActiveObjects();
      active.forEach((obj) => ctx.canvas.remove(obj));
      ctx.canvas.discardActiveObject();
      ctx.canvas.requestRenderAll();
      ctx.onCanvasChange();
    },
  },
  {
    id: 'undo', keys: { key: 'z', ctrl: true },
    category: 'editing', description: 'Undo',
    handler: (ctx) => {
      ctx.undoRef.current?.undo();
      ctx.setCanUndo(ctx.undoRef.current?.canUndo() ?? false);
      ctx.setCanRedo(ctx.undoRef.current?.canRedo() ?? false);
      ctx.onCanvasChange();
    },
  },
  {
    id: 'redo', keys: { key: 'z', ctrl: true, shift: true },
    category: 'editing', description: 'Redo',
    handler: (ctx) => {
      ctx.undoRef.current?.redo();
      ctx.setCanUndo(ctx.undoRef.current?.canUndo() ?? false);
      ctx.setCanRedo(ctx.undoRef.current?.canRedo() ?? false);
      ctx.onCanvasChange();
    },
  },
  {
    id: 'redo-y', keys: { key: 'y', ctrl: true },
    category: 'editing', description: 'Redo (alt)',
    handler: (ctx) => {
      ctx.undoRef.current?.redo();
      ctx.setCanUndo(ctx.undoRef.current?.canUndo() ?? false);
      ctx.setCanRedo(ctx.undoRef.current?.canRedo() ?? false);
      ctx.onCanvasChange();
    },
  },
  {
    id: 'group', keys: { key: 'g', ctrl: true },
    category: 'editing', description: 'Group', needsSelection: true, minSelection: 2,
    handler: (ctx) => ctx.handleGroup(),
  },
  {
    id: 'ungroup', keys: { key: 'g', ctrl: true, shift: true },
    category: 'editing', description: 'Ungroup', needsSelection: true,
    handler: (ctx) => ctx.handleUngroup(),
  },
  // FIX: Block Ctrl+S from opening browser save-as dialog
  {
    id: 'save', keys: { key: 's', ctrl: true },
    category: 'editing', description: 'Save (auto-saves)',
    handler: (ctx) => {
      ctx.showToast('Auto-saved');
    },
  },

  // ═══════════════════════════════════════
  //  VIEW
  // ═══════════════════════════════════════

  {
    id: 'zoom-in', keys: { key: '=', ctrl: true },
    category: 'view', description: 'Zoom in',
    handler: (ctx) => {
      const z = Math.min(ctx.canvas.getZoom() * 1.2, 5);
      const center = ctx.canvas.getCenterPoint();
      ctx.canvas.zoomToPoint(center, z);
      ctx.canvas.requestRenderAll();
    },
  },
  {
    id: 'zoom-in-plus', keys: { key: '+', ctrl: true },
    category: 'view', description: 'Zoom in',
    handler: (ctx) => {
      const z = Math.min(ctx.canvas.getZoom() * 1.2, 5);
      const center = ctx.canvas.getCenterPoint();
      ctx.canvas.zoomToPoint(center, z);
      ctx.canvas.requestRenderAll();
    },
  },
  {
    id: 'zoom-out', keys: { key: '-', ctrl: true },
    category: 'view', description: 'Zoom out',
    handler: (ctx) => {
      const z = Math.max(ctx.canvas.getZoom() / 1.2, 0.1);
      const center = ctx.canvas.getCenterPoint();
      ctx.canvas.zoomToPoint(center, z);
      ctx.canvas.requestRenderAll();
    },
  },
  {
    id: 'toggle-grid', keys: { key: 'g' },
    category: 'view', description: 'Toggle grid',
    handler: (ctx) => ctx.toggleGrid(),
  },
  // FIX: '?' key — when Shift+/ is pressed, e.key is '?' not '/'
  {
    id: 'show-help', keys: { key: '?' },
    category: 'view', description: 'Show shortcuts help',
    handler: (ctx) => ctx.toggleShowHelp(),
  },
  {
    id: 'show-help-f1', keys: { key: 'f1' },
    category: 'view', description: 'Show shortcuts help',
    handler: (ctx) => ctx.toggleShowHelp(),
  },
];
