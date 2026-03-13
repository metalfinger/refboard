/**
 * MarkdownSprite — PixiJS background container for markdown cards.
 *
 * Renders only a colored background rectangle for canvas integration
 * (hit-testing, selection, z-ordering). All markdown content is rendered
 * as a DOM overlay by MarkdownOverlay, not by PixiJS.
 */

import { Container, Graphics } from 'pixi.js';
import type { MarkdownObject } from '../scene-format';
import {
  MD_DEFAULT_BG,
  MD_DEFAULT_CORNER_RADIUS,
  MD_HEADER_BG,
} from '../markdownDefaults';

const HEADER_HEIGHT = 32;

export class MarkdownSprite extends Container {
  private _bg: Graphics;
  private _lastW = 0;
  private _lastH = 0;
  private _lastBgColor = '';
  private _lastCornerRadius = 0;

  constructor(data: MarkdownObject) {
    super();
    this._bg = new Graphics();
    this.addChild(this._bg);
    this._draw(data.w, data.h, data.bgColor || MD_DEFAULT_BG, data.cornerRadius ?? MD_DEFAULT_CORNER_RADIUS);
  }

  updateFromData(data: MarkdownObject): void {
    const bgColor = data.bgColor || MD_DEFAULT_BG;
    const cr = data.cornerRadius ?? MD_DEFAULT_CORNER_RADIUS;
    if (data.w === this._lastW && data.h === this._lastH && bgColor === this._lastBgColor && cr === this._lastCornerRadius) {
      return; // nothing changed
    }
    this._draw(data.w, data.h, bgColor, cr);
  }

  private _draw(w: number, h: number, bgColor: string, cornerRadius: number): void {
    this._lastW = w;
    this._lastH = h;
    this._lastBgColor = bgColor;
    this._lastCornerRadius = cornerRadius;

    const g = this._bg;
    g.clear();

    // Card background
    g.roundRect(0, 0, w, h, cornerRadius);
    g.fill({ color: bgColor });

    // Header bar
    // Draw as a rect clipped to the top portion with rounded top corners
    g.roundRect(0, 0, w, HEADER_HEIGHT, cornerRadius);
    g.fill({ color: MD_HEADER_BG });
    // Flat bottom edge of header: overwrite the bottom-rounded part
    g.rect(0, HEADER_HEIGHT - cornerRadius, w, cornerRadius);
    g.fill({ color: MD_HEADER_BG });

    // Header bottom border
    g.rect(0, HEADER_HEIGHT - 1, w, 1);
    g.fill({ color: '#333333' });
  }
}
