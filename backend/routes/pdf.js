const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../auth');
const { getBoard, getCollectionMember, getImage, getPdfPage, getPdfPages, createMediaJob } = require('../db');

const router = Router();

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
 * POST /api/boards/:boardId/pdf-pages
 * Request hi-res rendering for selected PDF pages.
 * Body: { imageId, pages: [1, 2, 3, ...] }
 * Max 50 pages per request.
 */
router.post('/:boardId/pdf-pages', async (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    const { imageId, pages } = req.body;
    if (!imageId || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'imageId and pages[] are required' });
    }

    if (pages.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 pages per request' });
    }

    const image = getImage(imageId);
    if (!image || image.board_id !== board.id) {
      return res.status(404).json({ error: 'Image not found on this board' });
    }

    const results = [];
    for (const pageNum of pages) {
      const page = getPdfPage(imageId, pageNum);
      if (!page) continue;

      // Skip if hires already done
      if (page.hires_asset_key) {
        results.push(page);
        continue;
      }

      // Check for existing pending/processing hires job for this page
      const { db } = require('../db');
      const existingJob = db.prepare(
        `SELECT id FROM media_jobs WHERE image_id = ? AND type = 'pdf-hires' AND result_json LIKE ? AND status IN ('queued', 'processing')`
      ).get(imageId, `%"pageNumber":${pageNum}%`);

      if (!existingJob) {
        createMediaJob({
          id: uuidv4(),
          imageId,
          boardId: board.id,
          type: 'pdf-hires',
          priority: 10,
          metaJson: JSON.stringify({ pageNumber: pageNum }),
        });
      }

      results.push(page);
    }

    return res.json({ pages: results });
  } catch (err) {
    console.error('[pdf] pdf-pages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/boards/:boardId/pdf-thumbnails
 * Lazy-load thumbnails for PDF pages not yet rendered.
 * Body: { imageId, pages: [1, 2, 3, ...] }
 * Idempotent — skips pages with existing thumbs or pending jobs.
 */
router.post('/:boardId/pdf-thumbnails', async (req, res) => {
  try {
    const board = checkEditorAccess(req, res);
    if (!board) return;

    const { imageId, pages } = req.body;
    if (!imageId || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'imageId and pages[] are required' });
    }

    const image = getImage(imageId);
    if (!image || image.board_id !== board.id) {
      return res.status(404).json({ error: 'Image not found on this board' });
    }

    const results = [];
    for (const pageNum of pages) {
      const page = getPdfPage(imageId, pageNum);
      if (!page) continue;

      // Skip if thumb already exists
      if (page.thumb_asset_key) {
        results.push(page);
        continue;
      }

      // Skip if job already pending
      const { db } = require('../db');
      const existingJob = db.prepare(
        `SELECT id FROM media_jobs WHERE image_id = ? AND type = 'pdf-thumbnail' AND result_json LIKE ? AND status IN ('queued', 'processing')`
      ).get(imageId, `%"pageNumber":${pageNum}%`);

      if (!existingJob) {
        createMediaJob({
          id: uuidv4(),
          imageId,
          boardId: board.id,
          type: 'pdf-thumbnail',
          priority: 0,
          metaJson: JSON.stringify({ pageNumber: pageNum }),
        });
      }

      results.push(page);
    }

    return res.json({ pages: results });
  } catch (err) {
    console.error('[pdf] pdf-thumbnails error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
