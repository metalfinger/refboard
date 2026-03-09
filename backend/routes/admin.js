const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { apiKeyMiddleware, hashPassword } = require('../auth');
const {
  createUser,
  getAllUsers,
  getUserById,
  getUserByEmail,
  deactivateUser,
  updateUserPassword,
  createCollection,
  getCollection,
  updateCollection,
  addCollectionMember,
  createBoard,
} = require('../db');

const router = Router();

router.use(apiKeyMiddleware);

// ---- User management ----

router.post('/users', async (req, res) => {
  try {
    const { email, username, password, display_name, role } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const user = createUser({
      id: uuidv4(),
      email,
      username,
      passwordHash,
      displayName: display_name || username,
      role: role || 'member',
    });

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[admin] create user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', (req, res) => {
  try {
    const users = getAllUsers();
    return res.json({ users });
  } catch (err) {
    console.error('[admin] list users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/users/:userId', (req, res) => {
  try {
    const user = getUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    deactivateUser(req.params.userId);
    return res.json({ message: 'User deactivated' });
  } catch (err) {
    console.error('[admin] deactivate user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:userId/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = getUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await hashPassword(password);
    updateUserPassword(req.params.userId, passwordHash);

    return res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('[admin] reset password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Collection management ----

router.post('/collections', (req, res) => {
  try {
    const { name, description, user_id } = req.body;
    if (!name || !user_id) {
      return res.status(400).json({ error: 'Collection name and user_id are required' });
    }

    const user = getUserById(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const collectionId = uuidv4();
    const collection = createCollection({
      id: collectionId,
      name: name.trim(),
      description: description || '',
      createdBy: user_id,
    });

    addCollectionMember(collectionId, user_id, 'owner');

    return res.status(201).json({ collection });
  } catch (err) {
    console.error('[admin] create collection error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/collections/:collectionId/share', (req, res) => {
  try {
    const collection = getCollection(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    let shareToken = collection.share_token;
    if (!shareToken) {
      shareToken = uuidv4();
    }

    const updated = updateCollection(collection.id, {
      isPublic: true,
      shareToken,
    });

    const PUBLIC_URL = process.env.PUBLIC_URL || '';
    return res.json({
      is_public: true,
      share_token: updated.share_token,
      share_url: `${PUBLIC_URL}/c/${updated.share_token}`,
    });
  } catch (err) {
    console.error('[admin] share collection error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Board management (create board in collection) ----

router.post('/boards', (req, res) => {
  try {
    const { collection_id, name, description, user_id } = req.body;
    if (!collection_id || !name || !user_id) {
      return res.status(400).json({ error: 'collection_id, name, and user_id are required' });
    }

    const user = getUserById(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const collection = getCollection(collection_id);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const board = createBoard({
      id: uuidv4(),
      collectionId: collection_id,
      name: name.trim(),
      description: description || '',
      createdBy: user_id,
    });

    return res.status(201).json({ board });
  } catch (err) {
    console.error('[admin] create board error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
