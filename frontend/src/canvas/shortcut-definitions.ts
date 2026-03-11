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

import { ShortcutDef, ShortcutContext } from './shortcuts';
import type { SceneItem, SceneManager } from './SceneManager';
import type { GroupObject } from './scene-format';
import * as ops from './operations';
import { onArrangeAnimationDone } from './operations';

// Tracks when the last internal copy happened so paste can decide
// whether to use internal clipboard (just copied) vs system clipboard (external app).
let _lastInternalCopyTime = 0;

/** Mark that an internal copy just happened. Called by copy/cut handlers. */
export function markInternalCopy(): void {
  _lastInternalCopyTime = Date.now();
}

/** Collect selected items + their group children (for deep clone). */
function _collectGroupChildren(items: SceneItem[], scene: SceneManager): SceneItem[] {
  const all: SceneItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    all.push(item);
    if (item.data.type === 'group') {
      const gd = item.data as GroupObject;
      for (const cid of gd.children) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        const child = scene.getById(cid);
        if (child) all.push(child);
      }
    }
  }
  return all;
}

/** Deep-clone a list of scene items, remapping group children IDs. */
function _cloneItemsWithOffset(
  items: { data: any }[],
  scene: { nextZ: () => number },
  offsetX = 20,
  offsetY = 20,
): any[] {
  // First pass: build old→new ID mapping for all items
  const idMap = new Map<string, string>();
  for (const item of items) {
    idMap.set(item.data.id, crypto.randomUUID());
  }

  // Second pass: clone data with new IDs and remapped children
  const clones: any[] = [];
  for (const item of items) {
    const newId = idMap.get(item.data.id)!;
    const newData = {
      ...item.data,
      id: newId,
      x: item.data.x + offsetX,
      y: item.data.y + offsetY,
      z: scene.nextZ(),
    };
    // Remap group children references
    if (newData.type === 'group' && Array.isArray(newData.children)) {
      newData.children = newData.children
        .map((cid: string) => idMap.get(cid) ?? cid)
        .filter((cid: string) => idMap.has(cid) || items.some((i) => i.data.id === cid));
    }
    clones.push(newData);
  }
  return clones;
}

/** Paste from internal clipboard — duplicates scene items with offset. */
async function _pasteInternal(ctx: ShortcutContext): Promise<void> {
  const clones = _cloneItemsWithOffset(ctx.clipboardRef.current, ctx.scene);
  const newItems: typeof ctx.clipboardRef.current = [];

  // Create children first, then groups (so children exist when group is created)
  const sorted = [...clones].sort((a, b) =>
    (a.type === 'group' ? 1 : 0) - (b.type === 'group' ? 1 : 0));

  for (const newData of sorted) {
    await ctx.scene._createItem(newData, true);
    const newItem = ctx.scene.getById(newData.id);
    if (newItem) newItems.push(newItem);
  }
  ctx.clipboardRef.current = newItems;
  ctx.scene._applyZOrder();

  // Select the newly pasted items
  ctx.selection.selectedIds.clear();
  for (const item of newItems) {
    ctx.selection.selectedIds.add(item.id);
  }
  ctx.selection.transformBox.update(newItems);

  ctx.onChange();
}

/** Run op on selected items → update transform box → fire onChange with IDs. */
function _opUpdate(ctx: ShortcutContext, op: (items: SceneItem[]) => void): void {
  const items = ctx.selection.getSelectedItems();
  op(items);
  ctx.selection.transformBox.update(items);
  ctx.onChange(items.map(i => i.id));
}

/** Like _opUpdate but defers transformBox update until animation completes */
function _opUpdateAnimated(ctx: ShortcutContext, op: (items: SceneItem[]) => void): void {
  const items = ctx.selection.getSelectedItems();
  onArrangeAnimationDone(() => ctx.selection.transformBox.update(items));
  op(items);
  ctx.onChange(items.map(i => i.id));
}

