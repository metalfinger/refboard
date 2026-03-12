/**
 * textLimits — single source of truth for font-size constraints.
 *
 * Every path that creates, resizes, or mutates fontSize on text/sticky
 * items must go through these helpers. This prevents inconsistent
 * clamping when ranges are widened later.
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
