#!/usr/bin/env bash
# MattChat — Linux start script
# Usage:  ./scripts/start-linux.sh
#         ./scripts/start-linux.sh --public    # listen on all interfaces (LAN)
#         ./scripts/start-linux.sh --share     # LAN + temporary public tunnel

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3010}"
PUBLIC=0
SHARE=0
for arg in "$@"; do
  case "$arg" in
    --public) PUBLIC=1 ;;
    --share)  PUBLIC=1; SHARE=1 ;;
    --help|-h)
      echo "Usage: $0 [--public] [--share]"
      echo "  --public  Bind 0.0.0.0 so other devices on your network can connect"
      echo "  --share   Also start a temporary public HTTPS tunnel (localtunnel)"
      exit 0
      ;;
  esac
done

echo "==> MattChat (Linux)"
echo "    Project: $(pwd)"
echo "    Pattern: MattChat runs HERE; LM Studio is usually a shared host"
echo "             (set LM_STUDIO_BASE_URL in .env.local, e.g. Mac Studio)"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found."
  echo "  Install Node 20 LTS, e.g.:"
  echo "    # Debian/Ubuntu (nodesource or snap)"
  echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "    sudo apt-get install -y nodejs"
  echo "    # Fedora:  sudo dnf install nodejs"
  echo "    # Arch:    sudo pacman -S nodejs npm"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required (found $(node -v))."
  exit 1
fi
echo "    Node: $(node -v)"

if [ ! -f package.json ]; then
  echo "ERROR: package.json missing — run this from the MattChat repo."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run)…"
  npm install
fi

if [ ! -f .env.local ] && [ -f .env.local.example ]; then
  echo "==> Creating .env.local from example (edit to set LM Studio URL / API keys)"
  cp .env.local.example .env.local
fi

HOST_FLAG=()
if [ "$PUBLIC" -eq 1 ]; then
  HOST_FLAG=(--hostname 0.0.0.0)
  echo "==> Binding to all interfaces (LAN access enabled)"
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  if [ -z "${LAN_IP:-}" ]; then
    LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)
  fi
  if [ -n "${LAN_IP:-}" ]; then
    echo "    LAN URL: http://${LAN_IP}:${PORT}"
  fi
fi

if [ "$SHARE" -eq 1 ]; then
  echo "==> Starting public tunnel in background (localtunnel)…"
  npx --yes localtunnel --port "$PORT" &
  TUNNEL_PID=$!
  trap 'kill $TUNNEL_PID 2>/dev/null || true' EXIT
  sleep 2
  echo "    Tunnel starting — watch for a https://….loca.lt URL above/below"
fi

echo "==> Starting MattChat on http://localhost:${PORT}"
echo "    Ctrl+C to stop"
echo ""
exec npx next dev --port "$PORT" "${HOST_FLAG[@]}" --webpack
