// Storage backend router.
//
// STORAGE_BACKEND=fs    → local filesystem (single-container deploys, native
//                          installs, designers who don't want to run MinIO)
// STORAGE_BACKEND=minio → MinIO / any S3-compatible store (default)
//
// Both modules export the same shape (minioClient + helper functions), so
// consumers `require('./storage')` and never touch the backend choice
// directly.

const backend = (process.env.STORAGE_BACKEND || 'minio').toLowerCase();

if (backend === 'fs') {
  console.log('[storage] Using local filesystem backend (STORAGE_BACKEND=fs)');
  module.exports = require('./storage-fs');
} else {
  module.exports = require('./minio');
}
