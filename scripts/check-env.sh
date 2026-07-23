#!/usr/bin/env bash
# Quick environment + LM Studio reachability check (macOS / Linux)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Node: $(command -v node >/dev/null && node -v || echo MISSING)"
echo "==> npm:  $(command -v npm >/dev/null && npm -v || echo MISSING)"

if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  set -a
  # only pull LM_STUDIO_BASE_URL without executing arbitrary shell
  BASE=$(grep -E '^LM_STUDIO_BASE_URL=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  set +a
else
  BASE=""
fi
BASE="${BASE:-http://127.0.0.1:1234/v1}"
ORIGIN="${BASE%/v1}"
ORIGIN="${ORIGIN%/}"

echo "==> LM Studio base: $BASE"
echo -n "    GET $BASE/models … "
CODE=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer lm-studio" "$BASE/models" 2>/dev/null || echo "fail")
echo "$CODE"

echo -n "    GET $ORIGIN/api/v0/models … "
CODE2=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer lm-studio" "$ORIGIN/api/v0/models" 2>/dev/null || echo "fail")
echo "$CODE2"

if [ "$CODE" = "200" ]; then
  echo "OK — OpenAI-compatible API reachable"
else
  echo "WARN — cannot reach LM Studio catalog. Start Local Server and check Base URL."
fi
if [ "$CODE2" = "200" ]; then
  echo "OK — native API reachable (● loaded model detection works)"
else
  echo "NOTE — native /api/v0 not available; Scan can list models but may not mark ● loaded"
fi
