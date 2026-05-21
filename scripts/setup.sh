#!/usr/bin/env bash
#
# RefBoard one-click installer (macOS / Linux).
# Spins up the Docker Compose stack, waits for the backend to come up, and
# opens the browser. Idempotent — safe to re-run.
#
# Usage:
#   bash scripts/setup.sh
#   # or pipe-to-bash from the repo:
#   curl -fsSL https://raw.githubusercontent.com/metalfinger/refboard/main/scripts/setup.sh | bash

set -euo pipefail

BLUE=$'\033[34m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
info()  { printf "%s[setup]%s %s\n" "$BLUE" "$RESET" "$*"; }
ok()    { printf "%s[setup]%s %s\n" "$GREEN" "$RESET" "$*"; }
fail()  { printf "%s[setup]%s %s\n" "$RED"   "$RESET" "$*" >&2; exit 1; }

# 1. Docker check
if ! command -v docker >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) fail "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" ;;
    Linux)  fail "Docker is not installed. On Debian/Ubuntu: sudo apt install docker.io docker-compose-plugin" ;;
    *)      fail "Docker is not installed." ;;
  esac
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not running. Start Docker Desktop (macOS) or 'sudo systemctl start docker' (Linux), then re-run."
fi

# Compose v2 plugin vs. legacy
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "Docker Compose is not installed. On Linux: sudo apt install docker-compose-plugin"
fi

# 2. Working dir = repo root (parent of this script)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR/.."

# 3. .env
if [ ! -f .env ]; then
  if [ ! -f .env.example ]; then
    fail "Neither .env nor .env.example found in $(pwd). Are you running this from the repo?"
  fi
  cp .env.example .env
  ok "Copied .env.example -> .env (defaults are fine for a local install)"
else
  info ".env already exists; leaving it untouched."
fi

# 4. Pull + up
info "Pulling image (this may take a moment on first run)..."
"${COMPOSE[@]}" pull --ignore-pull-failures 2>/dev/null || "${COMPOSE[@]}" pull || true

info "Starting RefBoard..."
"${COMPOSE[@]}" up -d --build

# 5. Wait for /health
URL="http://localhost:8000"
info "Waiting for backend to come up at ${URL}/health (max 90s)..."
for i in $(seq 1 90); do
  if curl -fsS "${URL}/health" >/dev/null 2>&1; then
    ok "Backend is up."
    break
  fi
  if [ "$i" = "90" ]; then
    fail "Backend didn't respond within 90s. Check logs: ${COMPOSE[*]} logs -f refboard"
  fi
  printf "${DIM}.${RESET}"
  sleep 1
done
printf "\n"

# 6. Print summary + open browser
cat <<EOF

  ${GREEN}RefBoard is running.${RESET}

    URL:           ${URL}
    Admin setup:   open the URL — the first account you create becomes admin.
    Data dir:      ./.docker-data/  (SQLite + MinIO objects; back this up)
    Stop:          ${COMPOSE[*]} down
    Logs:          ${COMPOSE[*]} logs -f refboard

EOF

# Open browser (best-effort)
if command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