export const shortcuts: ShortcutDef[] = [

  // ═══════════════════════════════════════
  //  ALIGNMENT  (Ctrl + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'align-left', keys: { key: 'arrowleft', ctrl: true },
    category: 'alignment', description: 'Align left', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.alignLeft),
  },
  {
    id: 'align-right', keys: { key: 'arrowright', ctrl: true },
    category: 'alignment', description: 'Align right', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.alignRight),
  },
  {
    id: 'align-top', keys: { key: 'arrowup', ctrl: true },
    category: 'alignment', description: 'Align top', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.alignTop),
  },
  {
    id: 'align-bottom', keys: { key: 'arrowdown', ctrl: true },
    category: 'alignment', description: 'Align bottom', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.alignBottom),
  },

  // ═══════════════════════════════════════
  //  DISTRIBUTE  (Ctrl + Alt + Shift + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'distribute-h', keys: { key: 'arrowup', ctrl: true, alt: true, shift: true },
    category: 'alignment', description: 'Distribute horizontal', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.distributeHorizontal),
  },
  {
    id: 'distribute-v', keys: { key: 'arrowdown', ctrl: true, alt: true, shift: true },
    category: 'alignment', description: 'Distribute vertical', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.distributeVertical),
  },

  // ═══════════════════════════════════════
  //  NORMALIZE  (Ctrl + Alt + Arrow)
  // ═══════════════════════════════════════

  {
    id: 'normalize-size', keys: { key: 'arrowup', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize size (same area)', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.normalizeSize),
  },
  {
    id: 'normalize-scale', keys: { key: 'arrowdown', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize scale', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.normalizeScale),
  },
  {
    id: 'normalize-height', keys: { key: 'arrowleft', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize height', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.normalizeHeight),
  },
  {
    id: 'normalize-width', keys: { key: 'arrowright', ctrl: true, alt: true },
    category: 'normalize', description: 'Normalize width', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.normalizeWidth),
  },

  // ═══════════════════════════════════════
  //  ARRANGEMENT
  // ═══════════════════════════════════════

  {
    id: 'arrange-optimal', keys: { key: 'p', ctrl: true, shift: true },
    category: 'arrangement', description: 'Arrange optimal (pack)', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.arrangeOptimal),
  },
  {
    id: 'arrange-by-name', keys: { key: 'n', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange by name', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.arrangeByName),
  },
  {
    id: 'arrange-by-order', keys: { key: 'o', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange by z-order', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.arrangeByZOrder),
  },
  {
    id: 'arrange-random', keys: { key: 'r', ctrl: true, alt: true },
    category: 'arrangement', description: 'Arrange randomly', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.arrangeRandomly),
  },
  {
    id: 'stack', keys: { key: 's', ctrl: true, alt: true },
    category: 'arrangement', description: 'Stack (pile on top)', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.stackObjects),
  },

  // ═══════════════════════════════════════
  //  IMAGE MANIPULATION
  // ═══════════════════════════════════════

  {
    id: 'flip-h', keys: { key: 'h', alt: true, shift: true },
    category: 'image', description: 'Flip horizontal', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, ops.flipHorizontal),
  },
  {
    id: 'flip-v', keys: { key: 'v', alt: true, shift: true },
    category: 'image', description: 'Flip vertical', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, ops.flipVertical),
  },
  {
    id: 'reset-transform', keys: { key: 't', ctrl: true, shift: true },
    category: 'image', description: 'Reset transform', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, ops.resetTransform),
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
      ctx.onChange();
      ctx.refreshLayers();
    },
  },
  {
    id: 'overlay-compare', keys: { key: 'y', ctrl: true, shift: true },
    category: 'image', description: 'Overlay / compare', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.overlayCompare),
  },

  // ═══════════════════════════════════════
  //  NUDGE  (Arrow keys with selection)
  // ═══════════════════════════════════════

  // Shift+Arrow = 10px nudge (more specific, checked first)
  {
    id: 'nudge-left-10', keys: { key: 'arrowleft', shift: true },
    category: 'arrangement', description: 'Nudge left 10px', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.nudge(items, -10, 0)),
  },
  {
    id: 'nudge-right-10', keys: { key: 'arrowright', shift: true },
    category: 'arrangement', description: 'Nudge right 10px', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.nudge(items, 10, 0)),
  },
  {
    id: 'nudge-up-10', keys: { key: 'arrowup', shift: true },
    category: 'arrangement', description: 'Nudge up 10px', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.nudge(items, 0, -10)),
  },
  {
    id: 'nudge-down-10', keys: { key: 'arrowdown', shift: true },
    category: 'arrangement', description: 'Nudge down 10px', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.nudge(items, 0, 10)),
  },

  // ═══════════════════════════════════════
  //  SCALE & ROTATE (selection)
  // ═══════════════════════════════════════

  {
    id: 'scale-up', keys: { key: '=', alt: true },
    category: 'image', description: 'Scale up 10%', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.scaleBy(items, 1.1)),
  },
  {
    id: 'scale-down', keys: { key: '-', alt: true },
    category: 'image', description: 'Scale down 10%', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.scaleBy(items, 1 / 1.1)),
  },
  {
    id: 'rotate-cw', keys: { key: 'r' },
    category: 'image', description: 'Rotate 90° clockwise', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.rotate90(items, true)),
  },
  {
    id: 'rotate-ccw', keys: { key: 'r', shift: true },
    category: 'image', description: 'Rotate 90° counter-clockwise', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.rotate90(items, false)),
  },

  // ═══════════════════════════════════════
  //  ALIGN CENTER
  // ═══════════════════════════════════════

  {
    id: 'align-center-h', keys: { key: 'arrowleft', ctrl: true, shift: true },
    category: 'alignment', description: 'Align center horizontal', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.alignCenterH),
  },
  {
    id: 'align-center-v', keys: { key: 'arrowup', ctrl: true, shift: true },
    category: 'alignment', description: 'Align center vertical', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdate(ctx, ops.alignCenterV),
  },

  // ═══════════════════════════════════════
  //  EQUAL SPACING
  // ═══════════════════════════════════════

  {
    id: 'equal-spacing-h', keys: { key: 'h', ctrl: true, shift: true },
    category: 'arrangement', description: 'Equal horizontal spacing', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.equalSpacingH),
  },
  {
    id: 'equal-spacing-v', keys: { key: 'v', ctrl: true, shift: true },
    category: 'arrangement', description: 'Equal vertical spacing', needsSelection: true, minSelection: 2,
    handler: (ctx) => _opUpdateAnimated(ctx, ops.equalSpacingV),
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
  {
    id: 'focus-selection', keys: { key: 'f' },
    category: 'navigation', description: 'Fit selection in view', needsSelection: true,
    handler: (ctx) => ctx.fitSelection(),
  },
  {
    id: 'toggle-focus-mode', keys: { key: 'tab' },
    category: 'view', description: 'Toggle focus mode (hide UI)',
    handler: (ctx) => ctx.toggleFocusMode(),
  },
  // Bare arrows: nudge 1px if selection, cycle if no selection
  {
    id: 'nudge-or-cycle-right', keys: { key: 'arrowright' },
    category: 'navigation', description: 'Nudge 1px / Select next',
    handler: (ctx) => {
      if (ctx.selection.selectedIds.size > 0) {
        _opUpdate(ctx, (items) => ops.nudge(items, 1, 0));
      } else {
        const all = ctx.scene.getAllItems();
        if (all.length === 0) return;
        all.sort((a, b) => a.data.z - b.data.z);
        ctx.selection.selectOnly(all[0].id);
      }
    },
  },
  {
    id: 'nudge-or-cycle-left', keys: { key: 'arrowleft' },
    category: 'navigation', description: 'Nudge 1px / Select prev',
    handler: (ctx) => {
      if (ctx.selection.selectedIds.size > 0) {
        _opUpdate(ctx, (items) => ops.nudge(items, -1, 0));
      } else {
        const all = ctx.scene.getAllItems();
        if (all.length === 0) return;
        all.sort((a, b) => a.data.z - b.data.z);
        ctx.selection.selectOnly(all[all.length - 1].id);
      }
    },
  },
  {
    id: 'nudge-up', keys: { key: 'arrowup' },
    category: 'navigation', description: 'Nudge up 1px', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.nudge(items, 0, -1)),
  },
  {
    id: 'nudge-down', keys: { key: 'arrowdown' },
    category: 'navigation', description: 'Nudge down 1px', needsSelection: true,
    handler: (ctx) => _opUpdate(ctx, (items) => ops.nudge(items, 0, 1)),
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
        // Include group children in clipboard for proper paste
        ctx.clipboardRef.current = _collectGroupChildren(selected, ctx.scene);
        markInternalCopy();
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
      // Strategy: Check system clipboard for images first.
      // - If system clipboard has an image AND we did NOT just do an internal copy
      //   (or it's been a while), paste from system clipboard (external image).
      // - If we just did an internal copy (lastInternalCopyTime is recent),
      //   use internal clipboard to duplicate scene items (preserves vector data).
      // - If system clipboard has no images, fall back to internal clipboard.

      const timeSinceInternalCopy = Date.now() - _lastInternalCopyTime;
      const hasInternalItems = ctx.clipboardRef.current.length > 0;
      const recentInternalCopy = hasInternalItems && timeSinceInternalCopy < 500;

      // If we JUST did an internal copy (<500ms ago), use internal clipboard
      // (the system clipboard image is just the rasterized version of what we copied)
      if (recentInternalCopy) {
        await _pasteInternal(ctx);
        return;
      }

      // Try system clipboard first
      try {
        const result = await ctx.pasteFromSystemClipboard();
        if (result === 'Pasted image') return;
      } catch {
        // Clipboard API denied or unavailable — fall through
      }

      // Fall back to internal clipboard
      if (hasInternalItems) {
        await _pasteInternal(ctx);
      }
    },
  },
  {
    id: 'cut', keys: { key: 'x', ctrl: true },
    category: 'editing', description: 'Cut',
    handler: (ctx) => {
      const selected = ctx.selection.getSelectedItems();
      if (selected.length === 0) return;
      ctx.clipboardRef.current = _collectGroupChildren(selected, ctx.scene);
      markInternalCopy();
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

      // Collect group children and clone with remapped IDs
      const allItems = _collectGroupChildren(selected, ctx.scene);
      const clones = _cloneItemsWithOffset(allItems, ctx.scene);
      const sorted = [...clones].sort((a: any, b: any) =>
        (a.type === 'group' ? 1 : 0) - (b.type === 'group' ? 1 : 0));
      for (const newData of sorted) {
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
  // Opacity: [ and ] with Alt
  {
    id: 'opacity-down', keys: { key: '[', alt: true },
    category: 'image', description: 'Decrease opacity 10%', needsSelection: true,
    handler: (ctx) => {
      const items = ctx.selection.getSelectedItems();
      const current = items[0]?.data.opacity ?? 1;
      ops.setOpacity(items, Math.max(0.1, current - 0.1));
      ctx.onChange();
    },
  },
  {
    id: 'opacity-up', keys: { key: ']', alt: true },
    category: 'image', description: 'Increase opacity 10%', needsSelection: true,
    handler: (ctx) => {
      const items = ctx.selection.getSelectedItems();
      const current = items[0]?.data.opacity ?? 1;
      ops.setOpacity(items, Math.min(1, current + 0.1));
      ctx.onChange();
    },
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
  {
    id: 'toggle-review',
    keys: { key: '.' },
    category: 'view',
    description: 'Toggle review mode',
    needsSelection: false,
    handler: (ctx: ShortcutContext) => {
      ctx.toggleReviewMode?.();
    },
  },
];
