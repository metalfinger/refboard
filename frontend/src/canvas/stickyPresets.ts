/**
 * stickyPresets — sticky note size presets (shared domain module).
 *
 * Presets are absolute semantic sizes. Zoom changes the camera/view only; it
 * must not change what S/M/L/XL/XXL mean for an existing sticky.
 */

export type StickyTextSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';

export const STICKY_SIZES: StickyTextSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

export const STICKY_FONT_MAP: Record<StickyTextSize, number> = {
  S: 12, M: 14, L: 18, XL: 24, XXL: 32,
};

export const STICKY_WIDTH_MAP: Record<StickyTextSize, number> = {
  S: 180, M: 220, L: 280, XL: 340, XXL: 420,
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
