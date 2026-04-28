/**
 * pdf-utils.js — Thin wrappers around poppler-utils CLI tools.
 *
 * Uses pdfinfo + pdftoppm (from poppler-utils) for PDF metadata extraction
 * and page rendering. No external Node dependencies required.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 60_000;

class PopplerMissingError extends Error {
  constructor(binary) {
    super(
      `RefBoard couldn't run "${binary}". PDF support requires poppler-utils to be installed on the host. ` +
      `On macOS: brew install poppler. On Debian/Ubuntu: apt install poppler-utils. ` +
      `The provided Dockerfile already installs it — this only matters for manual installs.`
    );
    this.code = 'POPPLER_MISSING';
    this.binary = binary;
    this.statusCode = 501;
  }
}

function wrapEnoent(binary, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err && err.code === 'ENOENT' && (err.path === binary || err.syscall === `spawn ${binary}`)) {
        throw new PopplerMissingError(binary);
      }
      throw err;
    }
  };
}

/**
 * Write a buffer to a temporary file. Returns { tmpPath, cleanup }.
 * Caller MUST call cleanup() when done.
 */
function bufferToTempFile(buffer, ext = '.bin') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refboard-pdf-'));
  const tmpPath = path.join(tmpDir, `file${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return {
    tmpPath,
    cleanup() {
      try { fs.unlinkSync(tmpPath); } catch {}
      try { fs.rmdirSync(tmpDir); } catch {}
    },
  };
}

/**
 * Extract PDF metadata via pdfinfo.
 * Returns { pageCount, dimensions: [{ w, h }, ...] }
 */
async function pdfInfo(filePath) {
  // Get basic info (page count)
  const { stdout: basicOut } = await execFileAsync('pdfinfo', [filePath], { timeout: TIMEOUT_MS });

  let pageCount = 0;
  for (const line of basicOut.split('\n')) {
    const match = line.match(/^Pages:\s+(\d+)/);
    if (match) {
      pageCount = parseInt(match[1], 10);
      break;
    }
  }

  if (pageCount === 0) {
    throw new Error('Could not determine PDF page count');
  }

  // Get per-page dimensions
  const dimensions = [];
  const { stdout: dimOut } = await execFileAsync(
    'pdfinfo',
    ['-f', '1', '-l', String(pageCount), filePath],
    { timeout: TIMEOUT_MS }
  );

  // Parse "Page N size: W x H pts" lines
  for (const line of dimOut.split('\n')) {
    const match = line.match(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/);
    if (match) {
      dimensions.push({
        w: Math.round(parseFloat(match[1])),
        h: Math.round(parseFloat(match[2])),
      });
    }
  }

  // Fallback: if no per-page sizes found, try global "Page size:"
  if (dimensions.length === 0) {
    for (const line of basicOut.split('\n')) {
      const match = line.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)/);
      if (match) {
        const dim = {
          w: Math.round(parseFloat(match[1])),
          h: Math.round(parseFloat(match[2])),
        };
        for (let i = 0; i < pageCount; i++) {
          dimensions.push(dim);
        }
        break;
      }
    }
  }

  return { pageCount, dimensions };
}

/**
 * Render a single PDF page to PNG at the given DPI.
 * Returns a PNG Buffer.
 */
async function pdfRenderPage(filePath, pageNum, dpi = 150) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refboard-render-'));

  try {
    const outPrefix = path.join(outDir, 'page');

    await execFileAsync('pdftoppm', [
      '-png',
      '-r', String(dpi),
      '-f', String(pageNum),
      '-l', String(pageNum),
      filePath,
      outPrefix,
    ], { timeout: TIMEOUT_MS });

    // pdftoppm names output like page-01.png, page-1.png, etc. — discover it
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
    if (files.length === 0) {
      throw new Error(`pdftoppm produced no output for page ${pageNum}`);
    }

    const pngPath = path.join(outDir, files[0]);
    const pngBuffer = fs.readFileSync(pngPath);
    return pngBuffer;
  } finally {
    // Clean up temp dir
    try {
      for (const f of fs.readdirSync(outDir)) {
        fs.unlinkSync(path.join(outDir, f));
      }
      fs.rmdirSync(outDir);
    } catch {}
  }
}

const safePdfInfo = wrapEnoent('pdfinfo', pdfInfo);
const safePdfRenderPage = wrapEnoent('pdftoppm', pdfRenderPage);

module.exports = {
  pdfInfo: safePdfInfo,
  pdfRenderPage: safePdfRenderPage,
  bufferToTempFile,
  PopplerMissingError,
};
