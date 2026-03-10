# Annotations & Voting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add thread-centric comments (object-level and region-pinned) and per-object upvoting to refboard, with real-time sync and a Review Mode overlay.

**Architecture:** Backend uses SQLite tables (comment_threads, comments, object_votes) with REST endpoints and socket event relay. Frontend loads all threads/votes on board open, updates via socket events (server-authoritative, sender included), renders pin markers in a PixiJS overlay container, and shows a collapsible Feedback Panel alongside the existing LayerPanel.

**Tech Stack:** Node.js/Express backend, better-sqlite3, Socket.IO, React + PixiJS frontend, TypeScript

**Design Doc:** `docs/plans/2026-03-10-annotations-voting-design.md`

---

## Phase 1: Comments Backend

### Task 1: Database Schema — comment_threads + comments tables

**Files:**
- Modify: `backend/db.js`

**Step 1: Add tables after existing schema**

Add this block after the existing `CREATE TABLE` statements (after the media_jobs table, around line 116):

```javascript
// ── Comment Threads & Comments ──
db.exec(`
  CREATE TABLE IF NOT EXISTS comment_threads (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    anchor_type TEXT NOT NULL DEFAULT 'object',
    pin_x REAL,
    pin_y REAL,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_by TEXT REFERENCES users(id),
    resolved_at TEXT,
    comment_count INTEGER NOT NULL DEFAULT 1,
    last_commented_at TEXT,
    last_commented_by TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_threads_board ON comment_threads(board_id);
  CREATE INDEX IF NOT EXISTS idx_threads_object ON comment_threads(board_id, object_id);

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    author_name TEXT NOT NULL,
    author_color TEXT,
    content TEXT NOT NULL,
    edited_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);
`);
```

**Step 2: Add prepared statement helpers**

Add these functions before the `module.exports` block:

```javascript
// ── Thread queries ──
function getThreadsByBoard(boardId) {
  return db.prepare(`
    SELECT t.*, u.display_name AS author_name
    FROM comment_threads t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.board_id = ?
    ORDER BY t.created_at ASC
  `).all(boardId);
}

function getThread(threadId) {
  return db.prepare('SELECT * FROM comment_threads WHERE id = ?').get(threadId);
}

function createThread({ id, boardId, objectId, anchorType, pinX, pinY, createdBy }) {
  db.prepare(`
    INSERT INTO comment_threads (id, board_id, object_id, anchor_type, pin_x, pin_y, created_by, last_commented_at, last_commented_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(id, boardId, objectId, anchorType, pinX ?? null, pinY ?? null, createdBy, createdBy);
  return getThread(id);
}

function updateThreadStatus(threadId, status, resolvedBy) {
  if (status === 'resolved') {
    db.prepare(`
      UPDATE comment_threads SET status = ?, resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(status, resolvedBy, threadId);
  } else {
    db.prepare(`
      UPDATE comment_threads SET status = ?, resolved_by = NULL, resolved_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, threadId);
  }
  return getThread(threadId);
}

function deleteThread(threadId) {
  db.prepare('DELETE FROM comment_threads WHERE id = ?').run(threadId);
}

