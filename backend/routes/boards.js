const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../auth');
const {
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
  saveBoardCanvas,
  getBoardImages,
  getCollection,
  getCollectionMember,
} = require('../db');
const { deleteBoardImages: deleteBoardMinioImages } = require('../minio');

const router = Router();

router.use(authMiddleware);

function hasCollectionRole(member, minRole) {
  if (!member) return false;
  const hierarchy = { owner: 3, editor: 2, viewer: 1 };
  return (hierarchy[member.role] || 0) >= (hierarchy[minRole] || 0);
}

/**
 * Resolve board + check collection access. Returns { board, member } or sends error.
 */
function resolveBoard(req, res, minRole = 'viewer') {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return null;
  }

  const collection = getCollection(board.collection_id);
  if (!collection) {
    res.status(404).json({ error: 'Collection not found' });
    return null;
  }

  const member = getCollectionMember(board.collection_id, req.user.id);
  // Allow access if member has sufficient role, or collection is public (viewer-level)
  if (minRole === 'viewer' && collection.is_public) {
    return { board, collection, member: member || { role: 'viewer' } };
  }
  if (!hasCollectionRole(member, minRole)) {
    res.status(403).json({ error: `${minRole} access required` });
    return null;
  }

  return { board, collection, member };
}

/**
 * POST /api/boards
 * Create a board inside a collection. Editor+ on the collection.
 */
router.post('/', (req, res) => {
  try {
    const { collection_id, name, description } = req.body;
    if (!collection_id || !name || !name.trim()) {
      return res.status(400).json({ error: 'collection_id and name are required' });
    }

    const collection = getCollection(collection_id);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection_id, req.user.id);
    if (!hasCollectionRole(member, 'editor')) {
      return res.status(403).json({ error: 'Editor access required on collection' });
    }

    const board = createBoard({
      id: uuidv4(),
      collectionId: collection_id,
      name: name.trim(),
      description: description || '',
      createdBy: req.user.id,
    });

    return res.status(201).json({ board });
  } catch (err) {
    console.error('[boards] create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/boards/:boardId
 * Get board with canvas_state and images. Viewer+ on collection.
 */
router.get('/:boardId', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const { board, collection } = result;
    const images = getBoardImages(board.id);

    return res.json({
      board: {
        ...board,
        canvas_state: board.canvas_state ? JSON.parse(board.canvas_state) : {},
      },
      collection: {
        id: collection.id,
        name: collection.name,
      },
      images,
    });
  } catch (err) {
    console.error('[boards] get error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/boards/:boardId
 * Update board name/description. Editor+ on collection.
 */
router.put('/:boardId', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'editor');
    if (!result) return;

    const { name, description } = req.body;
    const updated = updateBoard(result.board.id, { name, description });

    return res.json({ board: updated });
  } catch (err) {
    console.error('[boards] update error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/boards/:boardId
 * Delete board + images. Owner on collection.
 */
router.delete('/:boardId', async (req, res) => {
  try {
    const result = resolveBoard(req, res, 'owner');
    if (!result) return;

    try {
      await deleteBoardMinioImages(result.board.id);
    } catch (e) {
      console.error('[boards] MinIO cleanup error:', e);
    }

    deleteBoard(result.board.id);

    return res.json({ message: 'Board deleted' });
  } catch (err) {
    console.error('[boards] delete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/boards/:boardId/save
 * Save canvas state. Editor+ on collection.
 */
router.post('/:boardId/save', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'editor');
    if (!result) return;

    const { canvas_state, thumbnail } = req.body;
    if (canvas_state === undefined) {
      return res.status(400).json({ error: 'canvas_state is required' });
    }

    saveBoardCanvas(result.board.id, canvas_state, thumbnail || null);

    return res.json({ message: 'Canvas saved' });
  } catch (err) {
    console.error('[boards] save error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
