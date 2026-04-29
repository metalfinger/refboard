# Install Roadmap — Making RefBoard Designer-Friendly

Goal: a designer with zero terminal experience should be able to install and run RefBoard on their own laptop. Today's `docker compose up` story is fine for technical users; not for designers. This document captures the two upgrade tiers we've planned, in dependency order, so any future contributor (including future-me) can pick up cleanly.

---

## Tier 1 — `setup.sh` (one-click for terminal-comfortable users)

**Audience:** designers who can copy-paste a single line into Terminal, but won't manage a docker-compose stack.

**Floor:** Docker Desktop must be installed. The script detects this and fails with a friendly install link rather than a stack trace.

### Behaviour

1. Detect OS (`uname`) → macOS / Linux. (Windows handled by sibling `setup.ps1`.)
2. Check `docker info` is reachable. If not:
   - macOS: print Docker Desktop download URL (`https://www.docker.com/products/docker-desktop/`), exit cleanly.
   - Linux: print apt/dnf install commands, exit cleanly.
3. If `.env` doesn't exist:
   - Copy `.env.example → .env`.
   - Replace `JWT_SECRET=...` with a freshly-generated secret (`openssl rand -base64 64`).
   - Prompt for admin email and password (with sensible defaults like `admin@local` / a generated 16-char password printed at the end).
   - Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` so first boot creates the admin.
4. Run `docker compose up -d --build`.
5. Wait until `curl http://localhost:8000/health` returns 200 (poll, max 60s).
6. Print:
   - The URL (`http://localhost:8000`)
   - Admin email + password (especially if generated)
   - Reminder to back up `./.docker-data/`
7. Open the URL in the default browser (`open` on macOS, `xdg-open` on Linux).

### File location

`scripts/setup.sh` — executable. README's quick-start gets a one-liner ahead of the manual `docker compose up`:

```bash
curl -fsSL https://raw.githubusercontent.com/metalfinger/refboard/main/scripts/setup.sh | bash
```

### Estimated effort

~1 hour. Mostly bash plumbing — the underlying stack already works.

### Windows variant

`scripts/setup.ps1` mirrors the same logic for PowerShell. Roughly same effort.

---

## Tier 2 — Native installer (`.dmg` / `.exe`) with zero dependencies

**Audience:** designers who only know how to double-click an installer. The actual mass market.

**Floor:** none — no Docker, no Node, no Terminal. Just download, double-click.

### Architecture

```
┌─────────────────────────────────────┐
│  RefBoard.app (Tauri/Electron shell)│
│  ┌──────────────────────────────┐   │
│  │  Bundled Node binary         │   │  ← pkg or nexe
│  │  + frontend dist             │   │
│  │  + better-sqlite3            │   │
│  │  + sharp (prebuilt for arch) │   │
│  └──────────────┬───────────────┘   │
│                 │                   │
│        ┌────────┴────────┐          │
│        │ ~/Library/      │          │  ← local FS
│        │   RefBoard/     │          │     storage adapter
│        │     refboard.db │          │     replaces MinIO
│        │     media/...   │          │
│        └─────────────────┘          │
└─────────────────────────────────────┘
```

### Pieces to build (in order)

1. **Local-filesystem storage adapter** (~150 lines).
   New file `backend/storage-fs.js` exposing the same interface as `backend/minio.js`:
   - `putBuffer(name, buf, mime)` → write to `${DATA_DIR}/media/${name}`
   - `getObject(name)`, `getPartialObject(name, start, len)` → fs.createReadStream with byte range
   - `removeObject(name)`, `removeObjects(names)`
   - `listObjectsV2(prefix)` → glob/fs.readdir
   - `bucketExists`, `makeBucket` → no-op (just `mkdir -p`)

   Pick the active backend at boot via env var `STORAGE_BACKEND=minio|fs`. Default `minio` for Docker users; native installer sets `fs`.

2. **ffmpeg + poppler bundling.** Both are required for video posters and PDF rendering. Two options:
   - Bundle prebuilt binaries inside the app package (handle license attribution; both are GPL/LGPL — review before shipping).
   - Detect at runtime and degrade gracefully (already done for poppler; extend to ffmpeg). Designers who skip these still get image uploads.

3. **Single binary via `pkg`.** Bundle Node + backend + frontend dist:
   ```
   pnpm dlx pkg backend/server.js \
     --targets node20-macos-arm64,node20-macos-x64,node20-win-x64 \
     --assets "frontend/dist/**/*" \
     --output dist/refboard
   ```
   `better-sqlite3` and `sharp` ship native bindings; verify they survive `pkg`'s fs-snapshot. If not, switch to `@yao-pkg/pkg` (maintained fork) or `nexe`.

4. **Tauri or Electron wrapper.** Recommend Tauri (smaller, native shell, Rust):
   - Spawns the bundled binary on app launch with `STORAGE_BACKEND=fs`, `DATA_DIR=$APPSUPPORT/RefBoard`.
   - Picks an available high port (default 8000, falls back if taken).
   - Menu-bar / system-tray icon with: "Open RefBoard" (opens `http://localhost:<port>` in the user's default browser), "Show Data Folder" (Finder reveal), "Quit."
   - On first launch, creates the data folder and seeds the admin from a generated password shown in a one-time onboarding window.

5. **Code signing + notarization.**
   - macOS: Apple Developer ID ($99/yr), `codesign` + `xcrun notarytool`. Without notarization, Gatekeeper blocks the .dmg. Mandatory.
   - Windows: SignTool with an EV cert. SmartScreen warning otherwise. Optional but worth it.

6. **Auto-update.** Tauri's updater plugin or Electron's `autoUpdater`, pointed at GitHub Releases. Not required for v1.

7. **Distribution.** GitHub Releases as the source of truth. README links to the latest `.dmg` and `.exe` and includes a checksum.

### Estimated effort

- Storage adapter: 2 hours
- Binary bundling: 4 hours (mostly pkg/sharp friction)
- Tauri shell: 4 hours
- Code signing setup: 2 hours
- Total: ~1 day for a working build, ~2 days with code signing + first auto-update wired

### Open questions to decide before starting

- **Multi-user on a native install — is that a thing we want?** A designer running it locally is mostly solo. But what about "I want my designer friend on the LAN to join my board"? The native build can still expose port 8000 on the host's IP — just need a "Share with LAN" toggle in the tray menu. Worth scoping.
- **ffmpeg / poppler licensing.** Both are GPL/LGPL with shipping requirements. Review before bundling. May be cleaner to download them on first launch with the user's consent rather than ship in the app bundle.
- **Storage swap or bridge?** If `STORAGE_BACKEND=fs` and someone later wants to migrate to `minio`, do we offer an `npm run migrate-storage` helper? Probably yes.

---

## Tier 3 — Hosted SaaS (parked)

`refboard.app` style: I host it, designers sign up by email, instant access. Easiest possible UX, but it changes the project from "MIT, self-hosted" to "freemium SaaS." Costs and scope balloon (Stripe billing, multi-tenant DB partitioning, hostname routing, abuse handling). Parked unless there's clear demand after Tier 2 ships.

---

## Pickup checklist for the next session

1. Decide which tier to start. **Recommend Tier 1 first** (1 hour, low risk, immediately ships value).
2. For Tier 1: Just write `scripts/setup.sh`, smoke-test on a clean Mac, link from README.
3. For Tier 2: Start with the storage adapter (fully testable in isolation by setting `STORAGE_BACKEND=fs` with the existing Docker stack). Once that ships, the bundling work is mechanical.
