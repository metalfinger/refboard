const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../auth');
const {
  getBoard, getCollectionMember,
  createBoardChannelLink, getBoardChannelLinks, getBoardChannelLink, deleteBoardChannelLink,
  createImage, getImageByMmFileId,
} = require('../db');
const { putBuffer, getImageUrl, MIME_TO_EXT } = require('../minio');
const sharp = require('sharp');

const router = Router();

const MM_URL = process.env.MM_URL || 'http://mattermost:8065';
const MM_BOT_TOKEN = process.env.MM_BOT_TOKEN || '';

const IMAGE_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
];
const VIDEO_MIME_TYPES = [
  'video/mp4', 'video/webm', 'video/quicktime',
];
const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

// All routes require auth
router.use(authMiddleware);

// ---------------------
// Helpers
// ---------------------

/**
 * Check board access for editor+ role.
 * Returns board or null (sends error response).
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
 * Check board access for any authenticated member (viewer+).
 */
function checkViewerAccess(req, res) {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return null;
  }
  const member = getCollectionMember(board.collection_id, req.user.id);
  if (!member) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return board;
}

/**
 * Make authenticated request to Mattermost API.
 */
async function mmFetch(path, options = {}) {
  const url = `${MM_URL}/api/v4${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${MM_BOT_TOKEN}`,
      ...options.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Mattermost API error ${resp.status}: ${body}`);
  }
  return resp;
}

/**
 * Classify MIME type as image or video.
 */
function classifyMedia(mimeType) {
  if (VIDEO_MIME_TYPES.includes(mimeType)) return 'video';
  return 'image';
}

/**
 * Upload a media file (image or video) to MinIO as a single file.
 * GPU handles all scaling natively — no LOD tiers needed.
 */
async function uploadMedia(boardId, imageId, buffer, mimetype) {
  const ext = MIME_TO_EXT[mimetype] || '.bin';
  const minioPath = `boards/${boardId}/${imageId}${ext}`;
  await putBuffer(minioPath, buffer, mimetype);

  let width = null, height = null;
  if (mimetype !== 'image/svg+xml' && !mimetype.startsWith('video/')) {
    try {
      const metadata = await sharp(buffer).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    } catch {}
  }
  return { assetKey: minioPath, minioPath, width, height };
}

// ---------------------
// Channel Link Routes
// ---------------------

/**
 * POST /api/boards/:boardId/mm-link
 * Link a Mattermost channel to a board.
 */
router.post('/:boardId/mm-link', (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    const { channelId, channelName } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    const link = createBoardChannelLink({
      id: uuidv4(),
      boardId: board.id,
      channelId,
      channelName: channelName || null,
      createdBy: req.user.id,
    });

    return res.status(201).json(link);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Channel already linked to this board' });
    }
    console.error('[mm-bridge] link error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/boards/:boardId/mm-link
 * List linked channels for a board.
 */
router.get('/:boardId/mm-link', (req, res) => {
  try {
    const board = checkViewerAccess(req, res);
    if (!board) return;

    const links = getBoardChannelLinks(board.id);
    return res.json({ links });
  } catch (err) {
    console.error('[mm-bridge] list links error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/boards/:boardId/mm-link/:linkId
 * Unlink a channel from a board.
 */
router.delete('/:boardId/mm-link/:linkId', (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    const link = getBoardChannelLink(req.params.linkId);
    if (!link || link.board_id !== board.id) {
      return res.status(404).json({ error: 'Link not found' });
    }

    deleteBoardChannelLink(link.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[mm-bridge] unlink error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------
// Media Pull Route
// ---------------------

/**
 * POST /api/boards/:boardId/mm-pull
 * Manual pull media from a Mattermost channel or thread.
 */
router.post('/:boardId/mm-pull', async (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    if (!MM_BOT_TOKEN) {
      return res.status(503).json({ error: 'Mattermost bot token not configured' });
    }

    const { channelId, threadId } = req.body;
    if (!channelId && !threadId) {
      return res.status(400).json({ error: 'channelId or threadId is required' });
    }

    // 1. Fetch posts from Mattermost
    let postsData;
    if (threadId) {
      const resp = await mmFetch(`/posts/${threadId}/thread`);
      postsData = await resp.json();
    } else {
      const resp = await mmFetch(`/channels/${channelId}/posts`);
      postsData = await resp.json();
    }

    // postsData.order is array of post IDs, postsData.posts is { id: post }
    const posts = postsData.posts || {};
    const order = postsData.order || Object.keys(posts);

    // 2. Collect all file_ids from posts
    const fileIds = [];
    for (const postId of order) {
      const post = posts[postId];
      if (post && post.file_ids && post.file_ids.length > 0) {
        fileIds.push(...post.file_ids);
      }
    }

    if (fileIds.length === 0) {
      return res.json({ assets: [], message: 'No files found in posts' });
    }

    // 3. Process each file
    const assets = [];
    const errors = [];

    for (const fileId of fileIds) {
      try {
        // Skip if already imported (dedup by mm_file_id)
        const existing = getImageByMmFileId(board.id, fileId);
        if (existing) {
          continue;
        }

        // Get file info
        const infoResp = await mmFetch(`/files/${fileId}/info`);
        const fileInfo = await infoResp.json();

        const mimeType = fileInfo.mime_type || '';
        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
          continue; // skip non-media files
        }

        // Download file
        const fileResp = await mmFetch(`/files/${fileId}`);
        const arrayBuf = await fileResp.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const imageId = uuidv4();
        const mediaType = classifyMedia(mimeType);

        const { assetKey, minioPath, width, height } = await uploadMedia(board.id, imageId, buffer, mimeType);

        const publicUrl = getImageUrl(minioPath);

        const image = createImage({
          id: imageId,
          boardId: board.id,
          filename: fileInfo.name || `mm-${fileId}`,
          mimeType,
          fileSize: buffer.length,
          width,
          height,
          minioPath,
          publicUrl,
          uploadedBy: req.user.id,
          assetKey,
          mediaType,
          mmFileId: fileId,
        });

        assets.push({
          id: image.id,
          url: publicUrl,
          public_url: publicUrl,
          width: image.width,
          height: image.height,
          file_size: image.file_size,
          mime_type: image.mime_type,
          asset_key: image.asset_key,
          media_type: image.media_type,
          mm_file_id: fileId,
        });
      } catch (fileErr) {
        console.error(`[mm-bridge] failed to process file ${fileId}:`, fileErr.message);
        errors.push({ fileId, error: fileErr.message });
      }
    }

    return res.json({
      assets,
      total_files: fileIds.length,
      imported: assets.length,
      skipped: fileIds.length - assets.length - errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[mm-bridge] pull error:', err);
    return res.status(500).json({ error: 'Failed to pull media from Mattermost' });
  }
});

module.exports = router;
