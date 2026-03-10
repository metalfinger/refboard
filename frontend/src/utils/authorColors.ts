const AUTHOR_COLORS = [
  '#4a9eff', // blue
  '#f97316', // orange
  '#22c55e', // green
  '#a855f7', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#ec4899', // pink
];

const AUTHOR_COLORS_HEX = [
  0x4a9eff, 0xf97316, 0x22c55e, 0xa855f7,
  0xef4444, 0x06b6d4, 0xeab308, 0xec4899,
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getAuthorColor(userId: string): string {
  return AUTHOR_COLORS[hashCode(userId) % AUTHOR_COLORS.length];
}

export function getAuthorColorHex(userId: string): number {
  return AUTHOR_COLORS_HEX[hashCode(userId) % AUTHOR_COLORS_HEX.length];
}

export function getAuthorInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}
