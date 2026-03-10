const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');

// ---- Load environment ----
const PORT = parseInt(process.env.PORT || '8000', 10);

// ---- Express app ----
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- Health check ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- Image proxy (MinIO → browser, optional resize via ?w=) ----
app.get('/api/images/*', async (req, res) => {
  try {
    const objectPath = req.params[0]; // everything after /api/images/
    if (!objectPath) return res.status(400).json({ error: 'Missing path' });
    const { minioClient, MINIO_BUCKET } = require('./minio');
    const stat = await minioClient.statObject(MINIO_BUCKET, objectPath);
    const contentType = stat.metaData?.['content-type'] || '';
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const stream = await minioClient.getObject(MINIO_BUCKET, objectPath);

    const maxW = parseInt(req.query.w, 10);
    const isImage = contentType.startsWith('image/') && !contentType.includes('svg');
    if (maxW > 0 && isImage) {
      // Resize on the fly with Sharp — cap width, preserve aspect ratio
      const sharp = require('sharp');
      const transform = sharp()
        .resize({ width: maxW, withoutEnlargement: true })
        .on('error', () => {
          // If sharp fails (e.g. unsupported format), just pipe original
          res.setHeader('Content-Type', contentType);
        });
      // Sharp outputs same format by default
      if (contentType) res.setHeader('Content-Type', contentType);
      stream.pipe(transform).pipe(res);
    } else {
      if (contentType) res.setHeader('Content-Type', contentType);
      stream.pipe(res);
    }
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
      return res.status(404).json({ error: 'Image not found' });
    }
    console.error('[server] image proxy error:', err);
    return res.status(500).json({ error: 'Failed to serve image' });
  }
});

// ---- User search (authenticated) ----
app.get('/api/users/search', (req, res) => {
  try {
    const { authMiddleware } = require('./auth');
    authMiddleware(req, res, () => {
      const { q } = req.query;
      if (!q || q.length < 1) return res.json({ users: [] });
      const { getAllUsers } = require('./db');
      const all = getAllUsers();
      const query = q.toLowerCase();
      const matched = all
        .filter(u => u.is_active &&
          (u.email.toLowerCase().includes(query) ||
           u.username.toLowerCase().includes(query) ||
           (u.display_name || '').toLowerCase().includes(query)))
        .slice(0, 10)
        .map(u => ({ id: u.id, email: u.email, username: u.username, display_name: u.display_name }));
      return res.json({ users: matched });
    });
  } catch (err) {
    console.error('[server] user search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- API routes ----
const authRoutes = require('./routes/auth');
const collectionRoutes = require('./routes/collections');
const boardRoutes = require('./routes/boards');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');
const mmBridgeRoutes = require('./routes/mattermost-bridge');

app.use('/api/auth', authRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/boards', mmBridgeRoutes);

// Public shared collection route (no auth required)
app.get('/api/c/:shareToken', (req, res) => {
  try {
    const { getCollectionByShareToken, getCollectionBoards } = require('./db');
    const collection = getCollectionByShareToken(req.params.shareToken);
    if (!collection || !collection.is_public) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    const boards = getCollectionBoards(collection.id);
    return res.json({ collection, boards });
  } catch (err) {
    console.error('[server] shared collection error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Static frontend files ----
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback — send index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Frontend not built yet' });
    }
  });
});

// ---- Global error handler ----
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Create HTTP server + Socket.IO ----
const server = http.createServer(app);

const { setupSocket } = require('./socket');
const io = setupSocket(server);

// ---- Initialize services and start ----
async function start() {
  require('./db');
  console.log('[server] Database initialized');

  try {
    const { initBucket } = require('./minio');
    await initBucket();
    console.log('[server] MinIO initialized');
  } catch (err) {
    console.error('[server] MinIO initialization failed:', err.message);
    console.error('[server] Image uploads will not work until MinIO is available');
  }

  // Start Mattermost auto-sync watcher (no-op if env vars missing)
  try {
    const { startWatcher } = require('./services/mm-watcher');
    startWatcher(io);
  } catch (err) {
    console.error('[server] MM watcher failed to start:', err.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] RefBoard backend listening on port ${PORT}`);
  });
}

// ---- Graceful shutdown ----
function shutdown(signal) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);

  try {
    const { stopWatcher } = require('./services/mm-watcher');
    stopWatcher();
  } catch {}

  io.close(() => {
    console.log('[server] Socket.IO closed');
  });

  server.close(() => {
    console.log('[server] HTTP server closed');

    try {
      const { db } = require('./db');
      db.close();
      console.log('[server] Database closed');
    } catch (e) {
      // ignore
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
