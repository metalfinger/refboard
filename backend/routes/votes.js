const { Router } = require('express');
const { authMiddleware } = require('../auth');
const {
  getBoard,
  getCollection,
  getCollectionMember,
  getVotesByBoard,
  toggleVote,
} = require('../db');

const router = Router();

router.use(authMiddleware);

function hasCollectionRole(member, minRole) {
  if (!member) return false;
  const hierarchy = { owner: 3, editor: 2, viewer: 1 };
  return (hierarchy[member.role] || 0) >= (hierarchy[minRole] || 0);
}

function resolveBoard(req, res, minRole = 'viewer') {
  const board = getBoard(req.params.boardId);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return null; }

  const collection = getCollection(board.collection_id);
  if (!collection) { res.status(404).json({ error: 'Collection not found' }); return null; }

  const member = getCollectionMember(board.collection_id, req.user.id);
  if (minRole === 'viewer' && collection.is_public) {
    return { board, collection, member: member || { role: 'viewer' } };
  }
  if (!hasCollectionRole(member, minRole)) {
    res.status(403).json({ error: `${minRole} access required` });
    return null;
  }
  return { board, collection, member };
}

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
