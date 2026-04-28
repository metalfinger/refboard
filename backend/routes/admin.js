const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { adminOrApiKeyMiddleware, hashPassword } = require('../auth');
const {
  db,
  createUser,
  getAllUsers,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  deactivateUser,
  updateUserPassword,
  createCollection,
  getCollection,
  updateCollection,
  addCollectionMember,
  createBoard,
  getAllSettings,
  setSetting,
  getBoolSetting,
} = require('../db');

const router = Router();

router.use(adminOrApiKeyMiddleware);

// ---- Settings ----

const KNOWN_SETTINGS = {
  allow_self_registration: { type: 'bool', default: false },
};

router.get('/settings', (_req, res) => {
  try {
    const stored = getAllSettings();
    const map = Object.fromEntries(stored.map((s) => [s.key, s]));
    const out = {};
    for (const [key, def] of Object.entries(KNOWN_SETTINGS)) {
      const row = map[key];
      let value;
      if (def.type === 'bool') {
        value = row ? row.value === 'true' || row.value === '1' : def.default;
      } else {
        value = row ? row.value : def.default;
      }
      out[key] = { value, updated_at: row?.updated_at || null, type: def.type };
    }
    return res.json({ settings: out });
  } catch (err) {
    console.error('[admin] get settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings/:key', (req, res) => {
  try {
    const { key } = req.params;
    const def = KNOWN_SETTINGS[key];
    if (!def) {
      return res.status(404).json({ error: `Unknown setting: ${key}` });
    }
    const raw = req.body?.value;
    if (raw === undefined || raw === null) {
      return res.status(400).json({ error: 'Missing "value" in request body' });
    }
    let stringValue;
    if (def.type === 'bool') {
      const b = raw === true || raw === 'true' || raw === 1 || raw === '1';
      stringValue = b ? 'true' : 'false';
    } else {
      stringValue = String(raw);
    }
    setSetting(key, stringValue);
    return res.json({ key, value: def.type === 'bool' ? stringValue === 'true' : stringValue });
  } catch (err) {
    console.error('[admin] set setting error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- User management ----

router.post('/users', async (req, res) => {
  try {
    const { email, username, password, display_name, displayName, role } = req.body;
    const dn = display_name || displayName;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const existingUsername = getUserByUsername(username);
    if (existingUsername) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await hashPassword(password);
    const user = createUser({
      id: uuidv4(),
      email,
      username,
      passwordHash,
      displayName: dn || username,
      role: role === 'admin' ? 'admin' : 'member',
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
    if (req.user && req.user.id === req.params.userId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    deactivateUser(req.params.userId);
    return res.json({ message: 'User deactivated' });
  } catch (err) {
    console.error('[admin] deactivate user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:userId/reactivate', (req, res) => {
  try {
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    db.prepare("UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(req.params.userId);
    return res.json({ message: 'User reactivated' });
  } catch (err) {
    console.error('[admin] reactivate user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:userId/role', (req, res) => {
  try {
    const { role } = req.body || {};
    if (role !== 'admin' && role !== 'member') {
      return res.status(400).json({ error: "role must be 'admin' or 'member'" });
    }
    const user = getUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (req.user && req.user.id === req.params.userId && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot demote your own admin account' });
    }
    db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, req.params.userId);
    return res.json({ message: 'Role updated', role });
  } catch (err) {
    console.error('[admin] update role error:', err);
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
