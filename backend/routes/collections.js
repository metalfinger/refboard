const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../auth');
const {
  getCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  getCollectionMembers,
  getCollectionMember,
  addCollectionMember,
  removeCollectionMember,
  getCollectionBoards,
  getUserByEmail,
} = require('../db');
const { deleteBoardImages: deleteBoardMinioImages } = require('../minio');

const router = Router();

router.use(authMiddleware);

function hasRole(member, minRole) {
  if (!member) return false;
  const hierarchy = { owner: 3, editor: 2, viewer: 1 };
  return (hierarchy[member.role] || 0) >= (hierarchy[minRole] || 0);
}

/**
 * GET /api/collections
 * List collections the user has access to.
 */
router.get('/', (req, res) => {
  try {
    const { search, limit, offset } = req.query;
    const collections = getCollections(
      req.user.id,
      search || null,
      parseInt(limit, 10) || 50,
      parseInt(offset, 10) || 0
    );
    return res.json({ collections });
  } catch (err) {
    console.error('[collections] list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections
 * Create a new collection. Creator becomes owner.
 */
router.post('/', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const collectionId = uuidv4();
    const collection = createCollection({
      id: collectionId,
      name: name.trim(),
      description: description || '',
      createdBy: req.user.id,
    });

    addCollectionMember(collectionId, req.user.id, 'owner');

    return res.status(201).json({ collection });
  } catch (err) {
    console.error('[collections] create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/collections/:collectionId
 * Get collection with boards and members.
 */
router.get('/:collectionId', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!member && !collection.is_public) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const members = getCollectionMembers(collection.id);
    const boards = getCollectionBoards(collection.id);

    return res.json({ collection, members, boards });
  } catch (err) {
    console.error('[collections] get error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/collections/:collectionId
 * Update collection. Editor+ only.
 */
router.put('/:collectionId', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!hasRole(member, 'editor')) {
      return res.status(403).json({ error: 'Editor or owner access required' });
    }

    const { name, description } = req.body;
    const updated = updateCollection(collection.id, { name, description });

    return res.json({ collection: updated });
  } catch (err) {
    console.error('[collections] update error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/collections/:collectionId
 * Delete collection and all boards + images. Owner only.
 */
router.delete('/:collectionId', async (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!hasRole(member, 'owner')) {
      return res.status(403).json({ error: 'Owner access required' });
    }

    // Delete all board images from MinIO
    const boards = getCollectionBoards(collection.id);
    for (const board of boards) {
      try {
        await deleteBoardMinioImages(board.id);
      } catch (e) {
        console.error(`[collections] MinIO cleanup error for board ${board.id}:`, e);
      }
    }

    // Cascade deletes boards, images via FK
    deleteCollection(collection.id);

    return res.json({ message: 'Collection deleted' });
  } catch (err) {
    console.error('[collections] delete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/collections/:collectionId/share
 * Get share info.
 */
router.get('/:collectionId/share', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!member) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const PUBLIC_URL = process.env.PUBLIC_URL || '';
    return res.json({
      is_public: !!collection.is_public,
      share_token: collection.share_token,
      share_url: collection.share_token
        ? `${PUBLIC_URL}/c/${collection.share_token}`
        : null,
    });
  } catch (err) {
    console.error('[collections] share info error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections/:collectionId/share
 * Toggle public sharing. Owner only.
 */
router.post('/:collectionId/share', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!hasRole(member, 'owner')) {
      return res.status(403).json({ error: 'Owner access required' });
    }

    const { is_public } = req.body;
    const makePublic = is_public !== undefined ? !!is_public : !collection.is_public;

    let shareToken = collection.share_token;
    if (makePublic && !shareToken) {
      shareToken = uuidv4();
    }

    const updated = updateCollection(collection.id, {
      isPublic: makePublic,
      shareToken: makePublic ? shareToken : collection.share_token,
    });

    const PUBLIC_URL = process.env.PUBLIC_URL || '';
    return res.json({
      is_public: !!updated.is_public,
      share_token: updated.share_token,
      share_url: updated.share_token
        ? `${PUBLIC_URL}/c/${updated.share_token}`
        : null,
    });
  } catch (err) {
    console.error('[collections] share toggle error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/collections/:collectionId/members
 * Add a member. Owner only.
 */
router.post('/:collectionId/members', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!hasRole(member, 'owner')) {
      return res.status(403).json({ error: 'Owner access required' });
    }

    const { email, role } = req.body;
    const validRoles = ['viewer', 'editor'];
    const memberRole = validRoles.includes(role) ? role : 'editor';

    const targetUser = getUserByEmail(email);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (targetUser.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself' });
    }

    const existingMember = getCollectionMember(collection.id, targetUser.id);
    if (existingMember) {
      return res.status(400).json({ error: 'User is already a member' });
    }

    addCollectionMember(collection.id, targetUser.id, memberRole);

    return res.status(201).json({
      member: {
        collection_id: collection.id,
        user_id: targetUser.id,
        email: targetUser.email,
        display_name: targetUser.display_name,
        role: memberRole,
      },
    });
  } catch (err) {
    console.error('[collections] add member error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/collections/:collectionId/members/:userId
 * Remove a member. Owner only.
 */
router.delete('/:collectionId/members/:userId', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const member = getCollectionMember(collection.id, req.user.id);
    if (!hasRole(member, 'owner')) {
      return res.status(403).json({ error: 'Owner access required' });
    }

    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    removeCollectionMember(collection.id, req.params.userId);

    return res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('[collections] remove member error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
