const { Server } = require('socket.io');
const { verifyToken } = require('../auth');
const { getUserById } = require('../db');
const { setupBoardRoom } = require('./board-room');

/**
 * Set up Socket.IO on the given HTTP server.
 * Returns the io instance.
 */
function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // JWT authentication middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = verifyToken(token);
      const user = getUserById(decoded.id);
      if (!user) {
        return next(new Error('User not found'));
      }

      // Store user info on socket
      socket.userId = user.id;
      socket.userEmail = user.email;
      socket.userDisplayName = user.display_name;
      socket.userRole = user.role;

      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // Handle connections
  io.on('connection', (socket) => {
    console.log(`[socket] User connected: ${socket.userDisplayName} (${socket.userId})`);

    // Set up board room handlers
    setupBoardRoom(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] User disconnected: ${socket.userDisplayName} (${reason})`);
    });
  });

  return io;
}

module.exports = { setupSocket };
