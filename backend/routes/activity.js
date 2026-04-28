const { Router } = require('express');
const { authMiddleware } = require('../auth');
const { getBoardActivity } = require('../db');
const { resolveBoard } = require('./board-access');
const { formatRow } = require('../activity');

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/boards/:boardId/activity
 * Returns recent activity entries for a board, newest first.
 *
 * Query params:
 *   limit  — max entries to return (1-200, default 50)
 *   before — ISO timestamp; only entries created strictly before this
 */
router.get('/:boardId/activity', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const { limit, before } = req.query;
    const rows = getBoardActivity(result.board.id, { limit, before });
    return res.json({
      activity: rows.map(formatRow),
      hasMore: rows.length === Math.max(1, Math.min(parseInt(limit, 10) || 50, 200)),
    });
  } catch (err) {
    console.error('[activity] list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
