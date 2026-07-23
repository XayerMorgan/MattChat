# MattChat

Local web chat client for a **shared LM Studio server** (and optional cloud APIs), with side-by-side **A/B testing**.

## How this is meant to work

### Pattern A — Local clients (default / team install)

```text
  Each person's laptop runs MattChat → http://localhost:3010
                 │
                 ▼
  Shared Mac Studio LM Studio → http://host:1234/v1
```

| Piece | Who runs it | Where |
|--------|-------------|--------|
| **MattChat** | Each person | Their own Mac / Linux / Windows PC |
| **LM Studio** | Lab / host | One Mac Studio, port **1234** |

### Pattern B — Shared MattChat server (optional later)

Run MattChat **once** on the Mac Studio; everyone opens `http://studio-ip:3010`.

```bash
./scripts/start-server-mac.sh   # MATTCHAT_HOST_MODE=server, max 100 connections
```

| Mode | Env | Capacity | UI badge |
|------|-----|----------|----------|
| **Local** | `MATTCHAT_HOST_MODE=local` | default 32 | Local |
| **Server** | `MATTCHAT_HOST_MODE=server` | **100** concurrent streams | Server · n/100 |

Status API: `GET /api/status` · Admin: `GET /api/admin/status`  
Details: **[docs/SERVER.md](./docs/SERVER.md)**

You do **not** share HTML only. Clients either install the app (A) or use the shared server URL (B).

---

## Quick start (any client)

### 1. Prerequisites

- **Node.js 18+** (20 LTS recommended) — [nodejs.org](https://nodejs.org)
- Network path to the LM Studio host (same LAN / LAN / VPN)
- **Git** (or download a ZIP of this repo)

```bash
node -v   # should print v18+ or v20+
```

### 2. Install & run

**macOS**

```bash
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
chmod +x scripts/*.sh
./scripts/start-mac.sh
```

**Linux**

```bash
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
chmod +x scripts/*.sh
./scripts/start-linux.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # once if scripts are blocked
.\scripts\start-windows.ps1
```

Or double-click `scripts\start-windows.cmd`.

Open: **http://localhost:3010**

### 3. Point at your shared LM Studio host

In MattChat → Source A:

| Field | Value |
|--------|--------|
| Provider | **LM Studio** |
| Base URL | `http://127.0.0.1:1234/v1` (same machine) **or** your shared host, e.g. `http://203.0.113.10:1234/v1` |

Docs use **fake** hosts (`lmstudio.example.com`, `203.0.113.10`) — substitute your real hostname/IP.

Then **Scan** → select the **● loaded** model → **Send**.

To make that the default every time, edit `.env.local` (created on first start):

```bash
# example only — replace with your real host
LM_STUDIO_BASE_URL=http://203.0.113.10:1234/v1
```

---

## Start scripts

| OS | Command |
|----|---------|
| macOS | `./scripts/start-mac.sh` |
| Linux | `./scripts/start-linux.sh` |
| Windows | `.\scripts\start-windows.ps1` or `scripts\start-windows.cmd` |

What the scripts do:

1. Check Node.js version  
2. `npm install` on first run  
3. Copy `.env.local.example` → `.env.local` if needed  
4. Start MattChat on **http://localhost:3010**

Optional flags (Mac/Linux): `--public` bind LAN; `--share` temporary tunnel.  
Windows: `-Public`, `-Share`.  

**Normal team use does not need those flags** — everyone runs MattChat on `localhost` and only the **Base URL** points at the Mac Studio.

Health check (Mac/Linux):

```bash
./scripts/check-env.sh
```

---

## Mac Studio (LM Studio host) checklist

Whoever administers the shared box should:

1. Install and open **LM Studio**
2. Download / load the model users should chat with
3. **Developer → Local Server → Start** (port **1234**)
4. Enable **Serve on Local Network** (or equivalent)
5. Allow firewall inbound **TCP 1234**
6. Confirm hostname resolves for clients, e.g.  
   `http://lmstudio.example.com:1234/v1`

From any client machine:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://lmstudio.example.com:1234/v1/models
# expect 200
```

---

## Docs

| Doc | Purpose |
|-----|---------|
| **[SETUP.md](./SETUP.md)** | Full install (Mac / Linux / Windows), env, troubleshooting |
| **[BUDDY.md](./BUDDY.md)** | Short handoff for a teammate (“clone, run, point here”) |
| **[docs/SERVER.md](./docs/SERVER.md)** | Multi-user Mac Studio hosting, capacity, admin API |

---

## Features (short)

- Single chat or A/B side-by-side
- Streaming + TTFT / duration timing
- LM Studio local or remote; optional xAI / OpenAI / Gemini / custom
- Attachments (PDF, DOCX, text, images, audio, video)
- Fast mode (less thinking budget on reasoning models)

---

## Optional cloud APIs

Set in `.env.local` or the in-app **API keys** panel:

| Variable | Provider |
|----------|----------|
| `XAI_API_KEY` | Grok / SpaceXAI |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Gemini |
| `CUSTOM_BASE_URL` | Other OpenAI-compatible servers |

Keys stay on **your** machine (server-side), not in the browser.

---

## npm commands (if you prefer)

```bash
npm install
cp .env.local.example .env.local   # Windows: copy .env.local.example .env.local
npm run dev                        # http://localhost:3010
npm run build && npm start         # production-style local run
```
