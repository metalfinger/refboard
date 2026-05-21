# RefBoard one-click installer (Windows PowerShell).
# Spins up the Docker Compose stack, waits for the backend to come up, and
# opens the browser. Idempotent.
#
# Usage:
#   pwsh -File scripts/setup.ps1
#   # or in a PowerShell session at the repo root:
#   .\scripts\setup.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Info { param([string]$Msg) Write-Host "[setup] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[setup] $Msg" -ForegroundColor Green }
function Write-Fail { param([string]$Msg) Write-Host "[setup] $Msg" -ForegroundColor Red; exit 1 }

# 1. Docker check
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Fail "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
}

$null = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Docker daemon is not running. Start Docker Desktop, then re-run this script."
}

# 2. Compose (v2 plugin preferred, legacy docker-compose fallback)
$composeCmd = $null
$null = docker compose version 2>&1
if ($LASTEXITCODE -eq 0) {
  $composeCmd = @('docker', 'compose')
} elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
  $composeCmd = @('docker-compose')
} else {
  Write-Fail "Docker Compose is not installed. Re-install Docker Desktop (it bundles Compose v2)."
}

# 3. Working dir = repo root
Set-Location (Split-Path -Parent $PSScriptRoot)

# 4. .env
if (-not (Test-Path .env)) {
  if (-not (Test-Path .env.example)) {
    Write-Fail "Neither .env nor .env.example found in $(Get-Location). Are you running this from the repo?"
  }
  Copy-Item .env.example .env
  Write-Ok "Copied .env.example -> .env (defaults are fine for a local install)"
} else {
  Write-Info ".env already exists; leaving it untouched."
}

# 5. Pull + up
$composeStr = ($composeCmd -join ' ')
Write-Info "Pulling image (this may take a moment on first run)..."
& $composeCmd[0] $composeCmd[1..($composeCmd.Length - 1)] pull

Write-Info "Starting RefBoard..."
& $composeCmd[0] $composeCmd[1..($composeCmd.Length - 1)] up -d --build

# 6. Wait for /health
$Url = "http://localhost:8000"
Write-Info "Waiting for backend at $Url/health (max 90s)..."
$up = $false
for ($i = 1; $i -le 90; $i++) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "$Url/health" -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $up = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $up) {
  Write-Fail "Backend didn't respond within 90s. Check logs with: $composeStr logs -f refboard"
}
Write-Ok "Backend is up."

# 7. Summary + browser
Write-Host ""
Write-Host "  RefBoard is running." -ForegroundColor Green
Write-Host ""
Write-Host "    URL:           $Url"
Write-Host "    Admin setup:   open the URL. The first account you create becomes admin."
Write-Host "    Data dir:      .\.docker-data\  (SQLite + MinIO objects; back this up)"
Write-Host "    Stop:          $composeStr down"
Write-Host "    Logs:          $composeStr logs -f refboard"
Write-Host ""

Start-Process $Url
