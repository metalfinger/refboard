/**
 * TextEditor — inline text editing overlay for PixiJS Text objects.
 *
 * Shows an absolutely-positioned <textarea> over the text item,
 * matching its font, size (scaled by zoom), and color.
 * Commits on blur/Enter, cancels on Escape.
 */

import { Text } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { SceneItem } from './SceneManager';
import type { TextObject } from './scene-format';

export class TextEditor {
  private _textarea: HTMLTextAreaElement | null = null;
  private _item: SceneItem | null = null;
  private _viewport: Viewport | null = null;
  private _container: HTMLElement | null = null;
  private _onChange: (() => void) | null = null;
  private _originalText: string = '';

  /** True when a textarea is open. */
  get isEditing(): boolean {
    return this._textarea !== null;
  }

  /** Clear the current textarea content (for new text items). */
  clearText(): void {
    if (this._textarea) {
      this._textarea.value = '';
      this._textarea.dispatchEvent(new Event('input')); // trigger autoSize
    }
  }

  /**
   * Open an inline textarea over the given text item.
   */
  startEditing(
    item: SceneItem,
    viewport: Viewport,
    container: HTMLElement,
    onChange: () => void,
  ): void {
    // Only text items
    if (item.type !== 'text') return;
    const pixiText = item.displayObject;
    if (!(pixiText instanceof Text)) return;

    // Prevent double-open
    if (this._textarea) this.stopEditing(false);

    this._item = item;
    this._viewport = viewport;
    this._container = container;
    this._onChange = onChange;

    const data = item.data as TextObject;
    this._originalText = data.text;

    // Hide the PixiJS text while editing
    pixiText.visible = false;

    // Compute screen position of the text
    const worldPos = pixiText.getGlobalPosition();
    const renderer = viewport.parent?.parent; // stage -> app (not reliable)
    // Use viewport.toScreen to convert world → screen coords
    const screen = viewport.toScreen(item.data.x, item.data.y);
    const zoom = viewport.scale.x;

    // Scaled font size
    const scaledFontSize = data.fontSize * zoom * Math.abs(item.data.sx);

    // Create textarea
    const ta = document.createElement('textarea');
    ta.value = data.text;
    ta.style.position = 'absolute';
    ta.style.left = `${screen.x}px`;
    ta.style.top = `${screen.y}px`;
    ta.style.fontSize = `${scaledFontSize}px`;
    ta.style.fontFamily = data.fontFamily;
    ta.style.color = data.fill;
    ta.style.background = 'transparent';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.resize = 'none';
    ta.style.overflow = 'hidden';
    ta.style.padding = '0';
    ta.style.margin = '0';
    ta.style.lineHeight = '1.2';
    ta.style.whiteSpace = 'pre';
    ta.style.zIndex = '1000';
    ta.style.minWidth = '20px';
    ta.style.minHeight = `${scaledFontSize * 1.3}px`;
    ta.style.transformOrigin = 'top left';
    // Apply rotation if any
    if (item.data.angle) {
      ta.style.transform = `rotate(${item.data.angle}deg)`;
    }

    // Auto-size the textarea to fit content
    const autoSize = () => {
      ta.style.height = 'auto';
      ta.style.width = 'auto';
      // Use a hidden measurement trick: set to scroll dimensions
      ta.style.height = `${ta.scrollHeight}px`;
      ta.style.width = `${Math.max(ta.scrollWidth + 4, 20)}px`;
    };

    // Event handlers
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation(); // Prevent canvas shortcuts
      if (e.key === 'Escape') {
        e.preventDefault();
        this.stopEditing(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.stopEditing(true);
      }
    };

    const onBlur = () => {
      // Small delay to allow Escape to fire first
      setTimeout(() => {
        if (this._textarea === ta) {
          this.stopEditing(true);
        }
      }, 0);
    };

    const onInput = () => {
      autoSize();
    };

    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('blur', onBlur);
    ta.addEventListener('input', onInput);

    container.appendChild(ta);
    this._textarea = ta;

    // Initial size and focus
    autoSize();
    ta.focus();
    ta.select();
  }

  /**
   * Close the textarea. If save=true, commit the text; otherwise restore original.
   */
  stopEditing(save: boolean): void {
    const ta = this._textarea;
    const item = this._item;
    if (!ta || !item) return;

    const pixiText = item.displayObject;
    if (!(pixiText instanceof Text)) return;

    const data = item.data as TextObject;

    if (save) {
      const newText = ta.value; // Allow empty — caller handles cleanup
      data.text = newText;
      pixiText.text = newText;

      // Update dimensions from measured PixiJS text bounds
      pixiText.visible = true;
      const bounds = pixiText.getLocalBounds();
      data.w = bounds.width;
      data.h = bounds.height;

      this._onChange?.();
    } else {
      // Restore original text
      data.text = this._originalText;
      pixiText.text = this._originalText;
      pixiText.visible = true;
    }

    // Remove textarea from DOM
    ta.remove();

    // Reset state
    this._textarea = null;
    this._item = null;
    this._viewport = null;
    this._container = null;
    this._onChange = null;
    this._originalText = '';
  }
}
