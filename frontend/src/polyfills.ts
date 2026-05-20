// crypto.randomUUID is restricted to secure contexts (HTTPS or localhost).
// On LAN HTTP origins it's undefined, so polyfill via crypto.getRandomValues,
// which is available on insecure origins.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as Crypto & { randomUUID: () => string }).randomUUID = function randomUUID() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex: string[] = [];
    for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
    const b = bytes;
    return (
      hex[b[0]] + hex[b[1]] + hex[b[2]] + hex[b[3]] + '-' +
      hex[b[4]] + hex[b[5]] + '-' +
      hex[b[6]] + hex[b[7]] + '-' +
      hex[b[8]] + hex[b[9]] + '-' +
      hex[b[10]] + hex[b[11]] + hex[b[12]] + hex[b[13]] + hex[b[14]] + hex[b[15]]
    ) as `${string}-${string}-${string}-${string}-${string}`;
  };
}
