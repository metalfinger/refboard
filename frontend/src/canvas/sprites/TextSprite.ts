/**
 * TextSprite — free-flowing text display object.
 *
 * Composes TextCore for dirty-checked text rendering.
 * No word-wrap — text flows freely, measured width/height
 * reflect actual rendered bounds.
 *
 * Structure:
 *   Container (this)
 *     └─ TextCore.pixiText
 */

import { Container } from 'pixi.js';
import type { TextObject } from '../scene-format';
import { TextCore } from './TextCore';

export class TextSprite extends Container {
  private _core: TextCore;

  /** Measured width after last text change. */
  get measuredWidth(): number {
    return this._core.measuredWidth;
  }

  /** Measured height after last text change. */
  get measuredHeight(): number {
    return this._core.measuredHeight;
  }

  /** Show/hide the text (used by TextEditor during editing). */
  showText(visible: boolean): void {
    this._core.setVisible(visible);
  }

  /**
   * Update text rasterization resolution for zoom-bucket crisp rendering.
   * Only re-rasterizes when the bucket actually changes.
   */
  setZoomBucket(bucket: number): void {
    this._core.setZoomBucket(bucket);
  }

  constructor(data: TextObject) {
    super();

    this._core = new TextCore({
      text: data.text || '',
      fontSize: data.fontSize || 24,
      fontFamily: data.fontFamily || 'sans-serif',
      fill: data.fill || '#ffffff',
    });
    this.addChild(this._core.pixiText);
  }

  /**
   * Update from TextObject data. Only touches PixiJS properties
   * when the corresponding input has actually changed.
   * Returns true if dimensions may have changed (text/style updated).
   */
  updateFromData(data: TextObject): boolean {
    return this._core.update({
      text: data.text ?? '',
      fontSize: data.fontSize || 24,
      fontFamily: data.fontFamily || 'sans-serif',
      fill: data.fill || '#ffffff',
    });
  }
}
