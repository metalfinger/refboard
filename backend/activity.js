/**
 * activity.js — single helper used by route handlers to append an entry to
 * the per-board audit log AND broadcast it over Socket.IO to anyone in the
 * room so live activity panels update without polling.
 */

const { logActivity } = require('./db');
const { getRoomName } = require('./socket/board-room');

/**
 * Record + broadcast a board activity event.
 *
 * @param {object} req     — Express req (used for app.get('io') and req.user)
 * @param {object} entry   — { boardId, action, targetType?, targetId?, targetLabel?, metadata? }
 *                           userId is taken from req.user.id automatically.
 */
function recordActivity(req, entry) {
  try {
    const userId = entry.userId !== undefined ? entry.userId : req?.user?.id || null;
    const row = logActivity({ ...entry, userId });
    if (!row) return null;

    const io = req?.app?.get?.('io');
    if (io && entry.boardId) {
      io.to(getRoomName(entry.boardId)).emit('activity:new', formatRow(row));
    }
    return row;
  } catch (err) {
    // Never let activity logging break a mutation. Just log + swallow.
    console.error('[activity] failed:', err.message);
    return null;
  }
}

function formatRow(row) {
  return {
    id: row.id,
    board_id: row.board_id,
    user_id: row.user_id,
    actor_name: row.actor_name,
    actor_email: row.actor_email,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    target_label: row.target_label,
    metadata: row.metadata ? safeParse(row.metadata) : null,
    created_at: row.created_at,
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { recordActivity, formatRow };
