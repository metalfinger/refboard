const { Router } = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { authMiddleware } = require('../auth');
const { getBoard, getCollectionMember, createImage } = require('../db');
const { uploadImage, getImageUrl } = require('../minio');

const router = Router();

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Multer config: memory storage, 50MB limit, image types only
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
 * POST /api/upload/boards/:boardId/images
 * Upload an image file to a board.
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

    // Get dimensions
    const { width, height } = await getImageDimensions(buffer, mimetype);

    // Upload to MinIO
    const minioPath = await uploadImage(board.id, imageId, buffer, mimetype);
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
    });

    return res.status(201).json({
      id: image.id,
      url: publicUrl,
      public_url: publicUrl,
      width: image.width,
      height: image.height,
      file_size: image.file_size,
      mime_type: image.mime_type,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large (max 50MB)' });
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
          return reject(new Error('Downloaded file too large (max 50MB)'));
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

    // Get dimensions
    const { width, height } = await getImageDimensions(buffer, mimeType);

    // Upload to MinIO
    const minioPath = await uploadImage(board.id, imageId, buffer, mimeType);
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
    });

    return res.status(201).json({
      id: image.id,
      url: publicUrl,
      public_url: publicUrl,
      width: image.width,
      height: image.height,
      file_size: image.file_size,
      mime_type: image.mime_type,
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
      return res.status(413).json({ error: 'File too large (max 50MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
