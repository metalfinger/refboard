const { Router } = require('express');
const { authMiddleware } = require('../auth');
const { getVotesByBoard, toggleVote } = require('../db');
const { resolveBoard } = require('./board-access');

const router = Router();

router.use(authMiddleware);

// GET /api/boards/:boardId/votes — all votes for board
router.get('/:boardId/votes', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const votes = getVotesByBoard(req.params.boardId);
    return res.json({ votes });
  } catch (err) {
    console.error('[votes] list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/votes — toggle vote
router.post('/:boardId/votes', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const { object_id } = req.body;
    if (!object_id) {
      return res.status(400).json({ error: 'object_id is required' });
    }

    const active = toggleVote(req.params.boardId, object_id, req.user.id);

    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('vote:toggle', {
        boardId: req.params.boardId,
        objectId: object_id,
        userId: req.user.id,
        active,
      });
    }

    return res.json({ active });
  } catch (err) {
    console.error('[votes] toggle error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
