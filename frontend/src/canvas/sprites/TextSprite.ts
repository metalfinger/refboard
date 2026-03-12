/**
 * TextSprite — wraps PixiJS Text with dirty-check caching.
 *
 * Prevents unnecessary PixiJS text invalidation by comparing
 * incoming data against last-applied values. PixiJS Text treats
 * any property assignment as an invalidation trigger, even if
 * the value is identical — so we must guard every mutation.
 *
 * Structure:
 *   Container (this)
 *     └─ _text: Text
 */

import { Container, Text, TextStyle } from 'pixi.js';
import type { TextObject } from '../scene-format';

export class TextSprite extends Container {
  private _text: Text;
  private _style: TextStyle;

  // Dirty-check cache
  private _lastContent = '';
  private _lastFontSize = 24;
  private _lastFontFamily = 'sans-serif';
  private _lastFill = '#ffffff';
  private _zoomBucket = 1;

  /** Measured width after last text change. */
  get measuredWidth(): number {
    return this._text.width;
  }

  /** Measured height after last text change. */
  get measuredHeight(): number {
    return this._text.height;
  }

  /** Show/hide the text (used by TextEditor during editing). */
  showText(visible: boolean): void {
    this._text.visible = visible;
  }

  /**
   * Update text rasterization resolution for zoom-bucket crisp rendering.
   * Only re-rasterizes when the bucket actually changes.
   */
  setZoomBucket(bucket: number): void {
    if (bucket === this._zoomBucket) return;
    this._zoomBucket = bucket;
    this._text.resolution = bucket;
  }

  constructor(data: TextObject) {
    super();

    const fontSize = data.fontSize || 24;
    const fontFamily = data.fontFamily || 'sans-serif';
    const fill = data.fill || '#ffffff';

    this._style = new TextStyle({ fontSize, fontFamily, fill });
    this._text = new Text({ text: data.text || '', style: this._style });
    this.addChild(this._text);

    this._lastContent = data.text || '';
    this._lastFontSize = fontSize;
    this._lastFontFamily = fontFamily;
    this._lastFill = fill;
  }

  /**
   * Update from TextObject data. Only touches PixiJS properties
   * when the corresponding input has actually changed.
   * Returns true if dimensions may have changed (text/style updated).
   */
  updateFromData(data: TextObject): boolean {
    const content = data.text ?? '';
    const fontSize = data.fontSize || 24;
    const fontFamily = data.fontFamily || 'sans-serif';
    const fill = data.fill || '#ffffff';

    const contentChanged = content !== this._lastContent;
    const styleChanged =
      fontSize !== this._lastFontSize ||
      fontFamily !== this._lastFontFamily ||
      fill !== this._lastFill;

    if (!contentChanged && !styleChanged) return false;

    // Update cache
    this._lastContent = content;
    this._lastFontSize = fontSize;
    this._lastFontFamily = fontFamily;
    this._lastFill = fill;

    if (contentChanged) {
      this._text.text = content;
    }

    if (styleChanged) {
      this._style.fontSize = fontSize;
      this._style.fontFamily = fontFamily;
      this._style.fill = fill;
      // Do NOT reassign this._text.style = this._style — it's already the live
      // reference, and reassigning triggers a redundant PixiJS invalidation.
      // Mutating style properties is sufficient.
    }

    return true;
  }
}
