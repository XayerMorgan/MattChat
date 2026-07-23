# MattChat — Windows PowerShell start script
# Usage (from repo root or scripts folder):
#   .\scripts\start-windows.ps1
#   .\scripts\start-windows.ps1 -Public
#   .\scripts\start-windows.ps1 -Share
#
# If scripts are blocked:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

param(
  [switch]$Public,
  [switch]$Share,
  [int]$Port = 3010
)

$ErrorActionPreference = "Stop"

# Move to repo root (parent of scripts/)
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = Get-Location
}
Set-Location $Root

Write-Host "==> MattChat (Windows)" -ForegroundColor Cyan
Write-Host "    Project: $Root"

# Node check
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "ERROR: Node.js not found." -ForegroundColor Red
  Write-Host "  Install LTS from https://nodejs.org and re-open PowerShell."
  Write-Host "  Or with winget:  winget install OpenJS.NodeJS.LTS"
  exit 1
}

$nodeVer = & node -v
$major = [int](($nodeVer -replace '^v','') -split '\.')[0]
if ($major -lt 18) {
  Write-Host "ERROR: Node.js 18+ required (found $nodeVer)." -ForegroundColor Red
  exit 1
}
Write-Host "    Node: $nodeVer"

if (-not (Test-Path "package.json")) {
  Write-Host "ERROR: package.json missing — run from the MattChat repo." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "==> Installing dependencies (first run)…" -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path ".env.local") -and (Test-Path ".env.local.example")) {
  Write-Host "==> Creating .env.local from example (edit for LM Studio URL / API keys)"
  Copy-Item ".env.local.example" ".env.local"
}

$hostnameArgs = @()
if ($Public -or $Share) {
  $hostnameArgs = @("--hostname", "0.0.0.0")
  Write-Host "==> Binding to all interfaces (LAN access enabled)" -ForegroundColor Yellow
  try {
    $lan = Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($lan) {
      Write-Host "    LAN URL: http://${lan}:${Port}"
    }
  } catch {
    # older Windows without Get-NetIPAddress
  }
}

$tunnelJob = $null
if ($Share) {
  Write-Host "==> Starting public tunnel (localtunnel)…" -ForegroundColor Yellow
  $tunnelJob = Start-Job -ScriptBlock {
    param($p)
    Set-Location $using:Root
    npx --yes localtunnel --port $p
  } -ArgumentList $Port
  Start-Sleep -Seconds 3
  Receive-Job $tunnelJob -ErrorAction SilentlyContinue
  Write-Host "    Watch for a https://….loca.lt URL in job output (Receive-Job)."
}

Write-Host "==> Starting MattChat on http://localhost:$Port" -ForegroundColor Green
Write-Host "    Ctrl+C to stop"
Write-Host ""

try {
  if ($hostnameArgs.Count -gt 0) {
    npx next dev --port $Port @hostnameArgs --webpack
  } else {
    npx next dev --port $Port --webpack
  }
} finally {
  if ($tunnelJob) {
    Stop-Job $tunnelJob -ErrorAction SilentlyContinue
    Remove-Job $tunnelJob -ErrorAction SilentlyContinue
  }
}
