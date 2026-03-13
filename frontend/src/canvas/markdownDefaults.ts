// markdownDefaults.ts — default values and constraints for markdown blocks

export const MD_DEFAULT_WIDTH = 450;
export const MD_MIN_WIDTH = 250;
export const MD_MAX_WIDTH = 800;
export const MD_DEFAULT_BG = '#232336';
export const MD_DEFAULT_TEXT_COLOR = '#e0e0e0';
export const MD_DEFAULT_ACCENT = '#7950f2';
export const MD_DEFAULT_PADDING = 16;
export const MD_DEFAULT_CORNER_RADIUS = 10;
export const MD_HEADER_BG = '#2a2a42';
export const MD_MAX_CONTENT_LENGTH = 50_000;

/** Extract the first H1 from markdown content for the card header title. */
export function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}
