#!/usr/bin/env bash
# MattChat — run as a multi-user SERVER on a Mac (Studio / lab host)
# Clients open http://THIS_MAC_LAN_IP:3010 and share this process.
#
# Usage:
#   ./scripts/start-server-mac.sh
#   MATTCHAT_MAX_CONNECTIONS=100 ./scripts/start-server-mac.sh
#   MATTCHAT_SERVER_NAME="Lab Studio" ./scripts/start-server-mac.sh
#
# Env (also set in .env.local / .env.production):
#   MATTCHAT_HOST_MODE=server
#   MATTCHAT_MAX_CONNECTIONS=100
#   MATTCHAT_SERVER_NAME=Mac Studio Lab
#   MATTCHAT_ADMIN_TOKEN=change-me
#   LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1   # local LM Studio on same Mac
#   # or remote: http://lmstudio.example.com:1234/v1

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3010}"
export MATTCHAT_HOST_MODE="${MATTCHAT_HOST_MODE:-server}"
export MATTCHAT_MAX_CONNECTIONS="${MATTCHAT_MAX_CONNECTIONS:-100}"
export MATTCHAT_SERVER_NAME="${MATTCHAT_SERVER_NAME:-MattChat Server}"

echo "==> MattChat SERVER mode (macOS host)"
echo "    Mode:        $MATTCHAT_HOST_MODE"
echo "    Max streams: $MATTCHAT_MAX_CONNECTIONS"
echo "    Name:        $MATTCHAT_SERVER_NAME"
echo "    Port:        $PORT (0.0.0.0 — LAN reachable)"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ required"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> npm install…"
  npm install
fi

if [ ! -f .env.local ] && [ -f .env.local.example ]; then
  cp .env.local.example .env.local
  echo "==> Created .env.local — set LM_STUDIO_BASE_URL and MATTCHAT_* as needed"
fi

# Ensure server mode is in .env.local for next start (Next loads it)
if ! grep -q '^MATTCHAT_HOST_MODE=' .env.local 2>/dev/null; then
  {
    echo ""
    echo "MATTCHAT_HOST_MODE=server"
    echo "MATTCHAT_MAX_CONNECTIONS=${MATTCHAT_MAX_CONNECTIONS}"
    echo "MATTCHAT_SERVER_NAME=${MATTCHAT_SERVER_NAME}"
  } >> .env.local
  echo "==> Appended server mode defaults to .env.local"
fi

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
echo ""
echo "    Local:   http://localhost:${PORT}"
if [ -n "${LAN_IP:-}" ]; then
  echo "    LAN:     http://${LAN_IP}:${PORT}"
  echo "    Status:  http://${LAN_IP}:${PORT}/api/status"
fi
echo "    Admin:   GET /api/admin/status  (Bearer MATTCHAT_ADMIN_TOKEN if set)"
echo ""
echo "==> Building production bundle…"
npm run build

echo "==> Starting (Ctrl+C to stop)…"
exec npx next start --port "$PORT" --hostname 0.0.0.0
