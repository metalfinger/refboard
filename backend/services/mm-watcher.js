/**
 * Mattermost Auto-Sync Watcher
 *
 * Polls linked Mattermost channels for new file attachments and
 * automatically imports them into the corresponding RefBoard boards.
 *
 * Requires MM_URL and MM_BOT_TOKEN env vars. Silently skips if not set.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { getAllBoardChannelLinks, getImageByMmFileId, createImage, getBoard } = require('../db');
const { putBuffer, getImageUrl, MIME_TO_EXT } = require('../minio');
const { generateLOD } = require('./lod-generator');

const MM_URL = process.env.MM_URL;
const MM_BOT_TOKEN = process.env.MM_BOT_TOKEN;
const POLL_INTERVAL_MS = parseInt(process.env.MM_WATCHER_INTERVAL || '30000', 10);

const IMAGE_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
];
const VIDEO_MIME_TYPES = [
  'video/mp4', 'video/webm', 'video/quicktime',
];
const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

// Track last-check timestamp per channel link (in-memory)
const lastCheckMap = new Map();

/**
 * Make an authenticated GET request to the Mattermost API.
 * Returns parsed JSON.
 */
function mmGet(apiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, MM_URL);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(url.toString(), {
      headers: { Authorization: `Bearer ${MM_BOT_TOKEN}` },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode !== 200) {
        // Drain and reject
        res.resume();
        return reject(new Error(`MM API ${apiPath} returned ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error(`MM API ${apiPath}: invalid JSON`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/**
 * Download a file from Mattermost by file ID.
 * Returns { buffer, mimeType, filename }.
 */
function mmDownloadFile(fileId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/v4/files/${fileId}`, MM_URL);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(url.toString(), {
      headers: { Authorization: `Bearer ${MM_BOT_TOKEN}` },
      timeout: 30000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        // Follow redirect
        return mmDownloadFileUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`MM file download ${fileId} returned ${res.statusCode}`));
      }
      const contentType = (res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
      const chunks = [];
      let totalSize = 0;
      const MAX_SIZE = 50 * 1024 * 1024;

      res.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_SIZE) {
          res.destroy();
          return reject(new Error(`File ${fileId} too large`));
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({ buffer: Buffer.concat(chunks), mimeType: contentType });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/**
 * Follow a redirect URL for file download.
 */
function mmDownloadFileUrl(downloadUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(downloadUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.get(downloadUrl, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`File redirect download returned ${res.statusCode}`));
      }
      const contentType = (res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ buffer: Buffer.concat(chunks), mimeType: contentType });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/**
 * Get file metadata from Mattermost.
 */
async function mmGetFileInfo(fileId) {
  return mmGet(`/api/v4/files/${fileId}/info`);
}

/**
 * Classify MIME type as image or video.
 */
function classifyMedia(mimeType) {
  if (VIDEO_MIME_TYPES.includes(mimeType)) return 'video';
  return 'image';
}

/**
 * Upload image with LOD tiers (mirrors upload.js logic).
 */
async function uploadImageWithLOD(boardId, imageId, buffer, mimetype) {
  const assetKey = `boards/${boardId}/${imageId}`;
  const originalExt = MIME_TO_EXT[mimetype] || '.bin';

  if (mimetype === 'image/svg+xml' || mimetype === 'image/gif') {
    const fullPath = `${assetKey}/full${originalExt}`;
    await putBuffer(fullPath, buffer, mimetype);
    let width = null, height = null;
    if (mimetype !== 'image/svg+xml') {
      try {
        const meta = await sharp(buffer).metadata();
        width = meta.width || null;
        height = meta.height || null;
      } catch {}
    }
    return { assetKey, minioPath: fullPath, width, height };
  }

  const lod = await generateLOD(buffer, originalExt);

  await Promise.all([
    putBuffer(`${assetKey}/thumb${lod.thumb.ext}`, lod.thumb.buffer, lod.thumb.ext === '.webp' ? 'image/webp' : mimetype),
    putBuffer(`${assetKey}/medium${lod.medium.ext}`, lod.medium.buffer, lod.medium.ext === '.webp' ? 'image/webp' : mimetype),
    putBuffer(`${assetKey}/full${lod.full.ext}`, lod.full.buffer, mimetype),
  ]);

  const minioPath = `${assetKey}/full${lod.full.ext}`;
  return { assetKey, minioPath, width: lod.full.width, height: lod.full.height };
}

/**
 * Upload a video file (single file, no LOD).
 */
async function uploadVideo(boardId, imageId, buffer, mimetype) {
  const assetKey = `boards/${boardId}/${imageId}`;
  const ext = MIME_TO_EXT[mimetype] || '.bin';
  const fullPath = `${assetKey}/full${ext}`;
  await putBuffer(fullPath, buffer, mimetype);
  return { assetKey, minioPath: fullPath, width: null, height: null };
}

/**
 * Process a single channel link: fetch new posts, import new files.
 * Returns array of newly imported assets for socket notification.
 */
async function processLink(link) {
  const { board_id: boardId, channel_id: channelId, id: linkId } = link;

  // Verify board still exists
  const board = getBoard(boardId);
  if (!board) return [];

  const since = lastCheckMap.get(linkId) || Date.now() - POLL_INTERVAL_MS;
  lastCheckMap.set(linkId, Date.now());

  let postsData;
  try {
    postsData = await mmGet(`/api/v4/channels/${channelId}/posts?since=${since}`);
  } catch (err) {
    console.error(`[mm-watcher] Failed to fetch posts for channel ${channelId}:`, err.message);
    return [];
  }

  if (!postsData || !postsData.order || !postsData.posts) return [];

  const newAssets = [];

  for (const postId of postsData.order) {
    const post = postsData.posts[postId];
    if (!post || !post.file_ids || post.file_ids.length === 0) continue;

    for (const fileId of post.file_ids) {
      try {
        // Deduplication check
        const existing = getImageByMmFileId(boardId, fileId);
        if (existing) continue;

        // Get file info to check MIME type
        const fileInfo = await mmGetFileInfo(fileId);
        const mimeType = fileInfo.mime_type || 'application/octet-stream';

        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
          continue; // Skip non-image/video files
        }

        // Download the file
        const { buffer } = await mmDownloadFile(fileId);
        const imageId = uuidv4();
        const mediaType = classifyMedia(mimeType);

        let assetKey, minioPath, width, height;

        if (mediaType === 'video') {
          ({ assetKey, minioPath, width, height } = await uploadVideo(boardId, imageId, buffer, mimeType));
        } else {
          ({ assetKey, minioPath, width, height } = await uploadImageWithLOD(boardId, imageId, buffer, mimeType));
        }

        const publicUrl = getImageUrl(minioPath);

        // Use the link creator as the uploader
        const image = createImage({
          id: imageId,
          boardId,
          filename: fileInfo.name || `mm-${fileId}`,
          mimeType,
          fileSize: buffer.length,
          width,
          height,
          minioPath,
          publicUrl,
          uploadedBy: link.created_by,
          assetKey,
          mediaType,
          mmFileId: fileId,
        });

        newAssets.push({
          assetKey: image.asset_key,
          name: image.filename,
          width: image.width,
          height: image.height,
          mediaType: image.media_type,
        });

        console.log(`[mm-watcher] Imported file ${fileInfo.name || fileId} → board ${boardId}`);
      } catch (err) {
        console.error(`[mm-watcher] Failed to import file ${fileId}:`, err.message);
      }
    }
  }

  return newAssets;
}

/**
 * Single poll cycle: process all links.
 */
async function pollOnce(io) {
  let links;
  try {
    links = getAllBoardChannelLinks();
  } catch (err) {
    console.error('[mm-watcher] Failed to query links:', err.message);
    return;
  }

  if (!links || links.length === 0) return;

  for (const link of links) {
    try {
      const newAssets = await processLink(link);
      if (newAssets.length > 0 && io) {
        io.to(`board:${link.board_id}`).emit('board:media-arrived', {
          boardId: link.board_id,
          assets: newAssets,
        });
      }
    } catch (err) {
      console.error(`[mm-watcher] Error processing link ${link.id}:`, err.message);
    }
  }
}

let pollTimer = null;

/**
 * Start the Mattermost watcher. Requires Socket.IO server instance.
 * Silently does nothing if MM_URL or MM_BOT_TOKEN are not set.
 */
function startWatcher(io) {
  if (!MM_URL || !MM_BOT_TOKEN) {
    console.log('[mm-watcher] MM_URL or MM_BOT_TOKEN not set — watcher disabled');
    return;
  }

  console.log(`[mm-watcher] Starting watcher (interval: ${POLL_INTERVAL_MS}ms)`);

  // Run first poll after a short delay to let the server finish starting
  setTimeout(() => {
    pollOnce(io).catch(err => console.error('[mm-watcher] Poll error:', err.message));
  }, 5000);

  pollTimer = setInterval(() => {
    pollOnce(io).catch(err => console.error('[mm-watcher] Poll error:', err.message));
  }, POLL_INTERVAL_MS);

  // Don't prevent process exit
  if (pollTimer.unref) pollTimer.unref();
}

/**
 * Stop the watcher (for graceful shutdown).
 */
function stopWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[mm-watcher] Watcher stopped');
  }
}

module.exports = { startWatcher, stopWatcher };
