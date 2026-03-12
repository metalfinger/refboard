/**
 * stickyPresets — sticky note size presets (shared domain module).
 *
 * Presets are defined in screen-space so they preserve the same visual intent
 * regardless of viewport zoom. Scene data still stores world-space width and
 * fontSize; callers convert through the helpers below.
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

/**
 * Convert a preset's screen-space target to world-space sticky metrics.
 * objectScale is included so old non-1 scaled stickies still respond
 * predictably when a preset is applied.
 */
export function getStickyWorldMetricsForPreset(
  preset: StickyTextSize,
  zoom: number,
  objectScale: number = 1,
): { fontSize: number; width: number } {
  const safeZoom = Math.max(zoom, 0.001);
  const safeScale = Math.max(Math.abs(objectScale), 0.001);
  return {
    fontSize: STICKY_FONT_MAP[preset] / (safeZoom * safeScale),
    width: STICKY_WIDTH_MAP[preset] / (safeZoom * safeScale),
  };
}

/**
 * Convert a desired on-screen font size into world-space sticky metrics by
 * snapping to the nearest preset first.
 */
export function getStickyWorldMetricsForScreenFont(
  screenFontSize: number,
  zoom: number,
  objectScale: number = 1,
): { fontSize: number; width: number; preset: StickyTextSize } {
  const preset = nearestStickySize(screenFontSize);
  return {
    ...getStickyWorldMetricsForPreset(preset, zoom, objectScale),
    preset,
  };
}
