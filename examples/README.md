# Deployment examples

Ready-to-use configs for the common ways people host RefBoard. All of these
use the pre-built image at `ghcr.io/metalfinger/refboard:latest` so you
don't have to build locally.

| File | What it gives you |
|---|---|
| [`compose/minimal-fs.yml`](compose/minimal-fs.yml) | Single container, local filesystem storage, no MinIO. Smallest possible footprint — good for home servers / NAS. |
| [`compose/cloudflared-paired.yml`](compose/cloudflared-paired.yml) | RefBoard + a Cloudflare Tunnel sidecar. No open inbound ports. Pair with a Cloudflare-managed hostname. |
| [`compose/behind-caddy.yml`](compose/behind-caddy.yml) | RefBoard + Caddy reverse proxy with automatic Let's Encrypt TLS. For public VPS-style hosts. |
| [`compose/Caddyfile`](compose/Caddyfile) | Caddyfile consumed by `behind-caddy.yml`. |
| [`fly.toml`](fly.toml) | Fly.io deployment manifest. FS storage + persistent volume. |
| [`render.yaml`](render.yaml) | Render.com Blueprint with attached disk. Copy to repo root before importing. |

The default [`docker-compose.yml`](../docker-compose.yml) at the repo root still spins up RefBoard + MinIO for S3-compatible storage. Use that if you want the MinIO console at :9001 or plan to swap in an external S3 bucket later. The variants here use the FS adapter (`STORAGE_BACKEND=fs`) to drop MinIO and keep everything in one container.

## Coolify / Dokploy / CapRover

These PaaS-style self-hosted platforms consume the repo's `docker-compose.yml` (or any of the variants above) directly. Point them at the repo, pick the compose file, set environment variables in the platform's UI, and you're done. Persistent state is the `./.docker-data/` volume — make sure your platform retains it across redeploys.

## Railway

Railway can deploy directly from a Dockerfile or container image. Use:

- Source: container image `ghcr.io/metalfinger/refboard:latest`
- Port: `8000`
- Persistent volume: `/app/data` (10+ GB)
- Env: `STORAGE_BACKEND=fs`, `NODE_ENV=production`, plus optionally `JWT_SECRET`, `CORS_ORIGIN`, `ALLOW_SELF_REGISTRATION`

## Going public from a personal install

The README's [going-public checklist](../README.md#checklist-when-going-public) applies to all of these — set `JWT_SECRET`, lock `CORS_ORIGIN`, confirm self-registration is off, back up `./.docker-data/`.
