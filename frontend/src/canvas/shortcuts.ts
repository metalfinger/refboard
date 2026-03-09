/**
 * Shortcut registry — defines the type system, matcher, and formatter.
 * Actual shortcut definitions live in shortcut-definitions.ts.
 */

import { Canvas, FabricObject } from 'fabric';
import { ToolType } from './tools';

export interface ShortcutKeys {
  key: string;       // e.key.toLowerCase(), e.g. 'arrowleft', 'p', 'escape', ' '
  ctrl?: boolean;    // ctrl or meta (cmd on mac)
  alt?: boolean;
  shift?: boolean;
}

export interface ShortcutDef {
  id: string;
  keys: ShortcutKeys;
  handler: (ctx: ShortcutContext) => void | Promise<void>;
  description: string;
  category: 'alignment' | 'arrangement' | 'normalize' | 'navigation' | 'editing' | 'view' | 'tools' | 'image';
  needsSelection?: boolean;   // skip if no objects selected
  minSelection?: number;      // minimum selected objects (default 1 if needsSelection)
}

export interface ShortcutContext {
  canvas: Canvas;
  getActiveObjects: () => FabricObject[];
  getActiveObject: () => FabricObject | null;
  clipboardRef: React.MutableRefObject<FabricObject[]>;
  cloneFabricObject: (obj: any, dx: number, dy: number) => Promise<any>;
  writeCanvasToClipboard: (objects?: FabricObject[]) => Promise<void>;
  onCanvasChange: () => void;
  showToast: (msg: string) => void;
  fitAll: () => void;
  setActiveTool: (tool: ToolType) => void;
  undoRef: React.MutableRefObject<any>;
  setCanUndo: (v: boolean) => void;
  setCanRedo: (v: boolean) => void;
  refreshLayers: () => void;
  handleGroup: () => void;
  handleUngroup: () => void;
  toggleGrid: () => void;
  toggleShowHelp: () => void;
}

/**
 * Match a keyboard event against a shortcut definition.
 * More-specific shortcuts (more modifiers) should be checked first.
 */
export function matchesShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  const k = def.keys;
  const wantCtrl = k.ctrl ?? false;
  const wantAlt = k.alt ?? false;
  const wantShift = k.shift ?? false;

  return (
    e.key.toLowerCase() === k.key.toLowerCase() &&
    (e.ctrlKey || e.metaKey) === wantCtrl &&
    e.altKey === wantAlt &&
    e.shiftKey === wantShift
  );
}

/**
 * Sort shortcuts so the most-specific (most modifiers) are checked first.
 * This prevents Ctrl+Alt+Shift+X from being matched by Ctrl+X.
 */
export function sortBySpecificity(defs: ShortcutDef[]): ShortcutDef[] {
  return [...defs].sort((a, b) => {
    const modCount = (k: ShortcutKeys) =>
      (k.ctrl ? 1 : 0) + (k.alt ? 1 : 0) + (k.shift ? 1 : 0);
    return modCount(b.keys) - modCount(a.keys);
  });
}

/**
 * Format a shortcut for display in the help overlay.
 */
export function formatShortcut(def: ShortcutDef): string {
  const parts: string[] = [];
  if (def.keys.ctrl) parts.push('Ctrl');
  if (def.keys.alt) parts.push('Alt');
  if (def.keys.shift) parts.push('Shift');
  const keyNames: Record<string, string> = {
    arrowleft: '\u2190', arrowright: '\u2192', arrowup: '\u2191', arrowdown: '\u2193',
    escape: 'Esc', ' ': 'Space', delete: 'Del', backspace: 'Bksp',
    '=': '+', '-': '\u2212',
  };
  const display = keyNames[def.keys.key.toLowerCase()] || def.keys.key.toUpperCase();
  parts.push(display);
  return parts.join(' + ');
}
