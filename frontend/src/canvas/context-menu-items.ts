/**
 * Context menu builder — assembles menu items from scene/selection state.
 */

import type { SceneManager, SceneItem } from './SceneManager';
import type { SelectionManager } from './SelectionManager';
import { getItemWorldBounds } from './SceneManager';
import type { Viewport } from 'pixi-viewport';
import type { GroupObject } from './scene-format';
import { FrameSprite } from './sprites/FrameSprite';
import * as ops from './operations';
import { onArrangeAnimationDone } from './operations';

export interface MenuItem {
  label: string;
  shortcut: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
}

export type StartCropFn = (() => void) | null;

interface MenuContext {
  scene: SceneManager | null;
  selection: SelectionManager | null;
  viewport: Viewport | null;
  clipboardRef: React.MutableRefObject<SceneItem[]>;
  writeCanvasToClipboard: (items?: SceneItem[]) => Promise<void>;
  onChange: (changedIds?: string[]) => void;
  refreshLayers: () => void;
  handleGroup: () => void;
  handleUngroup: () => void;
  fitAll: () => void;
  startCrop?: () => void;
}

export function buildContextMenuItems(ctx: MenuContext): MenuItem[] {
  const { scene, selection, viewport } = ctx;
  const selected = selection ? selection.getSelectedItems() : [];
  const hasSel = selected.length > 0;
  const multiSel = selected.length >= 2;
  const ids = selected.map((s) => s.id);

  return [
    // -- Clipboard --
    { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => {
      if (hasSel) { ctx.clipboardRef.current = [...selected]; ctx.writeCanvasToClipboard(selected); }
      else ctx.writeCanvasToClipboard();
    } },
    { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => {
      if (!scene || !hasSel || !selection) return;
      ctx.clipboardRef.current = [...selected];
      for (const item of selected) scene.removeItem(item.id, true);
      selection.clear();
      ctx.onChange();
    }, disabled: !hasSel },
    { label: 'Paste', shortcut: 'Ctrl+V', onClick: async () => {
      if (!scene || ctx.clipboardRef.current.length === 0) return;
      const cloned = _cloneWithGroupSupport(ctx.clipboardRef.current, scene);
      const sorted = [...cloned].sort((a, b) =>
        (a.type === 'group' ? 1 : 0) - (b.type === 'group' ? 1 : 0));
      for (const newData of sorted) {
        await scene._createItem(newData, true);
      }
      scene._applyZOrder();
      ctx.onChange();
    }, disabled: ctx.clipboardRef.current.length === 0 },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: async () => {
      if (!scene || !hasSel) return;
      const allItems = _collectGroupChildren(selected, scene);
      const cloned = _cloneWithGroupSupport(allItems, scene);
      const sorted = [...cloned].sort((a, b) =>
        (a.type === 'group' ? 1 : 0) - (b.type === 'group' ? 1 : 0));
      for (const newData of sorted) {
        await scene._createItem(newData, true);
      }
      if (selection) selection.clear();
      scene._applyZOrder();
      ctx.onChange();
    }, disabled: !hasSel },
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- Alignment --
    { label: 'Align Left', shortcut: 'Ctrl+\u2190', onClick: () => { ops.alignLeft(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Align Right', shortcut: 'Ctrl+\u2192', onClick: () => { ops.alignRight(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Align Top', shortcut: 'Ctrl+\u2191', onClick: () => { ops.alignTop(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Align Bottom', shortcut: 'Ctrl+\u2193', onClick: () => { ops.alignBottom(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Distribute H', shortcut: '', onClick: () => { ops.distributeHorizontal(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Distribute V', shortcut: '', onClick: () => { ops.distributeVertical(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
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
      ctx.onChange();
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
      ctx.onChange();
    }, disabled: !hasSel },
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- Group --
    { label: 'Group', shortcut: 'Ctrl+G', onClick: ctx.handleGroup, disabled: !multiSel },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: ctx.handleUngroup,
      disabled: selected.length !== 1 || selected[0]?.data.type !== 'group' },
    // Frame color (for selected group/frame)
    ...(selected.length === 1 && selected[0]?.data.type === 'group' ? [
      { label: 'Frame: Blue', shortcut: '', onClick: () => _setFrameColor(selected[0], '#4a90d9', ctx) },
      { label: 'Frame: Green', shortcut: '', onClick: () => _setFrameColor(selected[0], '#69db7c', ctx) },
      { label: 'Frame: Red', shortcut: '', onClick: () => _setFrameColor(selected[0], '#ff6b6b', ctx) },
      { label: 'Frame: Purple', shortcut: '', onClick: () => _setFrameColor(selected[0], '#7950f2', ctx) },
      { label: 'Frame: Cyan', shortcut: '', onClick: () => _setFrameColor(selected[0], '#38d9a9', ctx) },
      { label: 'Frame: Orange', shortcut: '', onClick: () => _setFrameColor(selected[0], '#ffa94d', ctx) },
      { label: 'Frame: None', shortcut: '', onClick: () => _setFrameColor(selected[0], '', ctx) },
    ] as MenuItem[] : []),
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- Arrangement --
    { label: 'Arrange Pack', shortcut: 'Ctrl+Shift+P', onClick: () => { onArrangeAnimationDone(() => selection?.transformBox.update(selected)); ops.arrangeOptimal(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Arrange Grid', shortcut: '', onClick: () => { onArrangeAnimationDone(() => selection?.transformBox.update(selected)); ops.arrangeGrid(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Arrange Row', shortcut: '', onClick: () => { onArrangeAnimationDone(() => selection?.transformBox.update(selected)); ops.arrangeRow(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Arrange Column', shortcut: '', onClick: () => { onArrangeAnimationDone(() => selection?.transformBox.update(selected)); ops.arrangeColumn(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Stack', shortcut: 'Ctrl+Alt+S', onClick: () => { onArrangeAnimationDone(() => selection?.transformBox.update(selected)); ops.stackObjects(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- Normalize --
    { label: 'Normalize Size', shortcut: '', onClick: () => { ops.normalizeSize(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Normalize Width', shortcut: '', onClick: () => { ops.normalizeWidth(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: 'Normalize Height', shortcut: '', onClick: () => { ops.normalizeHeight(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !multiSel },
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- Image --
    { label: 'Flip Horizontal', shortcut: 'Alt+Shift+H', onClick: () => { ops.flipHorizontal(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !hasSel },
    { label: 'Flip Vertical', shortcut: 'Alt+Shift+V', onClick: () => { ops.flipVertical(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !hasSel },
    { label: 'Crop', shortcut: 'C', onClick: () => ctx.startCrop?.(), disabled: selected.length !== 1 || selected[0]?.data.type !== 'image' },
    { label: 'Reset Transform', shortcut: 'Ctrl+Shift+T', onClick: () => { ops.resetTransform(selected); selection?.transformBox.update(selected); ctx.onChange(ids); }, disabled: !hasSel },
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- View --
    { label: 'Select All', shortcut: 'Ctrl+A', onClick: () => { if (selection) selection.selectAll(); } },
    { label: 'Fit All', shortcut: 'Ctrl+0', onClick: ctx.fitAll },
    { label: 'Fit Selection', shortcut: 'F', onClick: () => {
      if (!selection || !viewport) return;
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
      const pad = 60;
      const cw = maxX - minX + pad * 2;
      const ch = maxY - minY + pad * 2;
      const s = Math.min(viewport.screenWidth / cw, viewport.screenHeight / ch, 5);
      viewport.animate({ position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, scale: s, time: 300, ease: 'easeOutQuad' });
    }, disabled: !hasSel },
    { label: '', shortcut: '', onClick: () => {}, divider: true },

    // -- Delete --
    { label: 'Delete', shortcut: 'Del', onClick: () => {
      if (!scene || !selection) return;
      for (const item of selected) scene.removeItem(item.id, true);
      selection.clear();
      ctx.onChange();
    }, disabled: !hasSel, danger: true },
  ];
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

/** Clone items with new IDs, remapping group children references. */
function _cloneWithGroupSupport(items: SceneItem[], scene: SceneManager): any[] {
  // Expand: include group children that aren't explicitly in the list
  const expanded = _collectGroupChildren(items, scene);

  const idMap = new Map<string, string>();
  for (const item of expanded) {
    idMap.set(item.data.id, crypto.randomUUID());
  }

  const clones: any[] = [];
  for (const item of expanded) {
    const newId = idMap.get(item.data.id)!;
    const newData = {
      ...item.data,
      id: newId,
      x: item.data.x + 20,
      y: item.data.y + 20,
      z: scene.nextZ(),
    };
    if (newData.type === 'group' && Array.isArray(newData.children)) {
      newData.children = newData.children
        .map((cid: string) => idMap.get(cid))
        .filter((c): c is string => !!c);
    }
    clones.push(newData);
  }
  return clones;
}

/** Set the background color of a group/frame. */
function _setFrameColor(item: SceneItem, color: string, ctx: MenuContext): void {
  const gd = item.data as GroupObject;
  gd.bgColor = color;
  if (item.displayObject instanceof FrameSprite) {
    item.displayObject.setBgColor(color);
  }
  ctx.onChange([item.id]);
}
