const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../auth');
const {
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
const { hasCollectionRole, resolveBoard } = require('./board-access');

const router = Router();

router.use(authMiddleware);

const MAX_COMMENT_LENGTH = 5000;

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
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `Content too long (max ${MAX_COMMENT_LENGTH} chars)` });
    }
    if (anchor_type && !['object', 'point'].includes(anchor_type)) {
      return res.status(400).json({ error: 'anchor_type must be "object" or "point"' });
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
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `Content too long (max ${MAX_COMMENT_LENGTH} chars)` });
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
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `Content too long (max ${MAX_COMMENT_LENGTH} chars)` });
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
