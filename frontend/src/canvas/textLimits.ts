/**
 * textLimits — single source of truth for font-size constraints.
 *
 * Used by creation defaults to keep initial sizes reasonable.
 * Direct manipulation (resize-bake) intentionally bypasses these
 * clamps so users can scale text to any size.
 */

// Plain text: generous range for direct manipulation
const TEXT_FONT_MIN = 6;
const TEXT_FONT_MAX = 160;

// Sticky note text: narrower range (card layout breaks at extremes)
const STICKY_FONT_MIN = 8;
const STICKY_FONT_MAX = 96;

export function clampTextFontSize(size: number): number {
  return Math.round(Math.min(TEXT_FONT_MAX, Math.max(TEXT_FONT_MIN, size)));
}

export function clampStickyFontSize(size: number): number {
  return Math.round(Math.min(STICKY_FONT_MAX, Math.max(STICKY_FONT_MIN, size)));
}
