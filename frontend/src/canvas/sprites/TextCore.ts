/**
 * TextCore — shared text rendering engine with dirty-check caching.
 *
 * Owns a PixiJS Text instance and guards every property mutation
 * against redundant invalidation. Used by both TextSprite and
 * StickySprite so text rendering logic lives in one place.
 *
 * PixiJS Text treats any property assignment as an invalidation
 * trigger (re-rasterizes the text texture), even if the value is
 * identical — so we must guard every mutation ourselves.
 */

import { Text, TextStyle } from 'pixi.js';

export interface TextCoreOptions {
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  /** Enable word-wrap at this width. Omit or 0 for no wrap. */
  wordWrapWidth?: number;
  /** Line height multiplier (default 1). Only used when wordWrap is enabled. */
  lineHeightMultiplier?: number;
}

export class TextCore {
  readonly pixiText: Text;
  readonly style: TextStyle;

  // Dirty-check cache
  private _lastContent: string;
  private _lastFontSize: number;
  private _lastFontFamily: string;
  private _lastFill: string;
  private _lastWordWrapWidth: number;
  private _lastLineHeightMultiplier: number;
  private _zoomBucket = 1;

  get measuredWidth(): number {
    return this.pixiText.width;
  }

  get measuredHeight(): number {
    return this.pixiText.height;
  }

  constructor(opts: TextCoreOptions) {
    const { text, fontSize, fontFamily, fill } = opts;
    const wordWrapWidth = opts.wordWrapWidth || 0;
    const lineHeightMultiplier = opts.lineHeightMultiplier || 1;

    const styleOpts: ConstructorParameters<typeof TextStyle>[0] = {
      fontSize,
      fontFamily,
      fill,
    };
    if (wordWrapWidth > 0) {
      styleOpts.wordWrap = true;
      styleOpts.wordWrapWidth = wordWrapWidth;
      styleOpts.lineHeight = fontSize * lineHeightMultiplier;
    }

    this.style = new TextStyle(styleOpts);
    this.pixiText = new Text({ text, style: this.style });

    this._lastContent = text;
    this._lastFontSize = fontSize;
    this._lastFontFamily = fontFamily;
    this._lastFill = fill;
    this._lastWordWrapWidth = wordWrapWidth;
    this._lastLineHeightMultiplier = lineHeightMultiplier;
  }

  /** Show/hide the text (used by TextEditor during editing). */
  setVisible(visible: boolean): void {
    this.pixiText.visible = visible;
  }

  /**
   * Update text rasterization resolution for zoom-bucket crisp rendering.
   * Only re-rasterizes when the bucket actually changes.
   */
  setZoomBucket(bucket: number): void {
    if (bucket === this._zoomBucket) return;
    this._zoomBucket = bucket;
    this.pixiText.resolution = bucket;
  }

  /**
   * Update text content and style. Only touches PixiJS properties
   * when the corresponding input has actually changed.
   * Returns true if text content or style changed (dimensions may differ).
   */
  update(opts: TextCoreOptions): boolean {
    const { text, fontSize, fontFamily, fill } = opts;
    const wordWrapWidth = opts.wordWrapWidth || 0;
    const lineHeightMultiplier = opts.lineHeightMultiplier || 1;

    const contentChanged = text !== this._lastContent;
    const styleChanged =
      fontSize !== this._lastFontSize ||
      fontFamily !== this._lastFontFamily ||
      fill !== this._lastFill;
    const wrapChanged =
      wordWrapWidth !== this._lastWordWrapWidth ||
      lineHeightMultiplier !== this._lastLineHeightMultiplier;

    if (!contentChanged && !styleChanged && !wrapChanged) return false;

    // Update cache
    this._lastContent = text;
    this._lastFontSize = fontSize;
    this._lastFontFamily = fontFamily;
    this._lastFill = fill;
    this._lastWordWrapWidth = wordWrapWidth;
    this._lastLineHeightMultiplier = lineHeightMultiplier;

    if (contentChanged) {
      this.pixiText.text = text;
    }

    if (styleChanged || wrapChanged) {
      this.style.fontSize = fontSize;
      this.style.fontFamily = fontFamily;
      this.style.fill = fill;
      if (wordWrapWidth > 0) {
        this.style.wordWrap = true;
        this.style.wordWrapWidth = wordWrapWidth;
        this.style.lineHeight = fontSize * lineHeightMultiplier;
      } else {
        this.style.wordWrap = false;
      }
      // Do NOT reassign pixiText.style — it's already the live reference.
      // Mutating style properties is sufficient; reassigning triggers
      // a redundant PixiJS invalidation.
    }

    return true;
  }
}
