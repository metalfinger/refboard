/**
 * media-worker.js — Background queue worker for video processing.
 *
 * Polls the media_jobs table for pending jobs and runs ffprobe + ffmpeg
 * with a concurrency limit so uploads return instantly.
 *
 * Emits socket events so the frontend can upgrade placeholders in real-time.
 */

const {
  getPendingMediaJobs,
  updateMediaJob,
  updateImageMedia,
  getImage,
  updatePdfPageThumb,
  updatePdfPageHires,
} = require('../db');
const { probeVideo, extractPoster } = require('../video-utils');
const { putBuffer, minioClient, MINIO_BUCKET } = require('../minio');
const { pdfRenderPage, bufferToTempFile } = require('../pdf-utils');

const POLL_INTERVAL_MS = 3000;
const MAX_CONCURRENCY = 2;

let io = null;
let pollTimer = null;
let activeCount = 0;
let stopping = false;

/**
 * Start the media worker. Pass the Socket.IO server instance for notifications.
 */
function startMediaWorker(ioInstance) {
  io = ioInstance;
  stopping = false;
  console.log('[media-worker] Started (poll=%dms, concurrency=%d)', POLL_INTERVAL_MS, MAX_CONCURRENCY);
  poll();
}

function stopMediaWorker() {
  stopping = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[media-worker] Stopped');
}

