const { Router } = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { authMiddleware } = require('../auth');
const { getBoard, getCollectionMember, createImage, createMediaJob, createPdfPage, updateImagePageCount } = require('../db');
const { putBuffer, getImageUrl, MIME_TO_EXT, MAX_FILE_SIZE } = require('../minio');
const { pdfInfo, bufferToTempFile } = require('../pdf-utils');

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

const PDF_MIME_TYPES = ['application/pdf'];

const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES, ...PDF_MIME_TYPES];

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
  if (PDF_MIME_TYPES.includes(mimeType)) return 'pdf';
  return 'image';
}

/**
 * Upload a media file (image or video) to MinIO.
 * Videos: stored immediately, poster/metadata extracted async by media-worker.
 * Images: dimensions extracted inline (fast, no ffmpeg).
 */
async function uploadMedia(boardId, imageId, buffer, mimetype) {
  const ext = MIME_TO_EXT[mimetype] || '.bin';
  const minioPath = `boards/${boardId}/${imageId}${ext}`;
  await putBuffer(minioPath, buffer, mimetype);

  const isVideo = VIDEO_MIME_TYPES.includes(mimetype);
  let width = null, height = null;

  if (!isVideo) {
    const dims = await getImageDimensions(buffer, mimetype);
    width = dims.width;
    height = dims.height;
  }

  return { assetKey: minioPath, minioPath, width, height, isVideo };
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

    // PDF: validate page count BEFORE uploading to MinIO or creating DB records
    if (mediaType === 'pdf') {
      const { tmpPath, cleanup } = bufferToTempFile(buffer, '.pdf');
      try {
        const info = await pdfInfo(tmpPath);
        if (info.pageCount > 500) {
          return res.status(400).json({ error: 'PDF exceeds 500 page limit' });
        }

        // Validation passed — now upload and create records
        const { assetKey, minioPath, width, height } = await uploadMedia(board.id, imageId, buffer, mimetype);
        const publicUrl = getImageUrl(minioPath);

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

        updateImagePageCount(imageId, info.pageCount);

        // Create pdf_pages rows for all pages
        for (let i = 0; i < info.pageCount; i++) {
          const dim = info.dimensions[i] || { w: null, h: null };
          createPdfPage(uuidv4(), imageId, i + 1, dim.w, dim.h);
        }

        // Queue thumbnail jobs for first 20 pages
        const thumbLimit = Math.min(info.pageCount, 20);
        for (let i = 1; i <= thumbLimit; i++) {
          createMediaJob({
            id: uuidv4(),
            imageId,
            boardId: board.id,
            type: 'pdf-thumbnail',
            priority: 0,
            metaJson: JSON.stringify({ pageNumber: i }),
          });
        }

        // For single-page PDFs, also queue hires
        if (info.pageCount === 1) {
          createMediaJob({
            id: uuidv4(),
            imageId,
            boardId: board.id,
            type: 'pdf-hires',
            priority: 10,
            metaJson: JSON.stringify({ pageNumber: 1 }),
          });
        }

        return res.status(201).json({
          id: image.id,
          media_type: 'pdf',
          page_count: info.pageCount,
          dimensions: info.dimensions,
          asset_key: image.asset_key,
          width: info.dimensions[0]?.w || null,
          height: info.dimensions[0]?.h || null,
          single_page: info.pageCount === 1,
        });
      } finally {
        cleanup();
      }
    }

    const { assetKey, minioPath, width, height, isVideo } = await uploadMedia(board.id, imageId, buffer, mimetype);
    const publicUrl = getImageUrl(minioPath);

    // Save image record first (media_jobs FK references images)
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

    // Enqueue background processing after image record exists
    let jobId = null;
    if (isVideo) {
      jobId = uuidv4();
      createMediaJob({ id: jobId, imageId, boardId: board.id, type: 'poster' });
    }

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
      processing: jobId ? 'queued' : undefined,
      job_id: jobId || undefined,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large (max ${MAX_FILE_SIZE_LABEL})` });
    }
    if (err.code === 'POPPLER_MISSING') {
      console.error('[upload] poppler-utils missing — PDF support disabled until host installs it');
      return res.status(err.statusCode || 501).json({ error: err.message, code: err.code });
    }
    console.error('[upload] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Download an image from a URL. Returns { buffer, mimeType, filename }.
 */
function downloadImage(imageUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(imageUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    client.get(imageUrl, { timeout: 30000 }, (response) => {
      // Follow redirects up to maxRedirects times
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        if (maxRedirects <= 0) {
          return reject(new Error('Too many redirects'));
        }
        return downloadImage(response.headers.location, maxRedirects - 1).then(resolve).catch(reject);
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

    const { assetKey, minioPath, width, height, isVideo } = await uploadMedia(board.id, imageId, buffer, mimeType);
    const publicUrl = getImageUrl(minioPath);

    // Save image record first (media_jobs FK references images)
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

    // Enqueue background processing after image record exists
    let jobId = null;
    if (isVideo) {
      jobId = uuidv4();
      createMediaJob({ id: jobId, imageId, boardId: board.id, type: 'poster' });
    }

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
      processing: jobId ? 'queued' : undefined,
      job_id: jobId || undefined,
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
