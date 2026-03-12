/**
 * stickyPresets — sticky note size presets (shared domain module).
 *
 * Defines the S/M/L/XL/XXL presets for sticky text size and card width.
 * Used by both canvas logic (tools, SceneManager) and UI (TextFormatToolbar).
 * No React dependencies.
 */

export type StickyTextSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';

export const STICKY_SIZES: StickyTextSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

export const STICKY_FONT_MAP: Record<StickyTextSize, number> = {
  S: 20, M: 28, L: 36, XL: 48, XXL: 60,
};

export const STICKY_WIDTH_MAP: Record<StickyTextSize, number> = {
  S: 200, M: 260, L: 320, XL: 400, XXL: 480,
};

/** Default preset for new sticky creation. */
export const DEFAULT_STICKY_PRESET: StickyTextSize = 'M';

/** Map a fontSize to the nearest preset label. */
export function nearestStickySize(fontSize: number): StickyTextSize {
  let best: StickyTextSize = 'M';
  let bestDist = Infinity;
  for (const size of STICKY_SIZES) {
    const dist = Math.abs(fontSize - STICKY_FONT_MAP[size]);
    if (dist < bestDist) { bestDist = dist; best = size; }
  }
  return best;
}

/** Get the card width for a given fontSize (snaps to nearest preset). */
export function getStickyWidthForSize(fontSize: number): number {
  return STICKY_WIDTH_MAP[nearestStickySize(fontSize)];
}
