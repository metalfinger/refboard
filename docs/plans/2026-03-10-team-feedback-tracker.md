# Team Feedback Tracker — 2026-03-10

## Priority Order

### 1. Auto-Select After Import (Small UX fix)

**Problem:** Imported items don't get selected after upload completes.

**Root cause:** `image-drop.ts:handleUploadResult()` never calls `selectionManager.selectOnly()`. `setupDragDrop()` doesn't receive a selectionManager reference.

**Fix:**
- Pass `selectionManager` to `setupDragDrop()` and `setupPaste()` in `useCanvasSetup.ts`
- After `addImageFromUpload()`/`addVideoFromUpload()` returns, call `selectionManager.selectOnly(item.id)`
- Multi-file drops: select all new items

**Files:** `frontend/src/canvas/image-drop.ts`, `frontend/src/hooks/useCanvasSetup.ts`

---

### 2. Upload Manager (Big UX win)

**Problem:** Uploads are completely silent — no progress, no status, no error feedback. Errors only logged to console.

**Design:**
- States: uploading → queued → processing → ready → failed
- Reuse the existing media job pipeline and socket events (`media:job:update`), NOT a parallel status system
- Retry/cancel support
- Upload progress via `axios.onUploadProgress` or XHR

**What exists to build on:**
- Toast system in Editor.tsx
- `media_jobs` table + `media:job:update` socket events
- Placeholder rectangles on canvas during upload

**Files:** `frontend/src/api.ts`, `frontend/src/canvas/image-drop.ts`, `frontend/src/pages/Editor.tsx`, `backend/services/media-worker.js`

---

### 3. Video Size Failure Handling (Validation + feedback)

**Problem:** Videos of certain sizes fail silently. "Certain size" is too vague — need exact failure reasons surfaced to UI.

**Fixes (in order of priority):**
1. Upload-time validation — client-side file size + resolution checks with clear error messages
2. Log exact failure reason back to UI via socket events (not just console.error on backend)
3. ffmpeg job queue/backpressure — reject or queue when at capacity
4. Explicit max supported file/resolution policy (document and enforce)
5. Preview/proxy strategy for very large videos
6. Container memory bump (2GB) is a last resort, not the primary fix

**Current limits found:**
- Container memory: 512MB (docker-compose.yml:519)
- ffmpeg/ffprobe timeout: 15s each (video-utils.js:37,94)
- File size: 200MB default (minio.js:119, configurable)
- No resolution limit, no GPU texture size check

**Files:** `backend/video-utils.js`, `backend/services/media-worker.js`, `backend/routes/upload.js`, `frontend/src/canvas/image-drop.ts`, `docker-compose.yml`

---

### 4. Export as Image (Incremental)

**Problem:** No way to download board/selection as image file.

**Design:**
- Browser download (NOT filesystem path — not realistic in-browser)
- Options: filename, format (PNG/JPEG/WebP), dimensions (locked ratio), quality, scope
- Scope: selection first, then full board
- Filename default: board name + timestamp

**What exists to build on:**
- `clipboard.ts` — full `renderer.extract.canvas()` + `generateTexture()` pipeline
- `getItemWorldBounds()` — world-space bounds for any item/group
- Resolution scaling logic (native texture ratio, capped at 4x)
- `preserveDrawingBuffer: true` already set

**Files:** `frontend/src/canvas/clipboard.ts`, `frontend/src/components/Toolbar.tsx`, `frontend/src/pages/Editor.tsx`

---

### 5. GIF Support (Product decision needed first)

**Problem:** GIFs upload fine but render as static first frame only.

**Product decision required — three options:**
1. **Stay animated** — use PixiJS GifSprite, but risk CPU/GPU explosion with many visible GIFs
2. **Autoplay only in viewport** — animate when visible, pause when culled (like video lifecycle)
3. **Static poster by default, animate-on-click** — safest, consistent with video behavior

**Recommendation:** Normalize GIFs to video-like lifecycle, not image lifecycle. Treat as lightweight video with similar culling, poster, and play/pause behavior.

**Technical context:**
- PixiJS v8.17 has built-in `GifSprite` (available but unused)
- GIFs currently classified as `type: 'image'`, use `ImageSprite`
- No animation metadata stored (frame count, duration)
- GIFs excluded from LOD tiers (stored as-is like SVG)

**Files:** `frontend/src/canvas/SceneManager.ts`, `frontend/src/canvas/sprites/ImageSprite.ts`, `backend/routes/upload.js`
