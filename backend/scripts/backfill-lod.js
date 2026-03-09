#!/usr/bin/env node
/**
 * Backfill LOD tiers for existing images that don't have an asset_key yet.
 *
 * For each image where asset_key IS NULL:
 *   - Videos: set asset_key, upload single file under asset_key/full{ext}
 *   - SVG/GIF: set asset_key, upload single file under asset_key/full{ext}
 *   - Other images: generate 3 LOD tiers (thumb, medium, full), upload all, set asset_key
 *
 * Usage: node scripts/backfill-lod.js
 */

const path = require('path');

// Load .env from backend root if present
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv not required
}

const { db } = require('../db');
const { minioClient, putBuffer, MINIO_BUCKET, MIME_TO_EXT } = require('../minio');
const { generateLOD } = require('../services/lod-generator');

/**
 * Download an object from MinIO into a Buffer.
 */
function downloadFromMinio(objectName) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    minioClient.getObject(MINIO_BUCKET, objectName, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

/**
 * Process a single image record.
 */
async function processImage(image) {
  const { id, board_id, minio_path, mime_type, media_type } = image;
  const assetKey = `boards/${board_id}/${id}`;
  const ext = MIME_TO_EXT[mime_type] || '.bin';

  // Download original from MinIO
  const buffer = await downloadFromMinio(minio_path);

  // Videos: single file, no LOD
  if (media_type === 'video') {
    const fullPath = `${assetKey}/full${ext}`;
    await putBuffer(fullPath, buffer, mime_type);
    db.prepare("UPDATE images SET asset_key = ?, minio_path = ? WHERE id = ?")
      .run(assetKey, fullPath, id);
    return;
  }

  // SVG and GIF: single file, no LOD processing
  if (mime_type === 'image/svg+xml' || mime_type === 'image/gif') {
    const fullPath = `${assetKey}/full${ext}`;
    await putBuffer(fullPath, buffer, mime_type);
    db.prepare("UPDATE images SET asset_key = ?, minio_path = ? WHERE id = ?")
      .run(assetKey, fullPath, id);
    return;
  }

  // Standard images: generate 3 LOD tiers
  const lod = await generateLOD(buffer, ext);

  await Promise.all([
    putBuffer(`${assetKey}/thumb${lod.thumb.ext}`, lod.thumb.buffer,
      lod.thumb.ext === '.webp' ? 'image/webp' : mime_type),
    putBuffer(`${assetKey}/medium${lod.medium.ext}`, lod.medium.buffer,
      lod.medium.ext === '.webp' ? 'image/webp' : mime_type),
    putBuffer(`${assetKey}/full${lod.full.ext}`, lod.full.buffer, mime_type),
  ]);

  const fullPath = `${assetKey}/full${lod.full.ext}`;
  db.prepare("UPDATE images SET asset_key = ?, minio_path = ?, width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE id = ?")
    .run(assetKey, fullPath, lod.full.width, lod.full.height, id);
}

async function main() {
  // Find all images without an asset_key
  const images = db.prepare("SELECT * FROM images WHERE asset_key IS NULL").all();

  if (images.length === 0) {
    console.log('[backfill-lod] No images need backfilling. All done.');
    return;
  }

  console.log(`[backfill-lod] Found ${images.length} image(s) to backfill.\n`);

  let success = 0;
  let failed = 0;

  for (const image of images) {
    const label = `${image.id} (${image.filename}, ${image.mime_type})`;
    try {
      await processImage(image);
      success++;
      console.log(`  \u2713 ${label}`);
    } catch (err) {
      failed++;
      console.error(`  \u2717 ${label} — ${err.message}`);
    }
  }

  console.log(`\n[backfill-lod] Done. ${success} succeeded, ${failed} failed out of ${images.length} total.`);
}

main().catch((err) => {
  console.error('[backfill-lod] Fatal error:', err);
  process.exit(1);
});
