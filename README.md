# RefBoard

A self-hosted, real-time collaborative reference board — like PureRef, but on the web, multiplayer, and with markdown notes, threaded review comments, and PDF support baked in.

Drop images, videos, and PDFs onto an infinite GPU canvas. Pan, zoom, group, align, annotate. Share a board with your team and watch each others' cursors in real time. Pin a comment to a thumbnail and resolve it like a code review.

Built because we needed PureRef's painlessness, Miro's collaboration, and a code-review's threading — without paying three different SaaS subscriptions for them.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Features

**Canvas**
- Infinite, GPU-accelerated canvas (Pixi.js v8) — handles thousands of items without dropping frames
- Drag & drop images, videos, and PDFs from your filesystem or clipboard
- Drop image URLs directly from the browser
- Pan / zoom / fit-all, selection, lasso, group, ungroup
- Undo / redo, locked layers, hidden layers
- Pen / draw tool, sticky notes, text labels
- Markdown cards (BlockNote-powered editor) right on the canvas

**PureRef-parity power tools**
- 40+ keyboard shortcuts mapped to PureRef defaults
- Align, distribute, normalize size / scale / width / height
- Auto-arrange in grid / row / column / by name / by z-order / random / stack
- Optimal pack, overlay compare (Ctrl+Y), flip H/V, reset transform, grayscale, lock
- Right-click context menu with everything

**Real-time collaboration**
- Live cursors with name labels
- Full-scene sync over Socket.IO with interaction-aware deferral
- Presence (online avatars), follow-user mode, share dialog with role-based access (owner / editor / viewer)
- Public, read-only sharing links via collection share token

**Review & threads**
- Pin a comment to any object on the canvas → starts a thread
- Threaded comments with status (open / resolved)
- Review mode toggles a clean overlay for walking through feedback

**Media pipeline**
- Image variants (thumbnail / hires / LOD) generated on upload via Sharp
- Video poster + duration + dimensions extracted via ffmpeg
- PDF → page thumbnails + hires renders via poppler
- Background media worker so the upload feels instant

**Auth & admin**
- JWT-based email/password auth
- First user is auto-admin
- `SEED_ADMIN_*` env vars to bootstrap an admin on first boot
- `ALLOW_SELF_REGISTRATION` flag — when off, only admins can create accounts
- **Admin dashboard** at `/admin` — list users, create accounts, reset passwords, promote/demote between admin and member, deactivate / reactivate, and toggle self-registration on or off at runtime (admin-only, JWT-gated)
- Admin REST endpoints work with either a JWT belonging to an admin user or an `X-API-Key` header for bots

**Deployment**
- One `docker compose up` starts RefBoard + a bundled MinIO for object storage
- Dockerfile is multi-stage and self-contained
- SQLite (WAL mode) for metadata — zero external DB dependency

---

## Quick start (Docker, recommended)

Requires Docker + Docker Compose v2.

```bash
git clone https://github.com/metalfinger/refboard
cd refboard
cp .env.example .env

# Edit .env and at minimum set:
#   JWT_SECRET=<run: openssl rand -base64 64>
#   SEED_ADMIN_EMAIL=you@example.com
#   SEED_ADMIN_PASSWORD=<a long password>

docker compose up --build
```

Then open <http://localhost:8000> and sign in with the seeded admin email / password.

MinIO console (S3 dashboard) is at <http://localhost:9001> — login is whatever you set as `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` in `.env` (defaults to `minioadmin` / `minioadmin`).

Persistent state lives under `./.docker-data/` (SQLite + MinIO objects). Back this up.

---

## Manual install (without Docker)

Requires Node.js 20+, **ffmpeg**, and **poppler-utils** on your `PATH`. The Docker image installs these automatically; for a manual install you need to bring them yourself.

```bash
# macOS
brew install ffmpeg poppler

# Debian / Ubuntu
sudo apt install ffmpeg poppler-utils
```

If `poppler-utils` is missing, image and video uploads still work, but PDF uploads will fail with a clear `501 POPPLER_MISSING` error rather than crashing.

You also need an S3-compatible object store reachable from the backend — easiest is to run MinIO standalone.

```bash
# 1. Object storage
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  -v $(pwd)/.docker-data/minio:/data \
  minio/minio server /data --console-address ":9001"

# 2. Backend
cd backend
npm install
DB_PATH=./data/refboard.db \
JWT_SECRET=$(openssl rand -base64 64) \
MINIO_ENDPOINT=localhost \
SEED_ADMIN_EMAIL=you@example.com \
SEED_ADMIN_PASSWORD=changeme \
node server.js

# 3. Frontend (dev mode, separate terminal)
cd frontend
npm install
npm run dev
```

In dev mode the Vite server proxies `/api` and `/socket.io` to the backend on port 8000 — open the URL Vite prints.

For production, run `npm run build` in `frontend/` — the backend serves the built `frontend/dist` automatically.

---

## Configuration

All knobs live in `.env`. See [`.env.example`](.env.example) for the full annotated list. Highlights:

