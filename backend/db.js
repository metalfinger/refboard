const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || '/app/data/refboard.db';

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------
// Schema
// ---------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    share_token TEXT UNIQUE,
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_members (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    canvas_state TEXT DEFAULT '{}',
    thumbnail TEXT DEFAULT NULL,
    object_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    minio_path TEXT NOT NULL,
    public_url TEXT,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_collections_created_by ON collections(created_by);
  CREATE INDEX IF NOT EXISTS idx_collection_members_user ON collection_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_boards_collection ON boards(collection_id);
  CREATE INDEX IF NOT EXISTS idx_boards_created_by ON boards(created_by);
  CREATE INDEX IF NOT EXISTS idx_images_board ON images(board_id);
`);

// Migrations — add columns to existing tables
try {
  db.prepare("SELECT thumbnail FROM boards LIMIT 0").get();
} catch {
  db.exec("ALTER TABLE boards ADD COLUMN thumbnail TEXT DEFAULT NULL");
}
try {
  db.prepare("SELECT object_count FROM boards LIMIT 0").get();
} catch {
  db.exec("ALTER TABLE boards ADD COLUMN object_count INTEGER NOT NULL DEFAULT 0");
}

// ---------------------
// User helpers
// ---------------------
function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
}

function createUser({ id, email, username, passwordHash, displayName, role }) {
  db.prepare(`
    INSERT INTO users (id, email, username, password_hash, display_name, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, email, username, passwordHash, displayName, role || 'member');
  return getUserById(id);
}

function getAllUsers() {
  return db.prepare('SELECT id, email, username, display_name, role, is_active, created_at, updated_at FROM users').all();
}

function updateUserPassword(userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(passwordHash, userId);
}

