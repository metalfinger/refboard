const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  getUserByEmail,
  getUserByUsername,
  createUser,
  getUserById,
  getUserCount,
} = require('../db');
const {
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
} = require('../auth');

const router = Router();

/**
 * POST /api/auth/register
 * Create a new user. The first user automatically becomes admin.
 */
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, display_name, displayName } = req.body;
    const dn = display_name || displayName;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const allowRegistration = (process.env.ALLOW_SELF_REGISTRATION || '').toLowerCase() === 'true';
    const userCount = getUserCount();
    if (!allowRegistration && userCount > 0) {
      return res.status(403).json({
        error: 'Self-registration is disabled. Ask an admin to create your account.',
      });
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
    const role = userCount === 0 ? 'admin' : 'member';

    const user = createUser({
      id: uuidv4(),
      email,
      username,
      passwordHash,
      displayName: dn || username,
      role,
    });

    const token = generateToken(user);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('[auth] register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate with email + password, receive JWT.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Return the current authenticated user.
 */
router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('[auth] me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/auth/password
 * Change password (requires current password).
 */
router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await comparePassword(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const { updateUserPassword } = require('../db');
    const passwordHash = await hashPassword(new_password);
    updateUserPassword(user.id, passwordHash);

    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('[auth] password change error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
