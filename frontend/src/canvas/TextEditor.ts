/**
 * TextEditor — inline text editing overlay for PixiJS Text objects.
 *
 * Shows an absolutely-positioned <textarea> over the text item,
 * matching its font, size (scaled by zoom), and color.
 * Commits on blur/Enter, cancels on Escape.
 */

import type { Viewport } from 'pixi-viewport';
import type { SceneItem } from './SceneManager';
import type { TextObject } from './scene-format';
import type { StickyObject } from './scene-format';
import { StickySprite } from './sprites/StickySprite';
import { TextSprite } from './sprites/TextSprite';

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
   * Open an inline textarea over the given text or sticky item.
   */
  startEditing(
    item: SceneItem,
    viewport: Viewport,
    container: HTMLElement,
    onChange: () => void,
  ): void {
    // Accept text and sticky items
    if (item.type !== 'text' && item.type !== 'sticky') return;

    // Prevent double-open
    if (this._textarea) this.stopEditing(false);

    this._item = item;
    this._viewport = viewport;
    this._container = container;
    this._onChange = onChange;

    const zoom = viewport.scale.x;

    // Type-specific config
    let text = '';
    let fontSize = 14;
    let fontFamily = 'sans-serif';
    let color = '#ffffff';
    let bgColor = 'transparent';
    let padding = 0;
    let screenX = 0;
    let screenY = 0;
    let taWidth = 'auto';

    if (item.type === 'sticky') {
      const data = item.data as StickyObject;
      text = data.text;
      fontSize = data.fontSize || 14;
      fontFamily = data.fontFamily || 'Inter, system-ui, sans-serif';
      color = data.textColor || '#1a1a1a';
      bgColor = data.fill || '#ffd43b';
      padding = (data.padding ?? 16) * zoom * Math.abs(item.data.sx);

      // Position at sticky's world coords
      const screen = viewport.toScreen(item.data.x, item.data.y);
      screenX = screen.x + padding;
      screenY = screen.y + padding;

      // Fixed width matching the sticky content area
      const scaledW = data.w * zoom * Math.abs(item.data.sx);
      taWidth = `${scaledW - padding * 2}px`;

      // Hide the StickySprite text child (keep bg visible)
      if (item.displayObject instanceof StickySprite) {
        item.displayObject.showText(false);
      }
    } else {
      // Original text behavior
      const data = item.data as TextObject;
      text = data.text;
      fontSize = data.fontSize;
      fontFamily = data.fontFamily;
      color = data.fill;
      bgColor = 'transparent';
      padding = 0;

      const screen = viewport.toScreen(item.data.x, item.data.y);
      screenX = screen.x;
      screenY = screen.y;
      taWidth = 'auto';

      // Hide the TextSprite text while editing
      if (item.displayObject instanceof TextSprite) {
        item.displayObject.showText(false);
      }
    }

    this._originalText = text;
    const scaledFontSize = fontSize * zoom * Math.abs(item.data.sx);

    // Create textarea
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'absolute';
    ta.style.left = `${screenX}px`;
    ta.style.top = `${screenY}px`;
    ta.style.fontSize = `${scaledFontSize}px`;
    ta.style.fontFamily = fontFamily;
    ta.style.color = color;
    ta.style.background = bgColor === 'transparent' ? 'transparent' : bgColor;
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.resize = 'none';
    ta.style.overflow = 'hidden';
    ta.style.padding = '0';
    ta.style.margin = '0';
    ta.style.lineHeight = item.type === 'sticky' ? '1.4' : '1.2';
    ta.style.whiteSpace = item.type === 'sticky' ? 'pre-wrap' : 'pre';
    ta.style.zIndex = '1000';
    ta.style.minWidth = '20px';
    ta.style.minHeight = `${scaledFontSize * 1.3}px`;
    ta.style.transformOrigin = 'top left';
    ta.style.boxSizing = 'border-box';

    if (taWidth !== 'auto') {
      ta.style.width = taWidth;
    }

    // Apply rotation
    if (item.data.angle) {
      ta.style.transform = `rotate(${item.data.angle}deg)`;
    }

    // Auto-size
    const autoSize = () => {
      ta.style.height = 'auto';
      if (taWidth === 'auto') {
        ta.style.width = 'auto';
        ta.style.width = `${Math.max(ta.scrollWidth + 4, 20)}px`;
      }
      ta.style.height = `${ta.scrollHeight}px`;
    };

    // Event handlers
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.stopEditing(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.stopEditing(true);
      }
    };

    const onBlur = () => {
      setTimeout(() => {
        if (this._textarea === ta) {
          this.stopEditing(true);
        }
      }, 0);
    };

    const onInput = () => {
      autoSize();
      // Live-update sticky background height as user types.
      // PixiJS Text measures bounds regardless of visibility, so
      // updateFromData works even with the text child hidden.
      if (item.type === 'sticky' && item.displayObject instanceof StickySprite && !item.displayObject.destroyed) {
        const data = item.data as StickyObject;
        data.text = ta.value;
        item.displayObject.updateFromData(data);
        data.h = item.displayObject.computedHeight;
      }
    };

    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('blur', onBlur);
    ta.addEventListener('input', onInput);

    container.appendChild(ta);
    this._textarea = ta;

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

    const onChange = this._onChange;
    const originalText = this._originalText;
    const newText = ta.value;

    // Clear editor state before mutating scene objects or invoking callbacks.
    // This prevents blur/startEditing re-entry from acting on a destroyed item.
    ta.remove();
    this._textarea = null;
    this._item = null;
    this._viewport = null;
    this._container = null;
    this._onChange = null;
    this._originalText = '';

    if (save) {
      if (
        item.type === 'sticky' &&
        item.displayObject instanceof StickySprite &&
        !item.displayObject.destroyed
      ) {
        const data = item.data as StickyObject;
        data.text = newText;
        item.displayObject.updateFromData(data);
        data.h = item.displayObject.computedHeight;
        item.displayObject.showText(true);
        onChange?.();
      } else if (item.type === 'text') {
        if (item.displayObject instanceof TextSprite && !item.displayObject.destroyed) {
          const data = item.data as TextObject;
          data.text = newText;
          item.displayObject.updateFromData(data);
          data.w = item.displayObject.measuredWidth;
          data.h = item.displayObject.measuredHeight;
          item.displayObject.showText(true);
          onChange?.();
        }
      }
    } else {
      // Cancel — restore original
      if (
        item.type === 'sticky' &&
        item.displayObject instanceof StickySprite &&
        !item.displayObject.destroyed
      ) {
        const data = item.data as StickyObject;
        data.text = originalText;
        item.displayObject.updateFromData(data);
        data.h = item.displayObject.computedHeight;
        item.displayObject.showText(true);
      } else if (item.type === 'text') {
        if (item.displayObject instanceof TextSprite && !item.displayObject.destroyed) {
          const data = item.data as TextObject;
          data.text = originalText;
          item.displayObject.updateFromData(data);
          item.displayObject.showText(true);
        }
      }
      // Always notify on cancel too — the tool callback needs this
      // to clean up empty newly-created items (sticky or text).
      onChange?.();
    }
  }
}
