/**
 * All shortcut definitions — the single source of truth for keyboard shortcuts.
 * Used by the keyboard handler AND the ShortcutsHelp overlay.
 *
 * Ported to PixiJS: uses SceneManager/SelectionManager instead of Fabric.js Canvas.
 *
 * BUGS FIXED in previous revision (preserved):
 * - Ctrl+Y conflict (was both redo AND overlay-compare) → overlay moved to Ctrl+Shift+Y
 * - Ctrl+P (browser print) → changed to Ctrl+Shift+P for arrange optimal
 * - '?' key (Shift+/) → e.key is '?' not '/', fixed matcher key
 * - ArrowUp/Down with selection → layer ordering uses ] / [ again (arrows cycle/nudge)
 * - ArrowLeft/Right bare → only cycle when nothing selected, otherwise no-op
 * - Added Ctrl+S (prevent browser save-as)
 */

import { ShortcutDef } from './shortcuts';
import * as ops from './operations';

export const shortcuts: ShortcutDef[] = [

  // ═══════════════════════════════════════
  //  ALIGNMENT  (Ctrl + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'align-left', keys: { key: 'arrowleft', ctrl: true },
    category: 'alignment', description: 'Align left', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.alignLeft(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'align-right', keys: { key: 'arrowright', ctrl: true },
    category: 'alignment', description: 'Align right', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.alignRight(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'align-top', keys: { key: 'arrowup', ctrl: true },
    category: 'alignment', description: 'Align top', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.alignTop(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'align-bottom', keys: { key: 'arrowdown', ctrl: true },
    category: 'alignment', description: 'Align bottom', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.alignBottom(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },

  // ═══════════════════════════════════════
  //  DISTRIBUTE  (Ctrl + Alt + Shift + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'distribute-h', keys: { key: 'arrowup', ctrl: true, alt: true, shift: true },
    category: 'alignment', description: 'Distribute horizontal', needsSelection: true, minSelection: 3,
    handler: (ctx) => {
      ops.distributeHorizontal(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'distribute-v', keys: { key: 'arrowdown', ctrl: true, alt: true, shift: true },
    category: 'alignment', description: 'Distribute vertical', needsSelection: true, minSelection: 3,
    handler: (ctx) => {
      ops.distributeVertical(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },

  // ═══════════════════════════════════════
  //  NORMALIZE  (Ctrl + Alt + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'normalize-size', keys: { key: 'arrowup', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize size (same area)', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.normalizeSize(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'normalize-scale', keys: { key: 'arrowdown', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize scale', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.normalizeScale(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'normalize-height', keys: { key: 'arrowleft', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize height', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.normalizeHeight(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'normalize-width', keys: { key: 'arrowright', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize width', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.normalizeWidth(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },

  // ═══════════════════════════════════════
  //  ARRANGEMENT
  // ═══════════════════════════════════════

  {
    id: 'arrange-optimal', keys: { key: 'p', ctrl: true, shift: true },
    category: 'arrangement', description: 'Arrange optimal (pack)', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.arrangeOptimal(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'arrange-by-name', keys: { key: 'n', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange by name', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.arrangeByName(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'arrange-by-order', keys: { key: 'o', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange by z-order', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.arrangeByZOrder(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'arrange-random', keys: { key: 'r', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange randomly', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.arrangeRandomly(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'stack', keys: { key: 's', ctrl: true, alt: true },
    category: 'arrangement', description: 'Stack (pile on top)', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.stackObjects(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },

  // ═══════════════════════════════════════
  //  IMAGE MANIPULATION
  // ═══════════════════════════════════════

  {
    id: 'flip-h', keys: { key: 'h', alt: true, shift: true },
    category: 'image', description: 'Flip horizontal', needsSelection: true,
    handler: (ctx) => {
      ops.flipHorizontal(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'flip-v', keys: { key: 'v', alt: true, shift: true },
    category: 'image', description: 'Flip vertical', needsSelection: true,
    handler: (ctx) => {
      ops.flipVertical(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'reset-transform', keys: { key: 't', ctrl: true, shift: true },
    category: 'image', description: 'Reset transform', needsSelection: true,
    handler: (ctx) => {
      ops.resetTransform(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'toggle-grayscale', keys: { key: 'g', alt: true },
    category: 'image', description: 'Toggle grayscale', needsSelection: true,
    handler: (ctx) => {
      ops.toggleGrayscale(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },
  {
    id: 'toggle-locked', keys: { key: 'l', alt: true },
    category: 'image', description: 'Toggle locked', needsSelection: true,
    handler: (ctx) => {
      ops.toggleLocked(ctx.selection.getSelectedItems());
      ctx.refreshLayers();
    },
  },
  {
    id: 'overlay-compare', keys: { key: 'y', ctrl: true, shift: true },
    category: 'image', description: 'Overlay / compare', needsSelection: true, minSelection: 2,
    handler: (ctx) => {
      ops.overlayCompare(ctx.selection.getSelectedItems());
      ctx.onChange();
    },
  },

  // ═══════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════

  {
    id: 'clear-selection', keys: { key: 'escape' },
    category: 'navigation', description: 'Clear selection',
    handler: (ctx) => {
      ctx.selection.clear();
    },
  },
  {
    id: 'focus-all', keys: { key: '0', ctrl: true },
    category: 'navigation', description: 'Fit all in view',
    handler: (ctx) => ctx.fitAll(),
  },
  // Bare arrow Left/Right only cycle when nothing is selected.
  // When something IS selected, they're no-ops (prevent accidental cycling).
  // Layer ordering uses ] / [ to avoid arrow conflicts.
  {
    id: 'cycle-next', keys: { key: 'arrowright' },
    category: 'navigation', description: 'Select next object',
    handler: (ctx) => {
      if (ctx.selection.selectedIds.size > 0) return;
      const all = ctx.scene.getAllItems();
      if (all.length === 0) return;
      // Sort by z to get consistent order
      all.sort((a, b) => a.data.z - b.data.z);
      ctx.selection.selectOnly(all[0].id);
    },
  },
  {
    id: 'cycle-prev', keys: { key: 'arrowleft' },
    category: 'navigation', description: 'Select previous object',
    handler: (ctx) => {
      if (ctx.selection.selectedIds.size > 0) return;
      const all = ctx.scene.getAllItems();
      if (all.length === 0) return;
      all.sort((a, b) => a.data.z - b.data.z);
      ctx.selection.selectOnly(all[all.length - 1].id);
    },
  },
  // Layer ordering: ] brings forward, [ sends backward
  {
    id: 'send-to-front', keys: { key: ']' },
    category: 'navigation', description: 'Bring forward',
    needsSelection: true,
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      const all = ctx.scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
      // For each selected item, swap z with the next non-selected item above it
      const selectedIds = new Set(selected.map((s) => s.id));
      for (let i = all.length - 2; i >= 0; i--) {
        if (selectedIds.has(all[i].id) && !selectedIds.has(all[i + 1].id)) {
          const tmp = all[i].data.z;
          all[i].data.z = all[i + 1].data.z;
          all[i + 1].data.z = tmp;
        }
      }
      ctx.scene._applyZOrder();
      ctx.onChange();
    },
  },
  {
    id: 'send-to-back', keys: { key: '[' },
    category: 'navigation', description: 'Send backward',
    needsSelection: true,
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      const all = ctx.scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
      const selectedIds = new Set(selected.map((s) => s.id));
      for (let i = 1; i < all.length; i++) {
        if (selectedIds.has(all[i].id) && !selectedIds.has(all[i - 1].id)) {
          const tmp = all[i].data.z;
          all[i].data.z = all[i - 1].data.z;
          all[i - 1].data.z = tmp;
        }
      }
      ctx.scene._applyZOrder();
      ctx.onChange();
    },
  },

  // ═══════════════════════════════════════
  //  EDITING
  // ═══════════════════════════════════════

  {
    id: 'select-all', keys: { key: 'a', ctrl: true },
    category: 'editing', description: 'Select all',
    handler: (ctx) => {
      ctx.selection.selectAll();
    },
  },
  {
    id: 'copy', keys: { key: 'c', ctrl: true },
    category: 'editing', description: 'Copy',
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      if (selected.length > 0) {
        ctx.clipboardRef.current = [...selected];
        ctx.writeCanvasToClipboard(selected);
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
      const selected = ctx.selection.getSelectedItems();
      ctx.writeCanvasToClipboard(selected.length > 0 ? selected : undefined);
    },
  },
  {
    id: 'paste', keys: { key: 'v', ctrl: true },
    category: 'editing', description: 'Paste',
    handler: async (ctx) => {
      if (ctx.clipboardRef.current.length === 0) return;
      const newItems: typeof ctx.clipboardRef.current = [];
      for (const original of ctx.clipboardRef.current) {
        // Clone: duplicate the item data with new ID and offset position
        const newData = {
          ...original.data,
          id: crypto.randomUUID(),
          x: original.data.x + 20,
          y: original.data.y + 20,
          z: ctx.scene.nextZ(),
        };
        await ctx.scene._createItem(newData, true);
        const newItem = ctx.scene.getById(newData.id);
        if (newItem) newItems.push(newItem);
      }
      ctx.clipboardRef.current = newItems;
      ctx.scene._applyZOrder();
      ctx.onChange();
    },
  },
  {
    id: 'cut', keys: { key: 'x', ctrl: true },
    category: 'editing', description: 'Cut',
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      if (selected.length === 0) return;
      ctx.clipboardRef.current = [...selected];
      ctx.writeCanvasToClipboard(selected);
      for (const item of selected) {
        ctx.scene.removeItem(item.id, true);
      }
      ctx.selection.clear();
      ctx.onChange();
      ctx.showToast('Cut');
    },
  },
  {
    id: 'duplicate', keys: { key: 'd', ctrl: true },
    category: 'editing', description: 'Duplicate',
    handler: async (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      if (selected.length === 0) return;
      for (const original of selected) {
        const newData = {
          ...original.data,
          id: crypto.randomUUID(),
          x: original.data.x + 20,
          y: original.data.y + 20,
          z: ctx.scene.nextZ(),
        };
        await ctx.scene._createItem(newData, true);
      }
      ctx.selection.clear();
      ctx.scene._applyZOrder();
      ctx.onChange();
    },
  },
  {
    id: 'delete', keys: { key: 'delete' },
    category: 'editing', description: 'Delete selected',
    needsSelection: true,
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      for (const item of selected) {
        ctx.scene.removeItem(item.id, true);
      }
      ctx.selection.clear();
      ctx.onChange();
    },
  },
  {
    id: 'delete-backspace', keys: { key: 'backspace' },
    category: 'editing', description: 'Delete selected',
    needsSelection: true,
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      for (const item of selected) {
        ctx.scene.removeItem(item.id, true);
      }
      ctx.selection.clear();
      ctx.onChange();
    },
  },
  {
    id: 'undo', keys: { key: 'z', ctrl: true },
    category: 'editing', description: 'Undo',
    handler: (ctx) => {
      ctx.history.undo();
      ctx.setCanUndo(ctx.history.canUndo());
      ctx.setCanRedo(ctx.history.canRedo());
      ctx.onChange();
    },
  },
  {
    id: 'redo', keys: { key: 'z', ctrl: true, shift: true },
    category: 'editing', description: 'Redo',
    handler: (ctx) => {
      ctx.history.redo();
      ctx.setCanUndo(ctx.history.canUndo());
      ctx.setCanRedo(ctx.history.canRedo());
      ctx.onChange();
    },
  },
  {
    id: 'redo-y', keys: { key: 'y', ctrl: true },
    category: 'editing', description: 'Redo (alt)',
    handler: (ctx) => {
      ctx.history.redo();
      ctx.setCanUndo(ctx.history.canUndo());
      ctx.setCanRedo(ctx.history.canRedo());
      ctx.onChange();
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
  // Block Ctrl+S from opening browser save-as dialog
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
      const current = ctx.viewport.scale.x;
      const z = Math.min(current * 1.2, 5);
      ctx.viewport.setZoom(z, true);
    },
  },
  {
    id: 'zoom-in-plus', keys: { key: '+', ctrl: true },
    category: 'view', description: 'Zoom in',
    handler: (ctx) => {
      const current = ctx.viewport.scale.x;
      const z = Math.min(current * 1.2, 5);
      ctx.viewport.setZoom(z, true);
    },
  },
  {
    id: 'zoom-out', keys: { key: '-', ctrl: true },
    category: 'view', description: 'Zoom out',
    handler: (ctx) => {
      const current = ctx.viewport.scale.x;
      const z = Math.max(current / 1.2, 0.1);
      ctx.viewport.setZoom(z, true);
    },
  },
  {
    id: 'toggle-grid', keys: { key: 'g' },
    category: 'view', description: 'Toggle grid',
    handler: (ctx) => ctx.toggleGrid(),
  },
  // '?' key — when Shift+/ is pressed, e.key is '?' not '/'
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
