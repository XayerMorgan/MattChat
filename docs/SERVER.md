# MattChat server hosting (Mac Studio / lab host)

Run **one** MattChat process that many people open in their browsers  
(e.g. `http://mac-studio.lab:3010`), with capacity for **up to 100 concurrent** chat streams.

You can still use the other pattern (everyone installs MattChat locally).  
This doc is for **shared server mode**.

## Local vs server mode

| | **Local** (`MATTCHAT_HOST_MODE=local`) | **Server** (`MATTCHAT_HOST_MODE=server`) |
|--|----------------------------------------|------------------------------------------|
| Who runs MattChat | Each person’s laptop | One Mac Studio / lab machine |
| Browser URL | `http://localhost:3010` | `http://<studio-ip>:3010` |
| Default max connections | 32 | **100** |
| Capacity when full | Soft limit | HTTP **503** + `Retry-After` |
| UI badge | **Local** | **Server** + `active/max` |
| Admin API | Open | Optional Bearer token |

The UI polls `GET /api/status` and shows the mode + connection count.

## Quick start (server on the Mac)

```bash
cd MattChat
chmod +x scripts/start-server-mac.sh
# optional:
# export MATTCHAT_SERVER_NAME="Lab Mac Studio"
# export MATTCHAT_MAX_CONNECTIONS=100
# export MATTCHAT_ADMIN_TOKEN='your-long-secret'
# export LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
./scripts/start-server-mac.sh
```

Or:

```bash
# .env.local
MATTCHAT_HOST_MODE=server
MATTCHAT_MAX_CONNECTIONS=100
MATTCHAT_SERVER_NAME=Lab Mac Studio
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1

npm install
npm run build
npm start   # listens on 0.0.0.0:3010
```

Tell users:

```text
Open http://<THIS_MAC_LAN_IP>:3010
Provider: LM Studio
Base URL: (default from server env, or paste Studio LM URL)
Scan → chat
```

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `MATTCHAT_HOST_MODE` | `local` | `local` or `server` |
| `MATTCHAT_MAX_CONNECTIONS` | `100` in server / `32` in local | Concurrent heavy slots (chat streams) |
| `MATTCHAT_SERVER_NAME` | auto | Label in the UI |
| `MATTCHAT_ADMIN_TOKEN` | empty | If set in server mode, required for admin API |
| `LM_STUDIO_BASE_URL` | — | Default model backend |

## APIs

### Public status

```http
GET /api/status
```

```json
{
  "ok": true,
  "mode": "server",
  "serverName": "Lab Mac Studio",
  "maxConnections": 100,
  "activeConnections": 12,
  "availableConnections": 88,
  "isServerMode": true,
  "atCapacity": false,
  "uptimeSec": 3600,
  "version": "0.1.0"
}
```

### Admin status

```http
GET /api/admin/status
Authorization: Bearer <MATTCHAT_ADMIN_TOKEN>
```

Returns the same fields plus live connection list, peaks, accept/reject counts.

Example:

```bash
curl -s http://localhost:3010/api/status | python3 -m json.tool
curl -s -H "Authorization: Bearer $MATTCHAT_ADMIN_TOKEN" \
  http://localhost:3010/api/admin/status | python3 -m json.tool
```

## Capacity model

- Each **chat stream** (`POST /api/chat`) holds one slot until the stream ends or the client disconnects.
- **Model scans** use a soft ceiling (~1.25× max) so a full chat queue does not block everyone from scanning.
- Over capacity → **503** JSON:

  ```json
  { "ok": false, "code": "CAPACITY", "error": "Server at capacity (100/100…)", "retryAfterSec": 5 }
  ```

- Clients send `X-MattChat-Client-Id` (browser localStorage) so admin views can distinguish users.

**Scope:** counters are **in-memory for one Node process**. Run a single `next start` on the Mac (do not scale to multiple workers without an external store).

## Production tips on macOS

1. Keep LM Studio Local Server running (or point at another host).
2. Firewall: allow **TCP 3010** (MattChat) and **1234** (LM Studio if remote clients hit it directly — not required if only MattChat talks to LM Studio).
3. Prefer `npm run build && npm start` (or `start-server-mac.sh`) over `next dev` for multi-user.
4. Optional: `launchd` plist to start on boot.
5. Set `MATTCHAT_ADMIN_TOKEN` if the host is on a shared network.

## Choosing a pattern later

| Need | Pattern |
|------|---------|
| Teammates install git repo | **Local clients** → shared LM Studio only |
| Zero install for users | **Server mode** on Mac Studio → browsers only |
| Both | Run server mode on Studio; power users can still clone for offline/dev |

You can switch modes any time by changing `MATTCHAT_HOST_MODE` and restarting.
