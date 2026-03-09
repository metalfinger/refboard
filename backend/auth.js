const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return 'refboard-dev-secret-do-not-use-in-prod';
})();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 12;
const REFBOARD_API_KEY = process.env.REFBOARD_API_KEY || '';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Express middleware: validates Bearer token from Authorization header.
 * Attaches decoded user to req.user.
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Express middleware: checks that authenticated user has admin role.
 * Must be used after authMiddleware.
 */
function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Express middleware: validates X-API-Key header against REFBOARD_API_KEY env var.
 * Used for admin/bot API routes.
 */
function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!REFBOARD_API_KEY) {
    return res.status(503).json({ error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== REFBOARD_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  authMiddleware,
  adminMiddleware,
  apiKeyMiddleware,
  JWT_SECRET,
};
