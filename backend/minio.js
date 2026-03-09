const Minio = require('minio');
const path = require('path');

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'refboard';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://${MINIO_ENDPOINT}:${MINIO_PORT}`;

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/**
 * Create the bucket if it doesn't already exist.
 * Sets a public read policy so images are accessible via URL.
 */
async function initBucket() {
  const exists = await minioClient.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET, '');
    // Set public read policy
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${MINIO_BUCKET}/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(MINIO_BUCKET, JSON.stringify(policy));
  }
  console.log(`[minio] Bucket "${MINIO_BUCKET}" ready`);
}

/**
 * Upload an image buffer to MinIO.
 * Returns the minio object path (used as key for future operations).
 */
async function uploadImage(boardId, imageId, buffer, mimeType) {
  const ext = MIME_TO_EXT[mimeType] || '.bin';
  const objectName = `boards/${boardId}/${imageId}${ext}`;

  await minioClient.putObject(MINIO_BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': mimeType,
  });

  return objectName;
}

/**
 * Delete a single object by its minio path.
 */
async function deleteImage(minioPath) {
  await minioClient.removeObject(MINIO_BUCKET, minioPath);
}

/**
 * Delete all objects under the boards/{boardId}/ prefix.
 */
async function deleteBoardImages(boardId) {
  const prefix = `boards/${boardId}/`;
  const objectsList = [];

  return new Promise((resolve, reject) => {
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, prefix, true);
    stream.on('data', (obj) => {
      objectsList.push(obj.name);
    });
    stream.on('error', reject);
    stream.on('end', async () => {
      if (objectsList.length > 0) {
        await minioClient.removeObjects(MINIO_BUCKET, objectsList);
      }
      resolve(objectsList.length);
    });
  });
}

/**
 * Build the public URL for an image given its minio path.
 */
function getImageUrl(minioPath) {
  // Return relative URL — images served via backend proxy at /api/images/*
  return `/api/images/${minioPath}`;
}

module.exports = {
  minioClient,
  initBucket,
  uploadImage,
  deleteImage,
  deleteBoardImages,
  getImageUrl,
  MINIO_BUCKET,
};