function deactivateUser(userId) {
  db.prepare("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(userId);
}

function getUserCount() {
  return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}

// ---------------------
// Collection helpers
// ---------------------
function getCollections(userId, search, limit = 50, offset = 0) {
  let query = `
    SELECT DISTINCT c.*, cm.role as member_role,
           (SELECT COUNT(*) FROM boards WHERE collection_id = c.id) as board_count,
           (SELECT COUNT(*) FROM collection_members WHERE collection_id = c.id) as member_count,
           (SELECT b.thumbnail FROM boards b WHERE b.collection_id = c.id AND b.thumbnail IS NOT NULL ORDER BY b.updated_at DESC LIMIT 1) as preview_thumbnail,
           (SELECT GROUP_CONCAT(sub.thumbnail, '|||') FROM (SELECT thumbnail FROM boards WHERE collection_id = c.id AND thumbnail IS NOT NULL ORDER BY updated_at DESC LIMIT 4) sub) as preview_thumbnails
    FROM collections c
    LEFT JOIN collection_members cm ON c.id = cm.collection_id AND cm.user_id = ?
    WHERE (cm.user_id IS NOT NULL OR c.is_public = 1)
  `;
  const params = [userId];

  if (search) {
    query += ' AND (c.name LIKE ? OR c.description LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  query += ' ORDER BY c.updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

function getCollection(collectionId) {
  return db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId);
}

function getCollectionByShareToken(shareToken) {
  return db.prepare('SELECT * FROM collections WHERE share_token = ?').get(shareToken);
}

function createCollection({ id, name, description, createdBy }) {
  db.prepare(`
    INSERT INTO collections (id, name, description, created_by)
    VALUES (?, ?, ?, ?)
  `).run(id, name, description || '', createdBy);
  return getCollection(id);
}

function updateCollection(collectionId, { name, description, isPublic, shareToken }) {
  const fields = [];
  const params = [];

  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description); }
  if (isPublic !== undefined) { fields.push('is_public = ?'); params.push(isPublic ? 1 : 0); }
  if (shareToken !== undefined) { fields.push('share_token = ?'); params.push(shareToken); }

  if (fields.length === 0) return getCollection(collectionId);

  fields.push("updated_at = datetime('now')");
  params.push(collectionId);

  db.prepare(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getCollection(collectionId);
}

function deleteCollection(collectionId) {
  db.prepare('DELETE FROM collections WHERE id = ?').run(collectionId);
}

// ---------------------
// Collection members
// ---------------------
function getCollectionMembers(collectionId) {
  return db.prepare(`
    SELECT cm.collection_id, cm.user_id, cm.role, cm.added_at,
           u.email, u.username, u.display_name
    FROM collection_members cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.collection_id = ?
  `).all(collectionId);
}

function getCollectionMember(collectionId, userId) {
  return db.prepare('SELECT * FROM collection_members WHERE collection_id = ? AND user_id = ?').get(collectionId, userId);
}

function addCollectionMember(collectionId, userId, role = 'editor') {
  db.prepare(`
    INSERT OR REPLACE INTO collection_members (collection_id, user_id, role)
    VALUES (?, ?, ?)
  `).run(collectionId, userId, role);
}

function removeCollectionMember(collectionId, userId) {
  db.prepare('DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?').run(collectionId, userId);
}

/**
 * Check if user can access a collection (is member, or collection is public).
 * Returns the member record or null.
 */
function checkCollectionAccess(collectionId, userId) {
  const collection = getCollection(collectionId);
  if (!collection) return { collection: null, member: null };
  const member = getCollectionMember(collectionId, userId);
  if (!member && !collection.is_public) return { collection, member: null };
  return { collection, member: member || { role: 'viewer' } };
}

// ---------------------
// Board helpers
// ---------------------
function getCollectionBoards(collectionId, search, limit = 50, offset = 0) {
  let query = `
    SELECT b.id, b.collection_id, b.name, b.description, b.thumbnail,
           b.created_by, b.created_at, b.updated_at,
           b.object_count as image_count
    FROM boards b
    WHERE b.collection_id = ?
  `;
  const params = [collectionId];

  if (search) {
    query += ' AND (b.name LIKE ? OR b.description LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  query += ' ORDER BY b.updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

function getBoard(boardId) {
  return db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
}

function createBoard({ id, collectionId, name, description, createdBy }) {
  db.prepare(`
    INSERT INTO boards (id, collection_id, name, description, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, collectionId, name, description || '', createdBy);
  return getBoard(id);
}

function updateBoard(boardId, { name, description }) {
  const fields = [];
  const params = [];

  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description); }

  if (fields.length === 0) return getBoard(boardId);

  fields.push("updated_at = datetime('now')");
  params.push(boardId);

  db.prepare(`UPDATE boards SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getBoard(boardId);
}

function deleteBoard(boardId) {
  db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
}

function saveBoardCanvas(boardId, canvasState, thumbnail) {
  const stateStr = typeof canvasState === 'string' ? canvasState : JSON.stringify(canvasState);
  // Count objects from canvas state JSON
  let objectCount = 0;
  try {
    const parsed = typeof canvasState === 'string' ? JSON.parse(canvasState) : canvasState;
    if (parsed && Array.isArray(parsed.objects)) objectCount = parsed.objects.length;
  } catch {}

  if (thumbnail) {
    db.prepare("UPDATE boards SET canvas_state = ?, thumbnail = ?, object_count = ?, updated_at = datetime('now') WHERE id = ?")
      .run(stateStr, thumbnail, objectCount, boardId);
  } else {
    db.prepare("UPDATE boards SET canvas_state = ?, object_count = ?, updated_at = datetime('now') WHERE id = ?")
      .run(stateStr, objectCount, boardId);
  }
}

// ---------------------
// Images
// ---------------------
function createImage({ id, boardId, filename, mimeType, fileSize, width, height, minioPath, publicUrl, uploadedBy }) {
  db.prepare(`
    INSERT INTO images (id, board_id, filename, mime_type, file_size, width, height, minio_path, public_url, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, boardId, filename, mimeType, fileSize, width || null, height || null, minioPath, publicUrl || null, uploadedBy);
  return db.prepare('SELECT * FROM images WHERE id = ?').get(id);
}

function getBoardImages(boardId) {
  return db.prepare('SELECT * FROM images WHERE board_id = ? ORDER BY created_at DESC').all(boardId);
}

function getImage(imageId) {
  return db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
}

function deleteImage(imageId) {
  const image = getImage(imageId);
  db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
  return image;
}

function deleteBoardImageRecords(boardId) {
  const images = getBoardImages(boardId);
  db.prepare('DELETE FROM images WHERE board_id = ?').run(boardId);
  return images;
}

module.exports = {
  db,
  // Users
  getUserByEmail, getUserById, getUserByUsername, createUser,
  getAllUsers, updateUserPassword, deactivateUser, getUserCount,
  // Collections
  getCollections, getCollection, getCollectionByShareToken,
  createCollection, updateCollection, deleteCollection,
  getCollectionMembers, getCollectionMember, addCollectionMember, removeCollectionMember,
  checkCollectionAccess,
  // Boards
  getCollectionBoards, getBoard, createBoard, updateBoard, deleteBoard, saveBoardCanvas,
  // Images
  createImage, getBoardImages, getImage, deleteImage, deleteBoardImageRecords,
};
