const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const {
  getUserByEmail,
  getUserByUsername,
  createUser,
  getUserByMattermostId,
  updateUserMattermostId,
} = require('../db');
const { generateToken } = require('../auth');

const router = Router();

// OAuth config from env
const CLIENT_ID = process.env.MATTERMOST_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MATTERMOST_OAUTH_CLIENT_SECRET || '';
const AUTHORIZE_URL = process.env.MATTERMOST_OAUTH_AUTHORIZE_URL || '';
const TOKEN_URL = process.env.MATTERMOST_OAUTH_TOKEN_URL || '';
const USERINFO_URL = process.env.MATTERMOST_OAUTH_USERINFO_URL || '';
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.REFBOARD_PUBLIC_URL || '';
const CALLBACK_PATH = '/api/auth/mattermost/callback';

// CSRF state store: state -> timestamp (expire after 10 min)
const _pendingStates = new Map();
const STATE_TTL = 10 * 60 * 1000;

function _cleanupStates() {
  const now = Date.now();
  for (const [state, ts] of _pendingStates) {
    if (now - ts > STATE_TTL) _pendingStates.delete(state);
  }
}

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET && AUTHORIZE_URL && TOKEN_URL && USERINFO_URL);
}

/**
 * GET /api/auth/mattermost
 * Initiates the OAuth flow — redirects browser to Mattermost authorize page.
 */
router.get('/mattermost', (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Mattermost OAuth not configured' });
  }

  _cleanupStates();
  const state = crypto.randomBytes(24).toString('hex');
  _pendingStates.set(state, Date.now());

  const callbackUrl = `${PUBLIC_URL}${CALLBACK_PATH}`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: callbackUrl,
    state,
  });

  res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
});

/**
 * GET /api/auth/mattermost/callback
 * Handles the OAuth callback from Mattermost.
 */
router.get('/mattermost/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error('[oauth] Mattermost returned error:', oauthError);
      return res.redirect(`/login?error=${encodeURIComponent('Login was denied')}`);
    }

    // Validate CSRF state
    if (!state || !_pendingStates.has(state)) {
      return res.redirect('/login?error=' + encodeURIComponent('Invalid login session. Please try again.'));
    }
    _pendingStates.delete(state);

    if (!code) {
      return res.redirect('/login?error=' + encodeURIComponent('No authorization code received'));
    }

    // Exchange code for access token
    const callbackUrl = `${PUBLIC_URL}${CALLBACK_PATH}`;
    const tokenResp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      console.error('[oauth] Token exchange failed:', tokenResp.status, text);
      return res.redirect('/login?error=' + encodeURIComponent('Login failed. Please try again.'));
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;

    // Fetch user info from Mattermost
    const userResp = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResp.ok) {
      console.error('[oauth] Userinfo fetch failed:', userResp.status);
      return res.redirect('/login?error=' + encodeURIComponent('Failed to get user info'));
    }

    const mmUser = await userResp.json();
    const mmId = mmUser.id;
    const mmEmail = mmUser.email;
    const mmUsername = mmUser.username;
    const mmDisplayName = [mmUser.first_name, mmUser.last_name].filter(Boolean).join(' ')
      || mmUser.nickname || mmUsername;

    // Try to find existing RefBoard user
    let user = getUserByMattermostId(mmId);

    if (!user) {
      // Try matching by email
      user = getUserByEmail(mmEmail);
      if (user) {
        // Link existing account
        updateUserMattermostId(user.id, mmId);
      }
    }

    if (!user) {
      // Auto-create new user
      // Handle username collision
      let finalUsername = mmUsername;
      const existingUsername = getUserByUsername(finalUsername);
      if (existingUsername) {
        finalUsername = `${mmUsername}_mm`;
      }

      user = createUser({
        id: uuidv4(),
        email: mmEmail,
        username: finalUsername,
        passwordHash: `oauth:mattermost:${crypto.randomBytes(16).toString('hex')}`,
        displayName: mmDisplayName,
        role: 'member',
      });

      updateUserMattermostId(user.id, mmId);
      console.log(`[oauth] Created RefBoard user for MM user ${mmUsername} (${mmEmail})`);
    }

    // Generate JWT and redirect to frontend
    const jwt = generateToken(user);
    const userPayload = encodeURIComponent(JSON.stringify({
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    }));

    res.redirect(`/login?token=${jwt}&user=${userPayload}`);
  } catch (err) {
    console.error('[oauth] Callback error:', err);
    res.redirect('/login?error=' + encodeURIComponent('Something went wrong. Please try again.'));
  }
});

/**
 * GET /api/auth/mattermost/status
 * Check if Mattermost OAuth is configured (for frontend to show/hide button).
 */
router.get('/mattermost/status', (_req, res) => {
  res.json({ enabled: isConfigured() });
});

module.exports = router;
