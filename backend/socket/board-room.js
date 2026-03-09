const { getBoard, getCollection, getCollectionMember } = require('../db');

// Track active users per room: Map<roomName, Map<userId, userInfo>>
const activeUsers = new Map();

function getRoomName(boardId) {
  return `board:${boardId}`;
}

function getActiveUsersInRoom(roomName) {
  if (!activeUsers.has(roomName)) {
    activeUsers.set(roomName, new Map());
  }
  return activeUsers.get(roomName);
}

function setupBoardRoom(io, socket) {

  // ---- Join / Leave ----

  socket.on('board:join', ({ boardId }, callback) => {
    try {
      const board = getBoard(boardId);
      if (!board) return callback?.({ error: 'Board not found' });

      const collection = getCollection(board.collection_id);
      if (!collection) return callback?.({ error: 'Collection not found' });

      const member = getCollectionMember(board.collection_id, socket.userId);
      if (!member && !collection.is_public) return callback?.({ error: 'Access denied' });

      const roomName = getRoomName(boardId);

      // Leave any previous board room
      for (const room of socket.rooms) {
        if (room.startsWith('board:') && room !== roomName) {
          leaveRoom(io, socket, room);
        }
      }

      socket.join(roomName);
      socket.currentBoardId = boardId;

      const roomUsers = getActiveUsersInRoom(roomName);
      const userInfo = {
        id: socket.userId,
        display_name: socket.userDisplayName,
        email: socket.userEmail,
        role: member?.role || 'viewer',
      };
      roomUsers.set(socket.userId, userInfo);

      socket.to(roomName).emit('user:joined', userInfo);

      const users = Array.from(roomUsers.values());
      callback?.({ ok: true, users });

      console.log(`[socket] ${socket.userDisplayName} joined ${roomName} (${users.length} users)`);
    } catch (err) {
      console.error('[socket] board:join error:', err);
      callback?.({ error: 'Failed to join board' });
    }
  });

  socket.on('board:leave', ({ boardId }, callback) => {
    const roomName = getRoomName(boardId);
    leaveRoom(io, socket, roomName);
    callback?.({ ok: true });
  });

  // ---- Full scene sync (Excalidraw-style) ----

  socket.on('scene:update', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('scene:update', {
      ...data,
      userId: socket.userId,
    });
  });

  // ---- Incremental element sync (Excalidraw-style) ----

  socket.on('element:update', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('element:update', {
      ...data,
      userId: socket.userId,
    });
  });

  socket.on('element:remove', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('element:remove', {
      ...data,
      userId: socket.userId,
    });
  });

  // ---- Lightweight transform (during drag/resize/rotate) ----

  socket.on('object:transform', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('object:transform', {
      ...data,
      userId: socket.userId,
    });
  });

  // ---- Cursor movement ----

  socket.on('cursor:move', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('cursor:moved', {
      ...data,
      userId: socket.userId,
      displayName: socket.userDisplayName,
    });
  });

  // ---- Selection presence (broadcast what items a user has selected) ----

  socket.on('selection:update', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.volatile.to(roomName).emit('selection:update', {
      ...data,
      userId: socket.userId,
      displayName: socket.userDisplayName,
    });
  });

  // ---- Laser pointer ----

  socket.on('laser:move', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.volatile.to(roomName).emit('laser:move', { ...data, userId: socket.userId });
  });

  socket.on('laser:stop', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('laser:stop', { ...data, userId: socket.userId });
  });

  // ---- Disconnect cleanup ----

  socket.on('disconnect', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('board:')) {
        leaveRoom(io, socket, room);
      }
    }
    if (socket.currentBoardId) {
      const roomName = getRoomName(socket.currentBoardId);
      leaveRoom(io, socket, roomName);
    }
  });
}

function leaveRoom(io, socket, roomName) {
  socket.leave(roomName);

  const roomUsers = getActiveUsersInRoom(roomName);
  roomUsers.delete(socket.userId);

  socket.to(roomName).emit('user:left', {
    id: socket.userId,
    display_name: socket.userDisplayName,
  });

  if (roomUsers.size === 0) {
    activeUsers.delete(roomName);
  }

  if (socket.currentBoardId && roomName === getRoomName(socket.currentBoardId)) {
    socket.currentBoardId = null;
  }

  console.log(`[socket] ${socket.userDisplayName} left ${roomName}`);
}

module.exports = { setupBoardRoom };
