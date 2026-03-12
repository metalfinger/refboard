/**
 * textLimits — font-size constraints for plain text items.
 *
 * Used by creation defaults to keep initial sizes reasonable.
 * Direct manipulation (resize-bake) intentionally bypasses these
 * clamps so users can scale text to any size.
 *
 * Sticky notes use discrete presets (S/M/L/XL/XXL) defined in
 * TextFormatToolbar.tsx — not continuous clamps.
 */

const TEXT_FONT_MIN = 6;
const TEXT_FONT_MAX = 160;

export function clampTextFontSize(size: number): number {
  return Math.round(Math.min(TEXT_FONT_MAX, Math.max(TEXT_FONT_MIN, size)));
}
