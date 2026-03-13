/**
 * MarkdownOverlay — manages DOM div elements positioned over the PixiJS canvas
 * for each visible markdown card.
 *
 * Creates a container div for each markdown item, positioned via viewport.toScreen().
 * React components (MarkdownReadView / MarkdownEditView) render inside these containers.
 * Handles culling (off-screen cards removed), zoom scaling, and position sync for
 * drag/resize/remote transforms.
 */

import type { Viewport } from 'pixi-viewport';
import type { SceneManager, SceneItem } from './SceneManager';
import type { MarkdownObject } from './scene-format';
import { MarkdownSprite } from './sprites/MarkdownSprite';
import { extractTitle, MD_MAX_CONTENT_LENGTH } from './markdownDefaults';

interface CardEntry {
  /** The root DOM div for this card, positioned absolutely over the canvas. */
  el: HTMLDivElement;
  /** The content mount point inside el where React renders read/edit views. */
  contentMount: HTMLDivElement;
  /** Current item ID. */
  id: string;
}

export class MarkdownOverlay {
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _container: HTMLElement;
  private _cards: Map<string, CardEntry> = new Map();
  private _editingId: string | null = null;

  /** Callback when a card's height changes (from DOM measurement). */
  onHeightChange: ((id: string, newHeight: number) => void) | null = null;

  /** Callback to enter edit mode for a card (wired by Editor.tsx). */
  onRequestEdit: ((id: string) => void) | null = null;

  /** Callback when checkbox is toggled in read mode. */
  onCheckboxToggle: ((id: string, newContent: string) => void) | null = null;

  /** Callback when visible card set changes (cards added/removed). Used by React to sync portals. */
  onChange: (() => void) | null = null;

  constructor(viewport: Viewport, scene: SceneManager, container: HTMLElement) {
    this._viewport = viewport;
    this._scene = scene;
    this._container = container;

    this._onViewportMoved = this._onViewportMoved.bind(this);
    viewport.on('moved', this._onViewportMoved);
    viewport.on('zoomed', this._onViewportMoved);
  }

  /** Get the DOM mount point for a card (used by React to portal into). */
  getMountPoint(id: string): HTMLDivElement | null {
    return this._cards.get(id)?.contentMount ?? null;
  }

  /** Set which card is in edit mode (null = none). */
  setEditing(id: string | null): void {
    this._editingId = id;
    // Update pointer-events: edit card gets auto, others get none
    for (const [cardId, entry] of this._cards) {
      entry.el.style.pointerEvents = cardId === id ? 'auto' : 'none';
    }
  }

  get editingId(): string | null {
    return this._editingId;
  }

  /** Full refresh — recreate all visible cards. Called on scene load, undo/redo. */
  refreshAll(): void {
    const items = this._scene.items;
    const visibleIds = new Set<string>();

    for (const [id, item] of items) {
      if (item.type !== 'markdown') continue;
      if (!item.data.visible) continue;

      // Culling: skip items outside viewport bounds
      if (!this._isVisible(item)) continue;

      visibleIds.add(id);

      if (!this._cards.has(id)) {
        this._createCard(item);
      }
      this._positionCard(id);
    }

    // Remove cards that are no longer visible
    for (const [id] of this._cards) {
      if (!visibleIds.has(id)) {
        this._removeCard(id);
      }
    }
  }

  /** Update a single card's position (for drag, resize, remote transform). */
  updateItem(id: string): void {
    const item = this._scene.getById(id);
    if (!item || item.type !== 'markdown') return;

    if (!this._isVisible(item)) {
      this._removeCard(id);
      return;
    }

    if (!this._cards.has(id)) {
      this._createCard(item);
    }
    this._positionCard(id);
  }

  /** Remove a card's overlay (item deleted). */
  removeItem(id: string): void {
    this._removeCard(id);
  }

  /** Measure a card's DOM height and update data.h + sprite. */
  measureHeight(id: string): void {
    const entry = this._cards.get(id);
    const item = this._scene.getById(id);
    if (!entry || !item || item.type !== 'markdown') return;

    requestAnimationFrame(() => {
      // offsetHeight is the CSS layout height at unscaled width — already in world space
      const h = entry.el.offsetHeight;
      if (Math.abs(h - item.data.h) > 1) {
        item.data.h = h;
        // Redraw MarkdownSprite background
        if (item.displayObject instanceof MarkdownSprite) {
          item.displayObject.updateFromData(item.data as MarkdownObject);
        }
        this.onHeightChange?.(id, h);
      }
    });
  }

  destroy(): void {
    this._viewport.off('moved', this._onViewportMoved);
    this._viewport.off('zoomed', this._onViewportMoved);
    for (const [id] of this._cards) {
      this._removeCard(id);
    }
  }

  // -- Private --

  private _onViewportMoved(): void {
    this.refreshAll();
  }

  private _isVisible(item: SceneItem): boolean {
    // pixi-viewport exposes bounds via .left/.right/.top/.bottom
    const vp = this._viewport;
    const d = item.data;
    return !(d.x + d.w < vp.left || d.x > vp.right || d.y + d.h < vp.top || d.y > vp.bottom);
  }

  private _createCard(item: SceneItem): void {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.pointerEvents = item.id === this._editingId ? 'auto' : 'none';
    el.style.transformOrigin = 'top left';
    el.style.overflow = 'hidden';
    el.dataset.markdownId = item.id;

    const contentMount = document.createElement('div');
    el.appendChild(contentMount);

    this._container.appendChild(el);
    this._cards.set(item.id, { el, contentMount, id: item.id });
    this.onChange?.();
  }

  private _positionCard(id: string): void {
    const entry = this._cards.get(id);
    const item = this._scene.getById(id);
    if (!entry || !item) return;

    const data = item.data as MarkdownObject;
    const zoom = this._viewport.scale.x;
    const screen = this._viewport.toScreen(data.x, data.y);

    entry.el.style.left = `${screen.x}px`;
    entry.el.style.top = `${screen.y}px`;
    entry.el.style.width = `${data.w}px`;
    entry.el.style.transform = `scale(${zoom})`;
  }

  private _removeCard(id: string): void {
    const entry = this._cards.get(id);
    if (!entry) return;
    entry.el.remove();
    this._cards.delete(id);
    this.onChange?.();
  }
}