| Variable | Required? | What it does |
|---|---|---|
| `JWT_SECRET` | yes (in prod) | Signs auth tokens. Make it long and random. |
| `DB_PATH` | no | SQLite file path. Defaults to `/app/data/refboard.db` (Docker). |
| `MINIO_ENDPOINT` / `_PORT` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` | yes | S3-compatible storage. |
| `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` | no | Idempotent first-boot admin bootstrap. |
| `ALLOW_SELF_REGISTRATION` | no | Initial seed only — sets the runtime toggle on first boot. After that, control it from the admin dashboard. Default `false`. |
| `MAX_FILE_SIZE_MB` | no | Per-file upload cap. Default 200. |
| `REFBOARD_API_KEY` | no | Enables programmatic upload via X-API-Key header. |

---

## Putting it on a public domain

RefBoard is just an HTTP server on port 8000 — every reverse-proxy / tunneling option works. The only non-obvious bit is that it uses Socket.IO over WebSockets, so whatever fronts it must allow WS upgrades.

### Cloudflare Tunnel (zero open ports, free TLS, recommended for home / studio servers)

This is what I run my own instance behind. No router config, no public IP, no Let's Encrypt — Cloudflare proxies the connection through an outbound tunnel from the box.

```bash
# 1. Install cloudflared (macOS / Linux examples)
brew install cloudflared          # macOS
# OR
sudo apt install cloudflared      # Debian/Ubuntu (see Cloudflare docs for repo setup)

# 2. Authenticate (opens browser to pick a Cloudflare account / zone)
cloudflared tunnel login

# 3. Create a named tunnel
cloudflared tunnel create refboard

# 4. Route a hostname to it (replace example.com with your zone)
cloudflared tunnel route dns refboard refboard.example.com

# 5. Run the tunnel pointed at the local RefBoard
cloudflared tunnel run --url http://localhost:8000 refboard
```

For a permanent install, generate a config at `~/.cloudflared/config.yml`:

```yaml
tunnel: refboard
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: refboard.example.com
    service: http://localhost:8000
  - service: http_status:404
```

Then `cloudflared service install` to make it boot at startup.

> **Heads-up:** Cloudflare's free plan caps proxied request bodies at **100 MB**. If you regularly upload videos / large PDFs above that, set `MAX_FILE_SIZE_MB` accordingly, or pair Cloudflare Tunnel with a direct path for uploads (e.g. tunnel only the SPA, expose the upload API via something else), or upgrade your Cloudflare plan.

### Caddy reverse proxy (one-line TLS via Let's Encrypt)

If the box is publicly reachable (cloud VPS, port 443 open):

```caddy
refboard.example.com {
    reverse_proxy localhost:8000
}
```

That's the whole `Caddyfile`. Caddy auto-provisions and renews the certificate, and `reverse_proxy` upgrades WebSockets transparently.

### nginx reverse proxy

```nginx
server {
    server_name refboard.example.com;
    listen 443 ssl;
    # ssl_certificate / ssl_certificate_key from certbot or your CA

    client_max_body_size 250M;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

### Tailscale (private-to-your-team access without a domain)

If you don't want it on the public internet at all:

```bash
tailscale serve --bg http://localhost:8000
# now reachable at https://<machine>.<tailnet>.ts.net
```

Anyone in your tailnet can hit it; no one else can.

### Checklist when going public

- [ ] Set `JWT_SECRET` to a real random value (`openssl rand -base64 64`).
- [ ] Set `NODE_ENV=production` (the backend refuses to start in prod without `JWT_SECRET`).
- [ ] Set `CORS_ORIGIN=https://your.domain` (drop the wildcard).
- [ ] Confirm self-registration is **off** in the admin dashboard (defaults off; only flips on if you set `ALLOW_SELF_REGISTRATION=true` on first boot).
- [ ] Restrict the MinIO console (port 9001) to localhost — only the S3 API on 9000 needs to be reachable from the backend, and the backend already proxies media bytes through `/api/images/*`, so MinIO does **not** need to be exposed publicly.
- [ ] Keep `./.docker-data/` (or `DB_PATH` + MinIO data dir) backed up — that's all your state.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Browser                                                    │
│  React + TypeScript + Vite                                 │
│  Pixi.js v8 canvas · BlockNote markdown · Socket.IO client │
└──────────────────┬─────────────────────────────┬───────────┘
                   │ HTTPS / WS                  │
                   ▼                             ▼
       ┌───────────────────────┐    ┌──────────────────────┐
       │ Express + Socket.IO   │    │  Static frontend     │
       │  /api/* REST          │    │  (served by backend) │
       │  /socket.io WS rooms  │    └──────────────────────┘
       │  Media worker (queue) │
       └────┬──────────┬───────┘
            │          │
            ▼          ▼
    ┌──────────┐   ┌──────────────────┐
    │ SQLite   │   │ MinIO (S3)       │
    │ (WAL)    │   │ images / videos  │
    │ metadata │   │ pdf renders      │
    └──────────┘   └──────────────────┘
```

- **Frontend** — React + Vite + TypeScript. Pixi.js v8 powers the canvas (LOD-aware, viewport-culled, GPU-batched). BlockNote provides the markdown editor used for sticky cards. Socket.IO syncs scene state.
- **Backend** — Express for REST, Socket.IO for real-time, better-sqlite3 for metadata (WAL mode), Sharp + ffmpeg + poppler for media processing. A background worker handles thumbnails/hires/PDF rasterization out of the request path.
- **Storage** — MinIO (or any S3 API). The backend proxies media bytes through `/api/images/*` so URLs stay stable across deployment moves.

See [CHANGELOG.md](CHANGELOG.md) for the version history (v0.1.0 → v0.5.0).

---

## Roadmap

- [x] Admin dashboard frontend (live at `/admin` — user create / reset-password / role / deactivate)
- [ ] Per-board activity log (who added/deleted what, when)
- [ ] Mobile-friendly read-only board view
- [ ] Export board → PDF / image grid
- [ ] Optional remote storage adapters (S3 direct, R2)

---

## Contributing

Issues and PRs welcome. The codebase is single-language on the frontend (TypeScript + React) and small on the backend (a few hundred lines per route file). The hardest parts are in `frontend/src/canvas/` (the Pixi-powered scene graph and sync engine).

---

## License

MIT — see [LICENSE](LICENSE). Built and maintained by [Hiren Kangad](https://metalfinger.xyz).
