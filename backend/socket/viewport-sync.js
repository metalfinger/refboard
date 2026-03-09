/**
 * Viewport sync relay — broadcasts user viewport positions for follow mode.
 * Each user periodically emits their viewport state; this relays it to
 * everyone else in the same board room so followers can track in real-time.
 *
 * Kept separate from board-room.js to avoid conflicts.
 */

function getRoomName(boardId) {
  return `board:${boardId}`;
}

function setupViewportSync(io, socket) {
  // Relay viewport position to other users in the same board room
  socket.on('viewport:sync', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.volatile.to(roomName).emit('viewport:sync', {
      ...data,
      userId: socket.userId,
    });
  });

  // follow:start / follow:stop are informational — the server doesn't need
  // to gate viewport:sync relay (all users broadcast always, clients filter).
  // These events exist so the UI can show "X is following you" if desired.
  socket.on('follow:start', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('follow:start', {
      boardId: data.boardId,
      followerId: socket.userId,
      followerName: socket.userDisplayName,
      targetUserId: data.targetUserId,
    });
  });

  socket.on('follow:stop', (data) => {
    if (!socket.currentBoardId) return;
    const roomName = getRoomName(socket.currentBoardId);
    socket.to(roomName).emit('follow:stop', {
      boardId: data.boardId,
      followerId: socket.userId,
    });
  });
}

module.exports = { setupViewportSync };
