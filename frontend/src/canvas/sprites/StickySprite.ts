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
 *
 * Performance:
 *   - updateFromData() skips work when inputs haven't changed
 *   - _drawBg() is cached and only redraws when dimensions/color change
 *   - showText() never triggers layout or redraw
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

  // Dirty-check cache: last known inputs to avoid redundant work
  private _lastText = '';
  private _lastFontSize = 14;
  private _lastFontFamily = 'Inter, system-ui, sans-serif';
  private _lastTextColor = '#1a1a1a';
  private _lastFill = '#ffd43b';
  private _lastW = 200;
  private _lastPadding = DEFAULT_PADDING;
  private _lastCornerRadius = DEFAULT_CORNER_RADIUS;

  // Background redraw cache: skip Graphics.clear()+redraw when shape is unchanged
  private _bgCacheKey = '';
  private _zoomBucket = 1;

  /** After layout, the computed card height. Parent should sync to data.h. */
  get computedHeight(): number {
    return this._cardH;
  }

  /** Show/hide the text child (used by TextEditor during editing). */
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
    const fontSize = data.fontSize || 14;
    this._style = new TextStyle({
      fontSize,
      fontFamily: data.fontFamily || 'Inter, system-ui, sans-serif',
      fill: data.textColor || '#1a1a1a',
      wordWrap: true,
      wordWrapWidth: Math.max(data.w - this._padding * 2, 1),
      lineHeight: fontSize * DEFAULT_LINE_HEIGHT,
    });

    this._text = new Text({ text: data.text || '', style: this._style });
    this._text.position.set(this._padding, this._padding);
    this.addChild(this._text);

    // Snapshot initial state
    this._lastText = data.text || '';
    this._lastFontSize = fontSize;
    this._lastFontFamily = data.fontFamily || 'Inter, system-ui, sans-serif';
    this._lastTextColor = data.textColor || '#1a1a1a';
    this._lastFill = this._bgColor;
    this._lastW = data.w;
    this._lastPadding = this._padding;
    this._lastCornerRadius = this._cornerRadius;

    this._layout();
  }

  /**
   * Update from StickyObject data. Called by SceneManager._updateItem().
   * Skips text/style/layout work when nothing actually changed.
   */
  updateFromData(data: StickyObject): void {
    const padding = data.padding ?? DEFAULT_PADDING;
    const cornerRadius = data.cornerRadius ?? DEFAULT_CORNER_RADIUS;
    const bgColor = data.fill || '#ffd43b';
    const w = data.w;
    const text = data.text || '';
    const fontSize = data.fontSize || 14;
    const fontFamily = data.fontFamily || 'Inter, system-ui, sans-serif';
    const textColor = data.textColor || '#1a1a1a';

    // Check if anything actually changed
    const textChanged = text !== this._lastText;
    const styleChanged =
      fontSize !== this._lastFontSize ||
      fontFamily !== this._lastFontFamily ||
      textColor !== this._lastTextColor;
    const layoutChanged =
      w !== this._lastW ||
      padding !== this._lastPadding;
    const bgChanged =
      bgColor !== this._lastFill ||
      cornerRadius !== this._lastCornerRadius;

    // Nothing changed — skip all work
    if (!textChanged && !styleChanged && !layoutChanged && !bgChanged) return;

    // Update cached state
    this._padding = padding;
    this._cornerRadius = cornerRadius;
    this._bgColor = bgColor;
    this._cardW = w;
    this._lastText = text;
    this._lastFontSize = fontSize;
    this._lastFontFamily = fontFamily;
    this._lastTextColor = textColor;
    this._lastFill = bgColor;
    this._lastW = w;
    this._lastPadding = padding;
    this._lastCornerRadius = cornerRadius;

    // Only update text if content changed
    if (textChanged) {
      this._text.text = text;
    }

    // Only update style if style/layout props changed
    if (styleChanged || layoutChanged) {
      this._style.fontSize = fontSize;
      this._style.fontFamily = fontFamily;
      this._style.fill = textColor;
      this._style.wordWrapWidth = Math.max(w - padding * 2, 1);
      this._style.lineHeight = fontSize * DEFAULT_LINE_HEIGHT;
      this._text.style = this._style;
      this._text.position.set(padding, padding);
    }

    // Relayout if text, style, or dimensions changed (need remeasure)
    if (textChanged || styleChanged || layoutChanged) {
      this._layout();
    } else if (bgChanged) {
      // Only bg color/radius changed — redraw background without remeasuring text
      this._drawBg();
    }
  }

  /**
   * Recompute layout: measure text height, resize card, redraw background.
   */
  private _layout(): void {
    const textBounds = this._text.getLocalBounds();
    const textH = textBounds.height;

    this._cardH = Math.max(textH + this._padding * 2, MIN_HEIGHT);
    this._drawBg();
  }

  /**
   * Redraw the rounded-rect background. Skips if shape is unchanged
   * (same dimensions, color, radius).
   */
  private _drawBg(): void {
    const cacheKey = `${this._cardW}|${this._cardH}|${this._bgColor}|${this._cornerRadius}`;
    if (cacheKey === this._bgCacheKey) return;
    this._bgCacheKey = cacheKey;

    this._bg.clear();
    const color = parseInt(this._bgColor.replace('#', ''), 16) || 0xffd43b;
    this._bg.roundRect(0, 0, this._cardW, this._cardH, this._cornerRadius);
    this._bg.fill({ color, alpha: 1 });
    this._bg.stroke({ color: 0x000000, alpha: 0.1, width: 1 });
  }
}