function schedulePoll() {
  if (stopping) return;
  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

async function poll() {
  if (stopping) return;

  const slotsAvailable = MAX_CONCURRENCY - activeCount;
  if (slotsAvailable <= 0) {
    schedulePoll();
    return;
  }

  try {
    const jobs = getPendingMediaJobs(slotsAvailable);
    for (const job of jobs) {
      activeCount++;
      processJob(job).finally(() => {
        activeCount--;
      });
    }
  } catch (err) {
    console.error('[media-worker] Poll error:', err.message);
  }

  schedulePoll();
}

async function processJob(job) {
  const jobId = job.id;
  const imageId = job.image_id;
  const boardId = job.board_id;

  try {
    updateMediaJob(jobId, { status: 'processing', startedAt: new Date().toISOString() });
    emitJobUpdate(boardId, jobId, imageId, 'processing');

    // PDF jobs
    if (job.type === 'pdf-thumbnail' || job.type === 'pdf-hires') {
      const meta = JSON.parse(job.result_json);
      const dpi = job.type === 'pdf-thumbnail' ? 72 : 200;
      const variant = job.type === 'pdf-thumbnail' ? 'thumb' : 'hires';
      await processPdfPage(job, meta.pageNumber, dpi, variant);
      return;
    }

    // Video poster job (original logic)
    const image = getImage(imageId);
    if (!image) {
      updateMediaJob(jobId, { status: 'failed', error: 'Image record not found' });
      emitJobFailed(boardId, jobId, imageId, 'Image record not found');
      return;
    }

    const videoBuffer = await fetchFromMinio(image.minio_path);
    if (!videoBuffer) {
      updateMediaJob(jobId, { status: 'failed', error: 'Failed to fetch video from storage' });
      emitJobFailed(boardId, jobId, imageId, 'Failed to fetch video from storage');
      return;
    }

    // Run ffprobe + ffmpeg in parallel
    const [meta, posterBuf] = await Promise.all([
      probeVideo(videoBuffer),
      extractPoster(videoBuffer),
    ]);

    let posterAssetKey = null;
    if (posterBuf) {
      posterAssetKey = `boards/${boardId}/${imageId}_poster.jpg`;
      await putBuffer(posterAssetKey, posterBuf, 'image/jpeg');
    }

    const nativeWidth = meta?.width || null;
    const nativeHeight = meta?.height || null;
    const duration = meta?.duration || null;

    // Update the image record with processed media info
    updateImageMedia(imageId, { posterAssetKey, duration, nativeWidth, nativeHeight });

    updateMediaJob(jobId, {
      status: 'done',
      finishedAt: new Date().toISOString(),
    });

    emitJobUpdate(boardId, jobId, imageId, 'done', {
      posterAssetKey,
      nativeWidth,
      nativeHeight,
      duration,
    });

    console.log('[media-worker] Job %s done (image=%s, poster=%s)', jobId, imageId, !!posterAssetKey);
  } catch (err) {
    console.error('[media-worker] Job %s failed:', jobId, err.message);

    // Classify error for user-facing message
    let userError = 'Video processing failed';
    if (err.killed || err.signal === 'SIGTERM') {
      userError = 'Video processing timed out — file may be too large or corrupt';
    } else if (err.message?.includes('ENOMEM') || err.message?.includes('Cannot allocate')) {
      userError = 'Out of memory — video file is too large to process';
    } else if (err.message?.includes('Invalid data')) {
      userError = 'Invalid or corrupt video file';
    }

    const attempts = (job.attempts || 0) + 1;
    if (attempts < 3) {
      updateMediaJob(jobId, { status: 'retry', attempts, error: err.message });
      emitJobUpdate(boardId, jobId, imageId, 'retry');
    } else {
      updateMediaJob(jobId, { status: 'failed', attempts, error: err.message });
      emitJobFailed(boardId, jobId, imageId, userError);
    }
  }
}

/**
 * Process a single PDF page: fetch PDF from MinIO, render page, upload PNG, update DB.
 */
async function processPdfPage(job, pageNumber, dpi, variant) {
  const jobId = job.id;
  const imageId = job.image_id;
  const boardId = job.board_id;

  const image = getImage(imageId);
  if (!image) {
    updateMediaJob(jobId, { status: 'failed', error: 'Image record not found' });
    emitJobFailed(boardId, jobId, imageId, 'Image record not found');
    return;
  }

  const pdfBuffer = await fetchFromMinio(image.minio_path);
  if (!pdfBuffer) {
    updateMediaJob(jobId, { status: 'failed', error: 'Failed to fetch PDF from storage' });
    emitJobFailed(boardId, jobId, imageId, 'Failed to fetch PDF from storage');
    return;
  }

  const { tmpPath, cleanup } = bufferToTempFile(pdfBuffer, '.pdf');
  try {
    const pngBuffer = await pdfRenderPage(tmpPath, pageNumber, dpi);

    // Asset key: strip .pdf extension and append page/variant suffix
    const basePath = image.minio_path.replace(/\.pdf$/i, '');
    const suffix = variant === 'thumb' ? `_p${pageNumber}_thumb.png` : `_p${pageNumber}.png`;
    const assetKey = basePath + suffix;

    await putBuffer(assetKey, pngBuffer, 'image/png');

    // Update pdf_pages record
    if (variant === 'thumb') {
      updatePdfPageThumb(imageId, pageNumber, assetKey);
    } else {
      updatePdfPageHires(imageId, pageNumber, assetKey);
    }

    updateMediaJob(jobId, {
      status: 'done',
      finishedAt: new Date().toISOString(),
    });

    const eventType = variant === 'thumb' ? 'pdf-thumbnail' : 'pdf-hires';
    const resultKey = variant === 'thumb' ? 'thumbAssetKey' : 'hiresAssetKey';
    emitJobUpdate(boardId, jobId, imageId, 'done', {
      imageId,
      type: eventType,
      pageNumber,
      [resultKey]: assetKey,
      status: 'done',
    });

    console.log('[media-worker] Job %s done (pdf %s, image=%s, page=%d)', jobId, variant, imageId, pageNumber);
  } finally {
    cleanup();
  }
}

/**
 * Fetch object from MinIO as a Buffer.
 */
async function fetchFromMinio(objectPath) {
  try {
    const stream = await minioClient.getObject(MINIO_BUCKET, objectPath);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.warn('[media-worker] MinIO fetch failed:', err.message);
    return null;
  }
}

/**
 * Emit a media job update to all sockets in the board room.
 */
function emitJobUpdate(boardId, jobId, imageId, status, result) {
  if (!io) return;
  const room = `board:${boardId}`;
  io.to(room).emit('media:job:update', {
    jobId,
    imageId,
    status,
    ...(result || {}),
  });
}

/**
 * Emit a job failure with error details to the board room.
 */
function emitJobFailed(boardId, jobId, imageId, error) {
  emitJobUpdate(boardId, jobId, imageId, 'failed', { error });
}

module.exports = { startMediaWorker, stopMediaWorker };
