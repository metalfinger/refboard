const { Router } = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { authMiddleware } = require('../auth');
const { getBoard, getCollectionMember, createImage } = require('../db');
const { putBuffer, getImageUrl, MIME_TO_EXT, MAX_FILE_SIZE } = require('../minio');
const { probeVideo, extractPoster } = require('../video-utils');

const router = Router();

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

const MAX_FILE_SIZE_LABEL = `${MAX_FILE_SIZE / 1024 / 1024}MB`;

// Multer config: memory storage, configurable size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// All routes require auth
router.use(authMiddleware);

/**
 * Helper: check board access for editor+
 */
function checkEditorAccess(req, res) {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return null;
  }

  const member = getCollectionMember(board.collection_id, req.user.id);
  const hierarchy = { owner: 3, editor: 2, viewer: 1 };
  if (!member || (hierarchy[member.role] || 0) < 2) {
    res.status(403).json({ error: 'Editor or owner access required' });
    return null;
  }

  return board;
}

/**
 * Get image dimensions using sharp. Returns { width, height } or null for SVG.
 */
async function getImageDimensions(buffer, mimeType) {
  if (mimeType === 'image/svg+xml') {
    return { width: null, height: null };
  }
  try {
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width || null, height: metadata.height || null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Detect whether a MIME type is image or video.
 */
function classifyMedia(mimeType) {
  if (VIDEO_MIME_TYPES.includes(mimeType)) return 'video';
  return 'image';
}

/**
 * Upload a media file (image or video) to MinIO.
 * For videos: extracts poster frame + metadata via ffmpeg at upload time
 * so the board never needs a <video> element for thumbnails.
 */
async function uploadMedia(boardId, imageId, buffer, mimetype) {
  const ext = MIME_TO_EXT[mimetype] || '.bin';
  const minioPath = `boards/${boardId}/${imageId}${ext}`;
  await putBuffer(minioPath, buffer, mimetype);

  const isVideo = VIDEO_MIME_TYPES.includes(mimetype);
  let width = null, height = null, duration = null, posterAssetKey = null;

  if (isVideo) {
    // Extract metadata and poster frame server-side
    const [meta, posterBuf] = await Promise.all([
      probeVideo(buffer),
      extractPoster(buffer),
    ]);

    if (meta) {
      width = meta.width;
      height = meta.height;
      duration = meta.duration;
    }

    if (posterBuf) {
      const posterPath = `boards/${boardId}/${imageId}_poster.jpg`;
      await putBuffer(posterPath, posterBuf, 'image/jpeg');
      posterAssetKey = posterPath;
    }
  } else {
    const dims = await getImageDimensions(buffer, mimetype);
    width = dims.width;
    height = dims.height;
  }

  return { assetKey: minioPath, minioPath, width, height, duration, posterAssetKey };
}

/**
 * POST /api/upload/boards/:boardId/images
 * Upload an image or video file to a board.
 */
router.post('/boards/:boardId/images', upload.single('image'), async (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imageId = uuidv4();
    const { buffer, originalname, mimetype, size } = req.file;
    const mediaType = classifyMedia(mimetype);

    const { assetKey, minioPath, width, height, duration, posterAssetKey } = await uploadMedia(board.id, imageId, buffer, mimetype);
    const publicUrl = getImageUrl(minioPath);

    // Save record
    const image = createImage({
      id: imageId,
      boardId: board.id,
      filename: originalname,
      mimeType: mimetype,
      fileSize: size,
      width,
      height,
      minioPath,
      publicUrl,
      uploadedBy: req.user.id,
      assetKey,
      mediaType,
    });

    return res.status(201).json({
      id: image.id,
      url: publicUrl,
      public_url: publicUrl,
      width: image.width,
      height: image.height,
      file_size: image.file_size,
      mime_type: image.mime_type,
      asset_key: image.asset_key,
      media_type: image.media_type,
      duration: duration || undefined,
      poster_asset_key: posterAssetKey || undefined,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large (max ${MAX_FILE_SIZE_LABEL})` });
    }
    console.error('[upload] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Download an image from a URL. Returns { buffer, mimeType, filename }.
 */
function downloadImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(imageUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    client.get(imageUrl, { timeout: 30000 }, (response) => {
      // Follow redirects (up to 5)
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        return downloadImage(response.headers.location).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
      }

      const contentType = (response.headers['content-type'] || '').split(';')[0].trim();
      if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        return reject(new Error(`Unsupported content type: ${contentType}`));
      }

      const chunks = [];
      let totalSize = 0;

      response.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          response.destroy();
          return reject(new Error(`Downloaded file too large (max ${MAX_FILE_SIZE_LABEL})`));
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const filename = parsed.pathname.split('/').pop() || 'image';
        resolve({ buffer, mimeType: contentType, filename });
      });

      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * POST /api/upload/boards/:boardId/images/from-url
 * Download an image from a URL and store it.
 */
router.post('/boards/:boardId/images/from-url', async (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Download image
    const { buffer, mimeType, filename } = await downloadImage(url);

    const imageId = uuidv4();
    const mediaType = classifyMedia(mimeType);

    const { assetKey, minioPath, width, height, duration, posterAssetKey } = await uploadMedia(board.id, imageId, buffer, mimeType);
    const publicUrl = getImageUrl(minioPath);

    // Save record
    const image = createImage({
      id: imageId,
      boardId: board.id,
      filename,
      mimeType,
      fileSize: buffer.length,
      width,
      height,
      minioPath,
      publicUrl,
      uploadedBy: req.user.id,
      assetKey,
      mediaType,
    });

    return res.status(201).json({
      id: image.id,
      url: publicUrl,
      public_url: publicUrl,
      width: image.width,
      height: image.height,
      file_size: image.file_size,
      mime_type: image.mime_type,
      asset_key: image.asset_key,
      media_type: image.media_type,
      duration: duration || undefined,
      poster_asset_key: posterAssetKey || undefined,
    });
  } catch (err) {
    console.error('[upload] from-url error:', err);
    const message = err.message.includes('Unsupported') || err.message.includes('too large')
      ? err.message
      : 'Failed to download image from URL';
    return res.status(400).json({ error: message });
  }
});

// Handle multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large (max ${MAX_FILE_SIZE_LABEL})` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
