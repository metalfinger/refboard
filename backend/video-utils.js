/**
 * video-utils.js — Extract poster frame and metadata from video buffers using ffmpeg.
 *
 * Called at upload time so every video gets a poster image and cached metadata.
 * The board never needs to create a <video> element just to discover dimensions
 * or capture a first frame.
 */

const { execFile } = require('child_process');
const { writeFileSync, readFileSync, unlinkSync, mkdtempSync } = require('fs');
const path = require('path');
const os = require('os');

/**
 * Extract video metadata (dimensions, duration, hasAudio) using ffprobe.
 * Returns { width, height, duration, hasAudio } or null on failure.
 */
function probeVideo(buffer) {
  return new Promise((resolve) => {
    let tmpDir, tmpFile;
    try {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'refboard-vid-'));
      tmpFile = path.join(tmpDir, 'input.vid');
      writeFileSync(tmpFile, buffer);
    } catch (err) {
      console.warn('[video-utils] Failed to write temp file:', err.message);
      resolve(null);
      return;
    }

    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      tmpFile,
    ], { timeout: 15000 }, (err, stdout) => {
      cleanup(tmpFile, tmpDir);
      if (err) {
        console.warn('[video-utils] ffprobe failed:', err.message);
        resolve(null);
        return;
      }

      try {
        const info = JSON.parse(stdout);
        const videoStream = (info.streams || []).find(s => s.codec_type === 'video');
        const audioStream = (info.streams || []).find(s => s.codec_type === 'audio');

        if (!videoStream) {
          resolve(null);
          return;
        }

        resolve({
          width: videoStream.width || null,
          height: videoStream.height || null,
          duration: info.format?.duration ? parseFloat(info.format.duration) : null,
          hasAudio: !!audioStream,
        });
      } catch (parseErr) {
        console.warn('[video-utils] ffprobe parse failed:', parseErr.message);
        resolve(null);
      }
    });
  });
}

/**
 * Extract a poster frame (JPEG) from a video buffer.
 * Returns a Buffer containing JPEG data, or null on failure.
 */
function extractPoster(buffer) {
  return new Promise((resolve) => {
    let tmpDir, tmpInput, tmpOutput;
    try {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'refboard-poster-'));
      tmpInput = path.join(tmpDir, 'input.vid');
      tmpOutput = path.join(tmpDir, 'poster.jpg');
      writeFileSync(tmpInput, buffer);
    } catch (err) {
      console.warn('[video-utils] Failed to write temp file:', err.message);
      resolve(null);
      return;
    }

    execFile('ffmpeg', [
      '-i', tmpInput,
      '-vframes', '1',       // single frame
      '-ss', '0.1',          // skip 0.1s (avoid black leader)
      '-q:v', '3',           // JPEG quality (2=best, 31=worst)
      '-y',                  // overwrite
      tmpOutput,
    ], { timeout: 15000 }, (err) => {
      if (err) {
        console.warn('[video-utils] ffmpeg poster extraction failed:', err.message);
        cleanup(tmpInput, tmpDir);
        resolve(null);
        return;
      }

      try {
        const posterBuffer = readFileSync(tmpOutput);
        cleanup(tmpInput, tmpDir, tmpOutput);
        resolve(posterBuffer);
      } catch (readErr) {
        console.warn('[video-utils] Failed to read poster:', readErr.message);
        cleanup(tmpInput, tmpDir, tmpOutput);
        resolve(null);
      }
    });
  });
}

function cleanup(...files) {
  for (const f of files) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  // Try removing parent dirs (they're temp dirs we created)
  for (const f of files) {
    try {
      const dir = path.dirname(f);
      if (dir.includes('refboard-')) {
        require('fs').rmdirSync(dir);
      }
    } catch { /* ignore — dir may not be empty or already removed */ }
  }
}

module.exports = { probeVideo, extractPoster };
