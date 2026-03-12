/**
 * StickySprite — renders a sticky note card.
 *
 * Structure:
 *   Container (this)
 *     └─ _bg: Graphics (rounded rect background)
 *     └─ _text: Text (word-wrapped content)
 *
 * Dimensions:
 *   - width is fixed (from data.w)
 *   - height auto-grows to fit wrapped text + padding
 *   - parent SceneItem.data.h is updated after layout
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { StickyObject } from '../scene-format';

const DEFAULT_PADDING = 16;
const DEFAULT_CORNER_RADIUS = 8;
const DEFAULT_LINE_HEIGHT = 1.4;
const MIN_HEIGHT = 60;

export class StickySprite extends Container {
  private _bg: Graphics;
  private _text: Text;
  private _style: TextStyle;

  // Cached layout state
  private _cardW = 200;
  private _cardH = MIN_HEIGHT;
  private _padding = DEFAULT_PADDING;
  private _cornerRadius = DEFAULT_CORNER_RADIUS;
  private _bgColor = '#ffd43b';

  /** After layout, the computed card height. Parent should sync to data.h. */
  get computedHeight(): number {
    return this._cardH;
  }

  /** Show/hide the text child (used by TextEditor during editing). */
  showText(visible: boolean): void {
    this._text.visible = visible;
  }

  constructor(data: StickyObject) {
    super();

    this._padding = data.padding ?? DEFAULT_PADDING;
    this._cornerRadius = data.cornerRadius ?? DEFAULT_CORNER_RADIUS;
    this._bgColor = data.fill || '#ffd43b';
    this._cardW = data.w;

    // Background
    this._bg = new Graphics();
    this.addChild(this._bg);

    // Text style
    this._style = new TextStyle({
      fontSize: data.fontSize || 14,
      fontFamily: data.fontFamily || 'Inter, system-ui, sans-serif',
      fill: data.textColor || '#1a1a1a',
      wordWrap: true,
      wordWrapWidth: Math.max(data.w - this._padding * 2, 1),
      lineHeight: (data.fontSize || 14) * DEFAULT_LINE_HEIGHT,
    });

    this._text = new Text({ text: data.text || '', style: this._style });
    this._text.position.set(this._padding, this._padding);
    this.addChild(this._text);

    this._layout();
  }

  /**
   * Update from StickyObject data. Called by SceneManager._updateItem().
   */
  updateFromData(data: StickyObject): void {
    this._padding = data.padding ?? DEFAULT_PADDING;
    this._cornerRadius = data.cornerRadius ?? DEFAULT_CORNER_RADIUS;
    this._bgColor = data.fill || '#ffd43b';
    this._cardW = data.w;

    // Update text content and style
    this._text.text = data.text || '';
    this._style.fontSize = data.fontSize || 14;
    this._style.fontFamily = data.fontFamily || 'Inter, system-ui, sans-serif';
    this._style.fill = data.textColor || '#1a1a1a';
    this._style.wordWrapWidth = Math.max(data.w - this._padding * 2, 1);
    this._style.lineHeight = (data.fontSize || 14) * DEFAULT_LINE_HEIGHT;
    this._text.style = this._style;

    this._text.position.set(this._padding, this._padding);
    this._layout();
  }

  /**
   * Recompute layout: measure text height, resize card, redraw background.
   * Returns the new card height so the caller can sync data.h.
   */
  private _layout(): void {
    // Measure the PixiJS text after style update
    const textBounds = this._text.getLocalBounds();
    const textH = textBounds.height;

    // Card height: text + top/bottom padding, minimum height
    this._cardH = Math.max(textH + this._padding * 2, MIN_HEIGHT);

    // Redraw background
    this._bg.clear();
    const color = parseInt(this._bgColor.replace('#', ''), 16) || 0xffd43b;
    this._bg.roundRect(0, 0, this._cardW, this._cardH, this._cornerRadius);
    this._bg.fill({ color, alpha: 1 });
    this._bg.stroke({ color: 0x000000, alpha: 0.1, width: 1 });
  }
}
