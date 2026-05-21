// Local-filesystem storage adapter.
//
// Mirrors backend/minio.js exports so it's a drop-in replacement when
// STORAGE_BACKEND=fs. The exported `minioClient` is a fake that supports the
// subset of MinIO Client methods RefBoard actually calls (putObject,
// statObject, getObject, getPartialObject, removeObject, removeObjects,
// listObjectsV2, bucketExists, makeBucket, setBucketPolicy).
//
// Layout on disk:
//   {STORAGE_DATA_DIR}/{bucket}/boards/{boardId}/{imageId}.png
//   {STORAGE_DATA_DIR}/{bucket}/boards/{boardId}/{imageId}.png.mime
//
// The sibling .mime sidecar holds the Content-Type so the HTTP range-aware
// media proxy can set the correct response header on read.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');

const MINIO_BUCKET = process.env.MINIO_BUCKET || 'refboard';
const STORAGE_DATA_DIR = process.env.STORAGE_DATA_DIR || '/app/data/storage';
const PUBLIC_URL = process.env.PUBLIC_URL || '';

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};

function bucketRoot(bucket) {
  return path.join(STORAGE_DATA_DIR, bucket);
}

function objectFile(bucket, name) {
  return path.join(bucketRoot(bucket), name);
}

function metaFile(bucket, name) {
  return objectFile(bucket, name) + '.mime';
}

function notFound(name) {
  const e = new Error(`Object not found: ${name}`);
  e.code = 'NoSuchKey';
  return e;
}

async function readContentType(bucket, name) {
  try {
    const ct = await fsp.readFile(metaFile(bucket, name), 'utf8');
    return ct.trim() || 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

const minioClient = {
  async bucketExists(bucket) {
    try {
      const st = await fsp.stat(bucketRoot(bucket));
      return st.isDirectory();
    } catch {
      return false;
    }
  },

  async makeBucket(bucket /* , region */) {
    await fsp.mkdir(bucketRoot(bucket), { recursive: true });
  },

  async setBucketPolicy(/* bucket, policyJson */) {
    // FS adapter has no concept of public-read policies — the bytes are only
    // served through the backend's /api/images/* proxy regardless.
  },

  async putObject(bucket, name, buffer, length, metaDict) {
    const target = objectFile(bucket, name);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buffer);
    const ct = metaDict && (metaDict['Content-Type'] || metaDict['content-type']);
    if (ct) await fsp.writeFile(metaFile(bucket, name), ct);
  },

  async statObject(bucket, name) {
    let st;
    try {
      st = await fsp.stat(objectFile(bucket, name));
    } catch (err) {
      if (err.code === 'ENOENT') throw notFound(name);
      throw err;
    }
    const contentType = await readContentType(bucket, name);
    return {
      size: st.size,
      lastModified: st.mtime,
      metaData: { 'content-type': contentType },
    };
  },

  async getObject(bucket, name) {
    const target = objectFile(bucket, name);
    if (!fs.existsSync(target)) throw notFound(name);
    return fs.createReadStream(target);
  },

  async getPartialObject(bucket, name, offset, length) {
    const target = objectFile(bucket, name);
    if (!fs.existsSync(target)) throw notFound(name);
    const end = length > 0 ? offset + length - 1 : undefined;
    return fs.createReadStream(target, { start: offset, end });
  },

  async removeObject(bucket, name) {
    const target = objectFile(bucket, name);
    await fsp.rm(target, { force: true });
    await fsp.rm(metaFile(bucket, name), { force: true });
  },

  async removeObjects(bucket, names) {
    await Promise.all(names.map((n) => this.removeObject(bucket, n)));
  },

  // Returns an EventEmitter that fires 'data' for each object, then 'end'.
  // Matches the shape consumers rely on (see backend/minio.js:97-109).
  listObjectsV2(bucket, prefix, recursive) {
    const emitter = new EventEmitter();
    const start = path.join(bucketRoot(bucket), prefix || '');
    (async () => {
      try {
        const stack = [start];
        while (stack.length) {
          const dir = stack.pop();
          let entries;
          try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
          } catch (err) {
            if (err.code === 'ENOENT') continue;
            throw err;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (recursive) stack.push(full);
              continue;
            }
            if (entry.name.endsWith('.mime')) continue;
            const rel = path.relative(bucketRoot(bucket), full).split(path.sep).join('/');
            emitter.emit('data', { name: rel, size: 0 });
          }
        }
        emitter.emit('end');
      } catch (err) {
        emitter.emit('error', err);
      }
    })();
    return emitter;
  },
};

async function initBucket() {
  await fsp.mkdir(bucketRoot(MINIO_BUCKET), { recursive: true });
  console.log(`[storage-fs] Bucket directory ready at ${bucketRoot(MINIO_BUCKET)}`);
}

async function uploadImage(boardId, imageId, buffer, mimeType) {
  const ext = MIME_TO_EXT[mimeType] || '.bin';
  const objectName = `boards/${boardId}/${imageId}${ext}`;
  await minioClient.putObject(MINIO_BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': mimeType,
  });
  return objectName;
}

async function putBuffer(objectName, buffer, contentType) {
  await minioClient.putObject(MINIO_BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  return objectName;
}

async function deleteImage(objectPath) {
  await minioClient.removeObject(MINIO_BUCKET, objectPath);
}

async function deleteBoardImages(boardId) {
  const prefix = `boards/${boardId}/`;
  const dir = path.join(bucketRoot(MINIO_BUCKET), prefix);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  await fsp.rm(dir, { recursive: true, force: true });
  // Count is approximate (we don't enumerate first); callers only check >0.
  count = 1;
  return count;
}

function getImageUrl(objectPath) {
  if (PUBLIC_URL) return `${PUBLIC_URL.replace(/\/$/, '')}/api/images/${objectPath}`;
  return `/api/images/${objectPath}`;
}

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '200', 10) * 1024 * 1024;

module.exports = {
  minioClient,
  initBucket,
  uploadImage,
  putBuffer,
  deleteImage,
  deleteBoardImages,
  getImageUrl,
  MINIO_BUCKET,
  MIME_TO_EXT,
  MAX_FILE_SIZE,
};