function incrementThreadCommentCount(threadId, userId) {
  db.prepare(`
    UPDATE comment_threads
    SET comment_count = comment_count + 1,
        last_commented_at = datetime('now'),
        last_commented_by = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(userId, threadId);
}

function decrementThreadCommentCount(threadId) {
  db.prepare(`
    UPDATE comment_threads
    SET comment_count = MAX(0, comment_count - 1),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(threadId);
}

// ── Comment queries ──
function getCommentsByThread(threadId) {
  return db.prepare('SELECT * FROM comments WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);
}

function getCommentsByBoard(boardId) {
  return db.prepare(`
    SELECT c.* FROM comments c
    JOIN comment_threads t ON t.id = c.thread_id
    WHERE t.board_id = ?
    ORDER BY c.created_at ASC
  `).all(boardId);
}

function getComment(commentId) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
}

function createComment({ id, threadId, userId, authorName, authorColor, content }) {
  db.prepare(`
    INSERT INTO comments (id, thread_id, user_id, author_name, author_color, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, threadId, userId, authorName, authorColor ?? null, content);
  return getComment(id);
}

function updateComment(commentId, content) {
  db.prepare(`
    UPDATE comments SET content = ?, edited_at = datetime('now') WHERE id = ?
  `).run(content, commentId);
  return getComment(commentId);
}

function deleteComment(commentId) {
  db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}
```

**Step 3: Export the new functions**

Add to the `module.exports` block:

```javascript
  // Threads
  getThreadsByBoard, getThread, createThread, updateThreadStatus, deleteThread,
  incrementThreadCommentCount, decrementThreadCommentCount,
  // Comments
  getCommentsByThread, getCommentsByBoard, getComment, createComment, updateComment, deleteComment,
```

**Step 4: Verify the server starts**

Run: `cd backend && node -e "require('./db'); console.log('DB OK')"`
Expected: `DB OK` (tables created, no errors)

**Step 5: Commit**

```bash
git add backend/db.js
git commit -m "feat(annotations): add comment_threads and comments tables + queries"
```

---

### Task 2: Threads & Comments REST Endpoints

**Files:**
- Create: `backend/routes/threads.js`
- Modify: `backend/server.js` (mount route)

**Step 1: Create the threads route file**

Create `backend/routes/threads.js`:

```javascript
const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../auth');
const {
  getBoard,
  getCollection,
  getCollectionMember,
  getThreadsByBoard,
  getThread,
  createThread,
  updateThreadStatus,
  deleteThread,
  getCommentsByBoard,
  getComment,
  createComment,
  updateComment,
  deleteComment,
  incrementThreadCommentCount,
  decrementThreadCommentCount,
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

// GET /api/boards/:boardId/threads — all threads + comments for board
router.get('/:boardId/threads', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const threads = getThreadsByBoard(req.params.boardId);
    const comments = getCommentsByBoard(req.params.boardId);

    // Group comments by thread
    const commentsByThread = {};
    for (const c of comments) {
      if (!commentsByThread[c.thread_id]) commentsByThread[c.thread_id] = [];
      commentsByThread[c.thread_id].push(c);
    }

    const data = threads.map((t) => ({
      ...t,
      comments: commentsByThread[t.id] || [],
    }));

    return res.json({ threads: data });
  } catch (err) {
    console.error('[threads] list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/threads — create thread + first comment
router.post('/:boardId/threads', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const { object_id, anchor_type, pin_x, pin_y, content } = req.body;
    if (!object_id || !content || !content.trim()) {
      return res.status(400).json({ error: 'object_id and content are required' });
    }

    const threadId = uuidv4();
    const commentId = uuidv4();
    const userId = req.user.id;

    const thread = createThread({
      id: threadId,
      boardId: req.params.boardId,
      objectId: object_id,
      anchorType: anchor_type || 'object',
      pinX: pin_x,
      pinY: pin_y,
      createdBy: userId,
    });

    const comment = createComment({
      id: commentId,
      threadId,
      userId,
      authorName: req.user.display_name || req.user.username,
      authorColor: null,
      content: content.trim(),
    });

    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('thread:add', {
        boardId: req.params.boardId,
        thread,
        comment,
      });
    }

    return res.status(201).json({ thread, comment });
  } catch (err) {
    console.error('[threads] create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/boards/:boardId/threads/:threadId — update thread status
router.patch('/:boardId/threads/:threadId', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'editor');
    if (!result) return;

    const { status } = req.body;
    if (!['open', 'resolved', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const thread = getThread(req.params.threadId);
    if (!thread || thread.board_id !== req.params.boardId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const updated = updateThreadStatus(req.params.threadId, status, req.user.id);

    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('thread:status', {
        boardId: req.params.boardId,
        threadId: req.params.threadId,
        status: updated.status,
        resolvedBy: updated.resolved_by,
        resolvedAt: updated.resolved_at,
      });
    }

    return res.json({ thread: updated });
  } catch (err) {
    console.error('[threads] status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:boardId/threads/:threadId — delete thread + all comments
router.delete('/:boardId/threads/:threadId', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'owner');
    if (!result) return;

    const thread = getThread(req.params.threadId);
    if (!thread || thread.board_id !== req.params.boardId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    deleteThread(req.params.threadId);

    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('thread:delete', {
        boardId: req.params.boardId,
        threadId: req.params.threadId,
      });
    }

    return res.json({ message: 'Thread deleted' });
  } catch (err) {
    console.error('[threads] delete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/threads/:threadId/comments — add reply
router.post('/:boardId/threads/:threadId/comments', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const thread = getThread(req.params.threadId);
    if (!thread || thread.board_id !== req.params.boardId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const commentId = uuidv4();
    const userId = req.user.id;

    const comment = createComment({
      id: commentId,
      threadId: req.params.threadId,
      userId,
      authorName: req.user.display_name || req.user.username,
      authorColor: null,
      content: content.trim(),
    });

    incrementThreadCommentCount(req.params.threadId, userId);

    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('comment:add', {
        boardId: req.params.boardId,
        threadId: req.params.threadId,
        comment,
      });
    }

    return res.status(201).json({ comment });
  } catch (err) {
    console.error('[threads] add comment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:boardId/threads/:threadId/comments/:commentId — edit own comment
router.put('/:boardId/threads/:threadId/comments/:commentId', (req, res) => {
  try {
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const comment = getComment(req.params.commentId);
    if (!comment || comment.thread_id !== req.params.threadId) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (comment.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Can only edit own comments' });
    }

    const updated = updateComment(req.params.commentId, content.trim());

    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('comment:update', {
        boardId: req.params.boardId,
        threadId: req.params.threadId,
        commentId: req.params.commentId,
        content: updated.content,
        editedAt: updated.edited_at,
      });
    }

    return res.json({ comment: updated });
  } catch (err) {
    console.error('[threads] edit comment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:boardId/threads/:threadId/comments/:commentId — delete own comment
router.delete('/:boardId/threads/:threadId/comments/:commentId', (req, res) => {
  try {
    // Owner can delete any comment, others only their own
    const result = resolveBoard(req, res, 'viewer');
    if (!result) return;

    const comment = getComment(req.params.commentId);
    if (!comment || comment.thread_id !== req.params.threadId) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const isOwner = hasCollectionRole(result.member, 'owner');
    if (comment.user_id !== req.user.id && !isOwner) {
      return res.status(403).json({ error: 'Can only delete own comments' });
    }

    deleteComment(req.params.commentId);
    decrementThreadCommentCount(req.params.threadId);

    const io = req.app.get('io');
    if (io) {
      io.to(`board:${req.params.boardId}`).emit('comment:delete', {
        boardId: req.params.boardId,
        threadId: req.params.threadId,
        commentId: req.params.commentId,
      });
    }

    return res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('[threads] delete comment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

**Step 2: Mount the route in server.js**

In `backend/server.js`, add after the existing route imports (around line 101):

```javascript
const threadRoutes = require('./routes/threads');
```

And after the existing `app.use('/api/boards', ...)` lines (around line 109):

```javascript
app.use('/api/boards', threadRoutes);
```

**Step 3: Store io reference on app for routes to access**

In `backend/server.js`, after `const io = setupSocket(server);` (around line 153), add:

```javascript
app.set('io', io);
```

**Step 4: Verify server starts and route is accessible**

Run: `cd backend && node -e "require('./server');"` (should start without errors)

**Step 5: Commit**

```bash
git add backend/routes/threads.js backend/server.js
git commit -m "feat(annotations): add threads & comments REST endpoints with socket broadcast"
```

---

### Task 3: Votes Backend — Table + REST + Socket

**Files:**
- Modify: `backend/db.js`
- Create: `backend/routes/votes.js`
- Modify: `backend/server.js`

**Step 1: Add object_votes table to db.js**

Add after the comments table creation:

```javascript
// ── Object Votes ──
db.exec(`
  CREATE TABLE IF NOT EXISTS object_votes (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (board_id, object_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_votes_object ON object_votes(board_id, object_id);
`);
```

**Step 2: Add vote query helpers to db.js**

```javascript
// ── Vote queries ──
function getVotesByBoard(boardId) {
  return db.prepare('SELECT * FROM object_votes WHERE board_id = ?').all(boardId);
}

function toggleVote(boardId, objectId, userId) {
  const existing = db.prepare(
    'SELECT 1 FROM object_votes WHERE board_id = ? AND object_id = ? AND user_id = ?'
  ).get(boardId, objectId, userId);

  if (existing) {
    db.prepare('DELETE FROM object_votes WHERE board_id = ? AND object_id = ? AND user_id = ?')
      .run(boardId, objectId, userId);
    return false; // vote removed
  } else {
    db.prepare('INSERT INTO object_votes (board_id, object_id, user_id) VALUES (?, ?, ?)')
      .run(boardId, objectId, userId);
    return true; // vote added
  }
}
```

Export them:

```javascript
  // Votes
  getVotesByBoard, toggleVote,
```

**Step 3: Create votes route file**

Create `backend/routes/votes.js`:

```javascript
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
```

**Step 4: Mount in server.js**

```javascript
const voteRoutes = require('./routes/votes');
app.use('/api/boards', voteRoutes);
```

**Step 5: Commit**

```bash
git add backend/db.js backend/routes/votes.js backend/server.js
git commit -m "feat(annotations): add object_votes table, toggle endpoint, socket broadcast"
```

---

## Phase 2: Frontend State & Data Layer

### Task 4: Annotation Store — Thread & Vote State Management

**Files:**
- Create: `frontend/src/stores/annotationStore.ts`

**Step 1: Create the store**

This store holds all threads, comments, and votes for the current board. It's a plain class with methods that the socket handlers and panel components call.

```typescript
export interface Thread {
  id: string;
  board_id: string;
  object_id: string;
  anchor_type: 'object' | 'point';
  pin_x: number | null;
  pin_y: number | null;
  status: 'open' | 'resolved' | 'archived';
  resolved_by: string | null;
  resolved_at: string | null;
  comment_count: number;
  last_commented_at: string | null;
  last_commented_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  comments: Comment[];
}

export interface Comment {
  id: string;
  thread_id: string;
  user_id: string;
  author_name: string;
  author_color: string | null;
  content: string;
  edited_at: string | null;
  created_at: string;
}

export interface Vote {
  board_id: string;
  object_id: string;
  user_id: string;
}

type Listener = () => void;

export class AnnotationStore {
  threads = new Map<string, Thread>();
  /** objectId → Set<userId> */
  votes = new Map<string, Set<string>>();

  private _listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    for (const fn of this._listeners) fn();
  }

  // ── Bulk load ──

  loadThreads(threads: Thread[]) {
    this.threads.clear();
    for (const t of threads) {
      this.threads.set(t.id, t);
    }
    this._notify();
  }

  loadVotes(votes: Vote[]) {
    this.votes.clear();
    for (const v of votes) {
      if (!this.votes.has(v.object_id)) this.votes.set(v.object_id, new Set());
      this.votes.get(v.object_id)!.add(v.user_id);
    }
    this._notify();
  }

  clear() {
    this.threads.clear();
    this.votes.clear();
    this._notify();
  }

  // ── Socket event handlers ──

  onThreadAdd(thread: Thread, comment: Comment) {
    thread.comments = [comment];
    this.threads.set(thread.id, thread);
    this._notify();
  }

  onThreadStatus(threadId: string, status: string, resolvedBy: string | null, resolvedAt: string | null) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.status = status as Thread['status'];
    t.resolved_by = resolvedBy;
    t.resolved_at = resolvedAt;
    this._notify();
  }

  onThreadDelete(threadId: string) {
    this.threads.delete(threadId);
    this._notify();
  }

  onCommentAdd(threadId: string, comment: Comment) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.comments.push(comment);
    t.comment_count = t.comments.length;
    t.last_commented_at = comment.created_at;
    t.last_commented_by = comment.user_id;
    this._notify();
  }

  onCommentUpdate(threadId: string, commentId: string, content: string, editedAt: string) {
    const t = this.threads.get(threadId);
    if (!t) return;
    const c = t.comments.find((c) => c.id === commentId);
    if (c) {
      c.content = content;
      c.edited_at = editedAt;
    }
    this._notify();
  }

  onCommentDelete(threadId: string, commentId: string) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.comments = t.comments.filter((c) => c.id !== commentId);
    t.comment_count = t.comments.length;
    this._notify();
  }

  onVoteToggle(objectId: string, userId: string, active: boolean) {
    if (!this.votes.has(objectId)) this.votes.set(objectId, new Set());
    const set = this.votes.get(objectId)!;
    if (active) set.add(userId); else set.delete(userId);
    if (set.size === 0) this.votes.delete(objectId);
    this._notify();
  }

  // ── Convenience getters ──

  getThreadsForObject(objectId: string): Thread[] {
    const result: Thread[] = [];
    for (const t of this.threads.values()) {
      if (t.object_id === objectId) result.push(t);
    }
    return result;
  }

  getVoteCount(objectId: string): number {
    return this.votes.get(objectId)?.size ?? 0;
  }

  hasVoted(objectId: string, userId: string): boolean {
    return this.votes.get(objectId)?.has(userId) ?? false;
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/stores/annotationStore.ts
git commit -m "feat(annotations): add AnnotationStore for threads, comments, and votes"
```

---

### Task 5: Wire Annotation Store to Board Lifecycle

**Files:**
- Modify: `frontend/src/hooks/useCanvasSetup.ts`
- Modify: `frontend/src/pages/Editor.tsx`

**Step 1: Create and load the store in useCanvasSetup.ts**

At the top of useCanvasSetup.ts, import:

```typescript
import { AnnotationStore } from '../stores/annotationStore';
```

Inside the hook, create a ref for the store:

```typescript
const annotationStoreRef = useRef<AnnotationStore | null>(null);
if (!annotationStoreRef.current) annotationStoreRef.current = new AnnotationStore();
```

**Step 2: Load threads and votes on board open**

After the board data is loaded (where socket connects and `board:join` fires), add two fetch calls:

```typescript
// Load annotations
fetch(`/api/boards/${resolvedBoardId}/threads`, {
  headers: { Authorization: `Bearer ${token}` },
})
  .then((r) => r.json())
  .then((data) => {
    if (data.threads) annotationStoreRef.current?.loadThreads(data.threads);
  })
  .catch((err) => console.error('[annotations] load threads error:', err));

fetch(`/api/boards/${resolvedBoardId}/votes`, {
  headers: { Authorization: `Bearer ${token}` },
})
  .then((r) => r.json())
  .then((data) => {
    if (data.votes) annotationStoreRef.current?.loadVotes(data.votes);
  })
  .catch((err) => console.error('[annotations] load votes error:', err));
```

**Step 3: Wire socket event handlers**

After the existing socket event listeners (after `socket.on('media:job:update', ...)`), add:

```typescript
socket.on('thread:add', (data: any) => {
  annotationStoreRef.current?.onThreadAdd(data.thread, data.comment);
});
socket.on('thread:status', (data: any) => {
  annotationStoreRef.current?.onThreadStatus(data.threadId, data.status, data.resolvedBy, data.resolvedAt);
});
socket.on('thread:delete', (data: any) => {
  annotationStoreRef.current?.onThreadDelete(data.threadId);
});
socket.on('comment:add', (data: any) => {
  annotationStoreRef.current?.onCommentAdd(data.threadId, data.comment);
});
socket.on('comment:update', (data: any) => {
  annotationStoreRef.current?.onCommentUpdate(data.threadId, data.commentId, data.content, data.editedAt);
});
socket.on('comment:delete', (data: any) => {
  annotationStoreRef.current?.onCommentDelete(data.threadId, data.commentId);
});
socket.on('vote:toggle', (data: any) => {
  annotationStoreRef.current?.onVoteToggle(data.objectId, data.userId, data.active);
});
```

**Step 4: Return annotationStore from hook and expose in Editor**

Add `annotationStore: annotationStoreRef.current` to the hook's return value. In Editor.tsx, destructure it and pass it down to the FeedbackPanel (created in Task 7).

**Step 5: Clean up socket listeners on unmount**

In the cleanup function of the useEffect, add `socket.off(...)` for each of the 7 annotation events.

**Step 6: Commit**

```bash
git add frontend/src/hooks/useCanvasSetup.ts frontend/src/pages/Editor.tsx
git commit -m "feat(annotations): wire AnnotationStore to board lifecycle + socket events"
```

---

## Phase 3: Feedback Panel

### Task 6: FeedbackPanel Component — Overview & Thread List

**Files:**
- Create: `frontend/src/components/FeedbackPanel.tsx`

**Step 1: Create the panel component**

Follow the same pattern as LayerPanel.tsx: absolute positioned, right side, 280px wide, collapsible.

```typescript
import React, { useState, useCallback, useSyncExternalStore } from 'react';
import { AnnotationStore, Thread } from '../stores/annotationStore';

interface FeedbackPanelProps {
  annotationStore: AnnotationStore;
  selectedObjectId: string | null;
  userId: string;
  boardId: string;
  token: string;
  canvasObjects: Map<string, { id: string; name?: string; type: string }>;
}

export default function FeedbackPanel({
  annotationStore,
  selectedObjectId,
  userId,
  boardId,
  token,
  canvasObjects,
}: FeedbackPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'mine'>('unresolved');

  // Subscribe to store changes
  const _version = useSyncExternalStore(
    (cb) => annotationStore.subscribe(cb),
    () => annotationStore.threads.size + annotationStore.votes.size,
  );

  const allThreads = Array.from(annotationStore.threads.values());

  // Apply filter
  let threads = allThreads;
  if (filter === 'unresolved') threads = threads.filter((t) => t.status === 'open');
  if (filter === 'mine') threads = threads.filter((t) => t.created_by === userId);

  // If an object is selected, show only its threads
  if (selectedObjectId) {
    threads = threads.filter((t) => t.object_id === selectedObjectId);
  }

  // Sort: newest activity first
  threads.sort((a, b) => (b.last_commented_at || b.created_at).localeCompare(a.last_commented_at || a.created_at));

  // ── API helpers ──

  const postReply = useCallback(async (threadId: string) => {
    if (!replyText.trim()) return;
    await fetch(`/api/boards/${boardId}/threads/${threadId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: replyText.trim() }),
    });
    setReplyText('');
  }, [boardId, token, replyText]);

  const resolveThread = useCallback(async (threadId: string, status: string) => {
    await fetch(`/api/boards/${boardId}/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
  }, [boardId, token]);

  const deleteComment = useCallback(async (threadId: string, commentId: string) => {
    await fetch(`/api/boards/${boardId}/threads/${threadId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [boardId, token]);

  // ── Collapsed state ──

  if (collapsed) {
    return (
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '28px',
        background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8px',
      }}>
        <button onClick={() => setCollapsed(false)} style={{
          background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: '14px',
        }} title="Open feedback panel">
          💬
        </button>
      </div>
    );
  }

  // ── Expanded thread view ──

  const expandedThread = expandedThreadId ? annotationStore.threads.get(expandedThreadId) : null;

  if (expandedThread) {
    return (
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '280px',
        background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
        display: 'flex', flexDirection: 'column', userSelect: 'none',
      }}>
        {/* Header */}
        <div style={{ padding: '8px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setExpandedThreadId(null)} style={{
            background: 'none', border: 'none', color: '#777', cursor: 'pointer',
          }}>← Back</button>
          <span style={{ color: '#aaa', fontSize: '12px', flex: 1 }}>
            {expandedThread.status === 'resolved' ? '✓ Resolved' : 'Open'}
          </span>
          {expandedThread.status === 'open' ? (
            <button onClick={() => resolveThread(expandedThread.id, 'resolved')} style={{
              background: '#1a3a1a', border: 'none', borderRadius: '4px', color: '#4a4',
              padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
            }}>Resolve</button>
          ) : (
            <button onClick={() => resolveThread(expandedThread.id, 'open')} style={{
              background: '#1a1a3a', border: 'none', borderRadius: '4px', color: '#77a',
              padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
            }}>Reopen</button>
          )}
        </div>

        {/* Comments */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {expandedThread.comments.map((c) => (
            <div key={c.id} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ color: '#ddd', fontSize: '12px', fontWeight: 600 }}>{c.author_name}</span>
                <span style={{ color: '#555', fontSize: '10px' }}>
                  {new Date(c.created_at).toLocaleString()}
                </span>
                {c.edited_at && <span style={{ color: '#555', fontSize: '10px' }}>(edited)</span>}
              </div>
              <div style={{ color: '#bbb', fontSize: '13px', lineHeight: '1.4' }}>{c.content}</div>
              {c.user_id === userId && (
                <button onClick={() => deleteComment(expandedThread.id, c.id)} style={{
                  background: 'none', border: 'none', color: '#644', cursor: 'pointer', fontSize: '10px', marginTop: '2px',
                }}>Delete</button>
              )}
            </div>
          ))}
        </div>

        {/* Reply input */}
        <div style={{ padding: '8px', borderTop: '1px solid #1a1a1a' }}>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply..."
            rows={2}
            style={{
              width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px',
              color: '#ddd', padding: '6px', fontSize: '12px', resize: 'none',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                postReply(expandedThread.id);
              }
            }}
          />
          <button onClick={() => postReply(expandedThread.id)} style={{
            marginTop: '4px', background: '#2a3a50', border: 'none', borderRadius: '4px',
            color: '#4a9eff', padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
          }}>Reply</button>
        </div>
      </div>
    );
  }

  // ── Thread list view ──

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: '280px',
      background: '#111', borderLeft: '1px solid #1a1a1a', zIndex: 100,
      display: 'flex', flexDirection: 'column', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{ padding: '8px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#ddd', fontSize: '13px', fontWeight: 600 }}>Feedback</span>
        <button onClick={() => setCollapsed(true)} style={{
          background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '14px',
        }}>✕</button>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '4px' }}>
        {(['unresolved', 'all', 'mine'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? '#2a3a50' : 'transparent',
            border: 'none', borderRadius: '4px', color: filter === f ? '#4a9eff' : '#555',
            padding: '2px 8px', cursor: 'pointer', fontSize: '11px', textTransform: 'capitalize',
          }}>{f}</button>
        ))}
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {threads.length === 0 && (
          <div style={{ padding: '16px', color: '#444', fontSize: '12px', textAlign: 'center' }}>
            No threads yet
          </div>
        )}
        {threads.map((t) => {
          const obj = canvasObjects.get(t.object_id);
          const firstComment = t.comments[0];
          return (
            <div
              key={t.id}
              onClick={() => setExpandedThreadId(t.id)}
              style={{
                padding: '8px', borderBottom: '1px solid #1a1a1a', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#1a1a1a'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: t.status === 'open' ? '#e44' : '#666', flexShrink: 0,
                }} />
                <span style={{ color: '#aaa', fontSize: '11px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {obj?.name || obj?.type || t.object_id.slice(0, 8)}
                </span>
                <span style={{ color: '#555', fontSize: '10px' }}>{t.comment_count}</span>
              </div>
              {firstComment && (
                <div style={{ color: '#777', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {firstComment.author_name}: {firstComment.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/FeedbackPanel.tsx
git commit -m "feat(annotations): add FeedbackPanel component with thread list, expanded view, replies"
```

---

### Task 7: Integrate FeedbackPanel into Editor

**Files:**
- Modify: `frontend/src/pages/Editor.tsx`
- Modify: `frontend/src/components/Toolbar.tsx`

**Step 1: Add Review Mode toggle state to Editor**

In Editor.tsx, add:

```typescript
const [reviewMode, setReviewMode] = useState(false);
const [feedbackPanelOpen, setFeedbackPanelOpen] = useState(false);
```

**Step 2: Pass reviewMode toggle to Toolbar**

Add a new prop to Toolbar for the review mode toggle. In Toolbar.tsx, add a new ActionBtn in the right action group:

```typescript
<ActionBtn
  onClick={() => onToggleReview()}
  title="Review Mode (R)"
  active={reviewMode}
>
  {/* Comment bubble SVG icon */}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3-3h7a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H2z"/>
  </svg>
</ActionBtn>
```

Add `onToggleReview: () => void` and `reviewMode: boolean` to Toolbar props interface.

**Step 3: Render FeedbackPanel in Editor**

When `reviewMode || feedbackPanelOpen` is true, render FeedbackPanel next to the canvas:

```typescript
{(reviewMode || feedbackPanelOpen) && annotationStore && (
  <FeedbackPanel
    annotationStore={annotationStore}
    selectedObjectId={selectedIds.length === 1 ? selectedIds[0] : null}
    userId={user.id}
    boardId={boardId}
    token={token}
    canvasObjects={canvasObjectMap}
  />
)}
```

Where `canvasObjectMap` is derived from the scene items.

**Step 4: Wire keyboard shortcut**

In the existing keydown handler, add `R` key to toggle review mode (when not in text input).

**Step 5: Commit**

```bash
git add frontend/src/pages/Editor.tsx frontend/src/components/Toolbar.tsx
git commit -m "feat(annotations): integrate FeedbackPanel + Review Mode toggle in Editor/Toolbar"
```

---

## Phase 4: Canvas Pin Overlay

### Task 8: Pin Overlay Container + Pin Rendering

**Files:**
- Create: `frontend/src/canvas/PinOverlay.ts`
- Modify: `frontend/src/hooks/useCanvasSetup.ts`

**Step 1: Create PinOverlay class**

This is a PixiJS Container that renders pin markers for threads. Pins are scale-independent circles positioned in world space, derived from object bounds.

```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { AnnotationStore, Thread } from '../stores/annotationStore';
import type { SceneManager } from './SceneManager';

const PIN_RADIUS = 10;
const PIN_COLOR_OPEN = 0xee4444;
const PIN_COLOR_RESOLVED = 0x666666;

export class PinOverlay extends Container {
  private _pins = new Map<string, Graphics>();
  private _viewport: Viewport;
  private _scene: SceneManager;
  private _store: AnnotationStore;

  constructor(viewport: Viewport, scene: SceneManager, store: AnnotationStore) {
    super();
    this._viewport = viewport;
    this._scene = scene;
    this._store = store;
  }

  /** Call on every viewport moved/zoomed event and on store change */
  refresh(showResolved = false) {
    const scale = 1 / this._viewport.scale.x; // scale-independent size

    // Remove old pins
    for (const [id, gfx] of this._pins) {
      gfx.destroy();
    }
    this._pins.clear();
    this.removeChildren();

    for (const thread of this._store.threads.values()) {
      if (thread.status === 'resolved' && !showResolved) continue;

      const item = this._scene.items.get(thread.object_id);
      if (!item) continue; // orphaned — skip on canvas

      const bounds = item.sprite.getBounds();
      let wx: number, wy: number;

      if (thread.anchor_type === 'point' && thread.pin_x != null && thread.pin_y != null) {
        wx = bounds.x + thread.pin_x * bounds.width;
        wy = bounds.y + thread.pin_y * bounds.height;
      } else {
        // Object-level: top-right corner
        wx = bounds.x + bounds.width;
        wy = bounds.y;
      }

      const gfx = new Graphics();
      const r = PIN_RADIUS * scale;
      const color = thread.status === 'open' ? PIN_COLOR_OPEN : PIN_COLOR_RESOLVED;

      gfx.circle(0, 0, r);
      gfx.fill({ color, alpha: 0.9 });
      gfx.stroke({ color: 0xffffff, width: 1.5 * scale, alpha: 0.8 });
      gfx.position.set(wx, wy);

      // Count label
      if (thread.comment_count > 1) {
        const label = new Text({
          text: String(thread.comment_count),
          style: new TextStyle({
            fontSize: 9 * scale,
            fill: '#ffffff',
            fontWeight: 'bold',
          }),
        });
        label.anchor.set(0.5);
        gfx.addChild(label);
      }

      gfx.eventMode = 'static';
      gfx.cursor = 'pointer';
      // Store threadId for click handling
      (gfx as any)._threadId = thread.id;

      this._pins.set(thread.id, gfx);
      this.addChild(gfx);
    }
  }

  getThreadIdAtPoint(worldX: number, worldY: number): string | null {
    for (const [threadId, gfx] of this._pins) {
      const dx = gfx.position.x - worldX;
      const dy = gfx.position.y - worldY;
      const hitRadius = PIN_RADIUS / this._viewport.scale.x;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return threadId;
      }
    }
    return null;
  }

  destroy() {
    for (const gfx of this._pins.values()) gfx.destroy();
    this._pins.clear();
    super.destroy();
  }
}
```

**Step 2: Add PinOverlay to viewport in useCanvasSetup**

After viewport and scene are created, and when reviewMode is true:

```typescript
// Create pin overlay
const pinOverlay = new PinOverlay(viewport, scene, annotationStoreRef.current!);
viewport.addChild(pinOverlay);

// Refresh on viewport move
viewport.on('moved', () => { if (reviewMode) pinOverlay.refresh(); });

// Refresh on store change
annotationStoreRef.current!.subscribe(() => { if (reviewMode) pinOverlay.refresh(); });
```

**Step 3: Commit**

```bash
git add frontend/src/canvas/PinOverlay.ts frontend/src/hooks/useCanvasSetup.ts
git commit -m "feat(annotations): add PinOverlay with scale-independent pin markers"
```

---

### Task 9: Pin Placement Subtool

**Files:**
- Modify: `frontend/src/canvas/PinOverlay.ts`
- Modify: `frontend/src/hooks/useCanvasSetup.ts`
- Modify: `frontend/src/pages/Editor.tsx`

**Step 1: Add "Place Comment" mode**

When Review Mode is active and the user clicks the "Place comment" button in the toolbar, the cursor changes to crosshair. On click:

1. Hit-test scene objects at click point
2. If hit: calculate relative pin_x/pin_y within object bounds
3. Open a small inline text input at click position (or open panel with pre-filled object_id + pin coords)
4. On submit: POST to `/api/boards/:boardId/threads` with `{ object_id, anchor_type: 'point', pin_x, pin_y, content }`

**Step 2: Add placeComment callback to Editor state**

```typescript
const [placingComment, setPlacingComment] = useState(false);
```

When `placingComment` is true, canvas click handler does hit-test → opens a floating comment input positioned near the click.

**Step 3: Floating comment input component**

Create a small absolute-positioned textarea that appears at the click location (screen coords). On Enter/submit, calls the create thread API and resets state.

**Step 4: Commit**

```bash
git add frontend/src/canvas/PinOverlay.ts frontend/src/hooks/useCanvasSetup.ts frontend/src/pages/Editor.tsx
git commit -m "feat(annotations): add pin placement subtool with floating comment input"
```

---

### Task 10: Vote Badge on Canvas

**Files:**
- Modify: `frontend/src/canvas/PinOverlay.ts`

**Step 1: Add vote badges to PinOverlay.refresh()**

After rendering thread pins, also render vote badges for objects that have votes:

```typescript
for (const [objectId, voters] of this._store.votes) {
  if (voters.size === 0) continue;
  const item = this._scene.items.get(objectId);
  if (!item) continue;

  const bounds = item.sprite.getBounds();
  const wx = bounds.x + bounds.width;
  const wy = bounds.y + bounds.height;

  const gfx = new Graphics();
  const scale = 1 / this._viewport.scale.x;
  // Pill shape
  gfx.roundRect(-12 * scale, -8 * scale, 24 * scale, 16 * scale, 4 * scale);
  gfx.fill({ color: 0x2a3a50, alpha: 0.9 });
  gfx.position.set(wx - 16 * scale, wy - 4 * scale);

  const label = new Text({
    text: `▲ ${voters.size}`,
    style: new TextStyle({ fontSize: 9 * scale, fill: '#4a9eff', fontWeight: 'bold' }),
  });
  label.anchor.set(0.5);
  gfx.addChild(label);
  this.addChild(gfx);
}
```

**Step 2: Commit**

```bash
git add frontend/src/canvas/PinOverlay.ts
git commit -m "feat(annotations): add vote count badges to canvas overlay"
```

---

### Task 11: Vote Button in FeedbackPanel

**Files:**
- Modify: `frontend/src/components/FeedbackPanel.tsx`

**Step 1: Add vote toggle button**

In the thread list view, add a vote button per object group. In the expanded thread view, add a vote button at the top.

```typescript
const toggleVote = useCallback(async (objectId: string) => {
  await fetch(`/api/boards/${boardId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ object_id: objectId }),
  });
}, [boardId, token]);
```

Render next to each object name:

```typescript
<button onClick={(e) => { e.stopPropagation(); toggleVote(t.object_id); }} style={{
  background: 'none', border: 'none', cursor: 'pointer',
  color: annotationStore.hasVoted(t.object_id, userId) ? '#4a9eff' : '#444',
  fontSize: '12px',
}}>
  ▲ {annotationStore.getVoteCount(t.object_id)}
</button>
```

**Step 2: Commit**

```bash
git add frontend/src/components/FeedbackPanel.tsx
git commit -m "feat(annotations): add vote toggle button in FeedbackPanel"
```

---

## Phase 5: Polish

### Task 12: Jump-to-Object from Thread

**Files:**
- Modify: `frontend/src/components/FeedbackPanel.tsx`

**Step 1: Add jumpToObject callback prop**

Add to FeedbackPanelProps:

```typescript
onJumpToObject: (objectId: string) => void;
```

In the expanded thread view, add a "Jump to" button:

```typescript
<button onClick={() => onJumpToObject(expandedThread.object_id)} style={{...}}>
  Jump to object
</button>
```

**Step 2: Implement in Editor.tsx**

The callback should call `viewport.snap()` or `viewport.animate()` to center on the object:

```typescript
const jumpToObject = useCallback((objectId: string) => {
  const viewport = canvasRef.current?.getViewport();
  const scene = canvasRef.current?.getScene();
  if (!viewport || !scene) return;

  const item = scene.items.get(objectId);
  if (!item) return;

  const bounds = item.sprite.getBounds();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  viewport.animate({ position: { x: cx, y: cy }, time: 300 });
}, []);
```

**Step 3: Commit**

```bash
git add frontend/src/components/FeedbackPanel.tsx frontend/src/pages/Editor.tsx
git commit -m "feat(annotations): add jump-to-object from thread view"
```

---

### Task 13: Orphan Detection — Deleted Object Threads

**Files:**
- Modify: `frontend/src/components/FeedbackPanel.tsx`

**Step 1: Detect orphaned threads**

Threads whose `object_id` doesn't exist in `canvasObjects` are orphans:

```typescript
const orphanedThreads = allThreads.filter((t) => !canvasObjects.has(t.object_id));
const activeThreads = threads.filter((t) => canvasObjects.has(t.object_id));
```

**Step 2: Render orphans in collapsible section**

At the bottom of the thread list:

```typescript
{orphanedThreads.length > 0 && (
  <div>
    <div onClick={() => setShowOrphans(!showOrphans)} style={{
      padding: '8px', cursor: 'pointer', color: '#555', fontSize: '11px',
      borderTop: '1px solid #1a1a1a',
    }}>
      {showOrphans ? '▾' : '▸'} Deleted items ({orphanedThreads.length})
    </div>
    {showOrphans && orphanedThreads.map((t) => (
      /* same thread row rendering as above, but with dimmed style */
    ))}
  </div>
)}
```

**Step 3: Commit**

```bash
git add frontend/src/components/FeedbackPanel.tsx
git commit -m "feat(annotations): show orphaned threads for deleted objects in panel"
```

---

### Task 14: New Thread from Panel (Object-Level Comment)

**Files:**
- Modify: `frontend/src/components/FeedbackPanel.tsx`

**Step 1: Add "New comment" button when an object is selected**

At the top of the panel (when `selectedObjectId` is set), show a text input + submit button:

```typescript
const [newCommentText, setNewCommentText] = useState('');

const createThread = useCallback(async () => {
  if (!newCommentText.trim() || !selectedObjectId) return;
  await fetch(`/api/boards/${boardId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      object_id: selectedObjectId,
      anchor_type: 'object',
      content: newCommentText.trim(),
    }),
  });
  setNewCommentText('');
}, [boardId, token, selectedObjectId, newCommentText]);
```

Render above the thread list when an object is selected:

```typescript
{selectedObjectId && (
  <div style={{ padding: '8px', borderBottom: '1px solid #1a1a1a' }}>
    <textarea value={newCommentText} onChange={(e) => setNewCommentText(e.target.value)}
      placeholder="Add a comment on this object..."
      rows={2} style={{...}} />
    <button onClick={createThread} style={{...}}>Comment</button>
  </div>
)}
```

**Step 2: Commit**

```bash
git add frontend/src/components/FeedbackPanel.tsx
git commit -m "feat(annotations): add new thread creation from panel for selected object"
```

---

## Summary

| Task | Phase | What | Files |
|------|-------|------|-------|
| 1 | Backend | DB schema: comment_threads + comments | `backend/db.js` |
| 2 | Backend | REST endpoints + socket broadcast | `backend/routes/threads.js`, `backend/server.js` |
| 3 | Backend | Votes table + REST + socket | `backend/db.js`, `backend/routes/votes.js`, `backend/server.js` |
| 4 | Frontend | AnnotationStore class | `frontend/src/stores/annotationStore.ts` |
| 5 | Frontend | Wire store to board lifecycle + sockets | `frontend/src/hooks/useCanvasSetup.ts`, `frontend/src/pages/Editor.tsx` |
| 6 | Frontend | FeedbackPanel component | `frontend/src/components/FeedbackPanel.tsx` |
| 7 | Frontend | Integrate panel + Review Mode toggle | `frontend/src/pages/Editor.tsx`, `frontend/src/components/Toolbar.tsx` |
| 8 | Canvas | PinOverlay container + pin rendering | `frontend/src/canvas/PinOverlay.ts`, `frontend/src/hooks/useCanvasSetup.ts` |
| 9 | Canvas | Pin placement subtool | `frontend/src/canvas/PinOverlay.ts`, `frontend/src/hooks/useCanvasSetup.ts`, `frontend/src/pages/Editor.tsx` |
| 10 | Canvas | Vote badges on overlay | `frontend/src/canvas/PinOverlay.ts` |
| 11 | Panel | Vote button in panel | `frontend/src/components/FeedbackPanel.tsx` |
| 12 | Polish | Jump-to-object | `frontend/src/components/FeedbackPanel.tsx`, `frontend/src/pages/Editor.tsx` |
| 13 | Polish | Orphan detection | `frontend/src/components/FeedbackPanel.tsx` |
| 14 | Polish | New thread from panel | `frontend/src/components/FeedbackPanel.tsx` |
