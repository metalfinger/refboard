/**
 * FrameSprite — visual container for groups/frames.
 *
 * Renders as a colored BORDER (not fill) with rounded corners + title label.
 * Extends Container. The border and label are the first children,
 * so actual group children render on top.
 * Lightweight: one Graphics rect + one Text. No filters or shaders.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { GroupObject } from '../scene-format';

const DEFAULT_PADDING = 16;
const LABEL_FONT_SIZE = 11;
const BORDER_WIDTH = 2;
const CORNER_RADIUS = 6;

const FRAME_COLORS = [
  '#4a90d9', '#69db7c', '#ff6b6b', '#7950f2', '#38d9a9',
  '#ffa94d', '#e64980', '#20c997', '#4dabf7', '#ffd43b',
];

/** Pick a random frame color for new groups. */
export function randomFrameColor(): string {
  return FRAME_COLORS[Math.floor(Math.random() * FRAME_COLORS.length)];
}

export class FrameSprite extends Container {
  private _bg: Graphics;
  private _label: Text;
  private _labelBg: Graphics;
  private _bgColor: string;
  private _padding: number;
  private _frameW: number;
  private _frameH: number;
  private _labelText: string;

  constructor(w: number, h: number, bgColor?: string, label?: string, padding?: number) {
    super();

    this._bgColor = bgColor || '';
    this._padding = padding ?? DEFAULT_PADDING;
    this._frameW = w;
    this._frameH = h;
    this._labelText = label || '';

    // Border rect (drawn first = behind everything)
    this._bg = new Graphics();
    this._bg.label = '__frame_bg';
    this.addChild(this._bg);

    // Label background pill
    this._labelBg = new Graphics();
    this._labelBg.label = '__frame_labelbg';
    this.addChild(this._labelBg);

    // Title label
    this._label = new Text({
      text: this._labelText,
      style: new TextStyle({
        fontSize: LABEL_FONT_SIZE,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fill: '#ffffff',
        fontWeight: '600',
      }),
    });
    this._label.label = '__frame_label';
    this.addChild(this._label);

    this._redraw();
  }

  get bgColor(): string { return this._bgColor; }
  get padding(): number { return this._padding; }

  setBgColor(color: string): void {
    this._bgColor = color;
    this._redraw();
  }

  setLabel(text: string): void {
    this._labelText = text;
    this._label.text = text;
    this._redraw();
  }

  /** Update frame dimensions (call after children bounds change). */
  setFrameSize(w: number, h: number): void {
    this._frameW = w;
    this._frameH = h;
    this._redraw();
  }

  /** Update from GroupObject data. */
  updateFromData(data: GroupObject): void {
    this._bgColor = data.bgColor || '';
    this._labelText = data.label || '';
    this._padding = data.padding ?? DEFAULT_PADDING;
    this._frameW = data.w;
    this._frameH = data.h;
    this._label.text = this._labelText;
    this._redraw();
  }

  private _redraw(): void {
    this._bg.clear();
    this._labelBg.clear();

    if (!this._bgColor) {
      this._bg.visible = false;
      this._labelBg.visible = false;
      this._label.visible = false;
      return;
    }

    this._bg.visible = true;
    const pad = this._padding;
    const color = parseInt(this._bgColor.replace('#', ''), 16);

    // Draw border-only rounded rect (no fill, just stroke)
    this._bg.roundRect(-pad, -pad, this._frameW + pad * 2, this._frameH + pad * 2, CORNER_RADIUS);
    this._bg.stroke({
      color,
      alpha: 0.6,
      width: BORDER_WIDTH,
    });

    // Label positioned at top-left corner, overlapping the border
    const hasLabel = this._labelText.length > 0;
    this._label.visible = hasLabel;
    this._labelBg.visible = hasLabel;

    if (hasLabel) {
      const lx = -pad;
      const ly = -pad - LABEL_FONT_SIZE - 6;

      this._label.position.set(lx + 8, ly + 3);

      // Background pill behind label text
      const lw = this._label.width + 16;
      const lh = LABEL_FONT_SIZE + 6;
      this._labelBg.roundRect(lx, ly, lw, lh, CORNER_RADIUS);
      this._labelBg.fill({ color, alpha: 0.8 });
    }
  }
}
