const sharp = require('sharp');

/**
 * LOD tier configuration.
 * Each tier defines the max width and WebP quality for that level of detail.
 * The 'full' tier is a pass-through (no resize, original format).
 */
const LOD_TIERS = {
  thumb:  { maxWidth: 256,  quality: 70 },
  medium: { maxWidth: 1024, quality: 80 },
  full:   { maxWidth: null, quality: null },
};

/**
 * Generate 3-tier LOD images from an uploaded buffer.
 *
 * @param {Buffer} buffer  - Original image buffer
 * @param {string} originalExt - Original file extension (e.g. '.png', '.jpg')
 * @returns {Promise<{
 *   thumb:  { buffer: Buffer, ext: string, width: number, height: number },
 *   medium: { buffer: Buffer, ext: string, width: number, height: number },
 *   full:   { buffer: Buffer, ext: string, width: number, height: number }
 * }>}
 */
async function generateLOD(buffer, originalExt) {
  const metadata = await sharp(buffer).metadata();
  const origWidth = metadata.width;
  const origHeight = metadata.height;

  // Full tier — pass-through, no transformation
  const full = {
    buffer,
    ext: originalExt,
    width: origWidth,
    height: origHeight,
  };

  // Generate a resized WebP tier, or reuse original if image is already smaller
  async function makeTier(tierKey) {
    const { maxWidth, quality } = LOD_TIERS[tierKey];

    if (origWidth <= maxWidth) {
      // Image is smaller than tier width — convert to WebP but don't upscale
      const result = sharp(buffer).webp({ quality });
      const outBuf = await result.toBuffer();
      return { buffer: outBuf, ext: '.webp', width: origWidth, height: origHeight };
    }

    // Resize down (width-based, preserve aspect ratio)
    const result = sharp(buffer)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality });
    const outBuf = await result.toBuffer();
    const outMeta = await sharp(outBuf).metadata();
    return { buffer: outBuf, ext: '.webp', width: outMeta.width, height: outMeta.height };
  }

  const [thumb, medium] = await Promise.all([
    makeTier('thumb'),
    makeTier('medium'),
  ]);

  return { thumb, medium, full };
}

module.exports = { generateLOD, LOD_TIERS };
