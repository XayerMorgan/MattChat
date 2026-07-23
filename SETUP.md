# MattChat setup guide

Install MattChat on **your** computer and connect to a **shared LM Studio** host (e.g. Mac Studio).

## Architecture

```text
┌─────────────────────┐     ┌─────────────────────┐
│  Client A (you)     │     │  Client B (buddy)   │
│  MattChat :3010     │     │  MattChat :3010     │
│  localhost only     │     │  localhost only     │
└─────────┬───────────┘     └─────────┬───────────┘
          │  HTTP OpenAI API          │
          │  …/v1/chat/completions    │
          └────────────┬──────────────┘
                       ▼
          ┌────────────────────────────┐
          │  Mac Studio + LM Studio    │
          │  :1234  (shared for all)   │
          │  e.g. lmstudio.example.com       │
          └────────────────────────────┘
```

- Each person installs Node and runs MattChat **locally**.
- Everyone uses the **same Base URL** for LM Studio on the Mac Studio.
- You do **not** need to host MattChat publicly for teammates.

---

## Requirements (every client)

| Tool | Notes |
|------|--------|
| **Node.js 18+** | 20 LTS recommended — [nodejs.org](https://nodejs.org) |
| **npm** | Bundled with Node |
| **Git** | Or download ZIP of the repo |
| **Network** | Must reach the Mac Studio on port **1234** (LAN/VPN as required) |

You do **not** need LM Studio installed on the client unless you want a private local model.

---

## Install Node

### macOS

- Download LTS from [nodejs.org](https://nodejs.org), **or**
- `brew install node`

### Linux

```bash
# Ubuntu / Debian (example — Node 20)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Fedora
sudo dnf install nodejs npm

# Arch
sudo pacman -S nodejs npm
```

### Windows

- Install **LTS** from [nodejs.org](https://nodejs.org) (includes npm), **or**
- `winget install OpenJS.NodeJS.LTS`
- **Close and reopen** PowerShell / Terminal after install

Verify:

```bash
node -v
npm -v
```

---

## Get MattChat

```bash
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
```

Or: GitHub → **Code → Download ZIP** → unzip → open a terminal in that folder.

---

## Start MattChat

### macOS

```bash
chmod +x scripts/*.sh
./scripts/start-mac.sh
```

### Linux

```bash
chmod +x scripts/*.sh
./scripts/start-linux.sh
```

### Windows (PowerShell)

```powershell
# If you get an execution policy error (once):
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

.\scripts\start-windows.ps1
```

### Windows (double-click)

Run:

```text
scripts\start-windows.cmd
```

### What you should see

```text
==> Starting MattChat on http://localhost:3010
```

Open a browser to:

```text
http://localhost:3010
```

Stop the server with **Ctrl+C** in the terminal.

First run will:

- run `npm install` (can take a minute)
- create `.env.local` from `.env.local.example` if missing

---

## Connect to the shared Mac Studio

> **Docs use fake hosts only.**  
> `lmstudio.example.com` and `203.0.113.10` are placeholders (not real machines).  
> Replace them with **your** LM Studio hostname or IP. Same-machine: `http://127.0.0.1:1234/v1`.

### In the UI

1. **Provider:** LM Studio  
2. **Base URL:**

   ```text
   http://lmstudio.example.com:1234/v1
   ```

   (Replace with your real hostname/IP.)

3. Click **Scan**  
4. Choose the model marked **● loaded** (or the id of the model loaded on the Studio)  
5. Type a message → **Send**

### Default Base URL (so you don’t retype it)

Edit `.env.local` in the project root:

```bash
LM_STUDIO_BASE_URL=http://lmstudio.example.com:1234/v1
```

Restart MattChat after changing `.env.local`.

### URL rules

| Correct | Incorrect |
|---------|-----------|
| `http://lmstudio.example.com:1234/v1` | `https://…` (use http) |
| `http://203.0.113.10:1234/v1` | Missing port |
| `http://host:1234` (auto-adds `/v1` on blur) | `…/v1/v1` |

---

## Mac Studio admin (one-time / ongoing)

On the **host** machine only:

1. Open **LM Studio**
2. Load the model the team should use (one primary model is simplest)
3. **Developer → Local Server → Start Server**
4. Port **1234**
5. Turn on **Serve on Local Network**
6. Firewall: allow inbound **TCP 1234**
7. Give teammates the Base URL:

   ```text
   http://<hostname-or-ip>:1234/v1
   ```

Verify from a client:

```bash
# Catalog
curl -s -o /dev/null -w "%{http_code}\n" \
  http://lmstudio.example.com:1234/v1/models

# Load state (● detection) — optional but nice
curl -s -o /dev/null -w "%{http_code}\n" \
  http://lmstudio.example.com:1234/api/v0/models
```

Both should return `200` when healthy. If only `/v1/models` works, Scan still lists models; pick the loaded one by name manually.

Mac/Linux helper from the repo:

```bash
# After setting LM_STUDIO_BASE_URL in .env.local
./scripts/check-env.sh
```

---

## Optional: cloud providers

Use the **API keys** panel in the UI, or `.env.local`:

| Variable | Service |
|----------|---------|
| `XAI_API_KEY` | Grok / SpaceXAI |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `CUSTOM_BASE_URL` + `CUSTOM_API_KEY` | Other OpenAI-compatible APIs |

These keys live only on **your** laptop (never committed; `config/api-keys.json` is gitignored).

---

## npm-only workflow (no shell scripts)

```bash
cd MattChat
npm install
cp .env.local.example .env.local    # Windows: copy .env.local.example .env.local
# edit LM_STUDIO_BASE_URL in .env.local
npm run dev
```

Production-style on your machine:

```bash
npm run build
npm start
```

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `node: command not found` | Install Node 20 LTS; open a **new** terminal |
| Port 3010 already in use | Quit the other MattChat, or `PORT=3020 ./scripts/start-mac.sh` |
| Scan fails / Offline | Can you `curl` the Mac Studio `/v1/models`? On VPN/LAN? Server started in LM Studio? |
| Wrong model selected | Load the right model **on the Mac Studio**; Scan again; pick **● loaded** |
| “Gemma” but you wanted Qwen | Whatever is **loaded in LM Studio on the Studio** is what the API reports — check the host, not only MattChat |
| Windows “cannot be loaded” | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Blank page / odd DOM errors | Hard refresh; try a private window (extensions) |
| Slow first start | First `npm install` downloads packages — wait it out |

---

## Script reference

| File | Platform |
|------|----------|
| `scripts/start-mac.sh` | macOS |
| `scripts/start-linux.sh` | Linux |
| `scripts/start-windows.ps1` | Windows PowerShell |
| `scripts/start-windows.cmd` | Windows double-click |
| `scripts/check-env.sh` | macOS/Linux connectivity check |
| `scripts/publish-github.sh` | Optional: publish repo with `gh` |

---

## For teammates (one paragraph)

> Clone the MattChat repo, install Node 18+, run the start script for your OS, open http://localhost:3010, set LM Studio Base URL to `http://lmstudio.example.com:1234/v1`, click Scan, pick the loaded model, chat. You need LAN or VPN access to that host; you do not need LM Studio on your laptop.
