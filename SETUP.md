# MattChat setup (macOS · Linux · Windows)

One-page guide to install, run, connect LM Studio, and share with a buddy.

## Requirements

| Tool | Version |
|------|---------|
| **Node.js** | **18+** (20 LTS recommended) |
| **npm** | Comes with Node |
| **Git** | Optional but recommended |
| **LM Studio** (or other OpenAI-compatible API) | Optional if you only use cloud keys |

Check:

```bash
node -v    # v18.x or higher
npm -v
```

---

## 1. Get the code

```bash
git clone https://github.com/<OWNER>/MattChat.git
cd MattChat
```

Or download the ZIP from GitHub → **Code → Download ZIP** → unzip → open a terminal in that folder.

---

## 2. Start (pick your OS)

### macOS

```bash
chmod +x scripts/start-mac.sh scripts/check-env.sh
./scripts/start-mac.sh
```

| Flag | Meaning |
|------|---------|
| `./scripts/start-mac.sh` | Local only → http://localhost:3010 |
| `./scripts/start-mac.sh --public` | LAN: others use `http://YOUR_IP:3010` |
| `./scripts/start-mac.sh --share` | Temporary public HTTPS tunnel |

Install Node if needed: [nodejs.org](https://nodejs.org) or `brew install node`.

### Linux

```bash
chmod +x scripts/start-linux.sh scripts/check-env.sh
./scripts/start-linux.sh
```

Same flags as macOS: `--public`, `--share`.

Install Node 20 (examples):

```bash
# Ubuntu/Debian (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Fedora
sudo dnf install nodejs

# Arch
sudo pacman -S nodejs npm
```

### Windows

**PowerShell (recommended):**

```powershell
cd MattChat
# If script is blocked once:
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

.\scripts\start-windows.ps1
.\scripts\start-windows.ps1 -Public
.\scripts\start-windows.ps1 -Share
```

**Double-click / CMD:**

```text
scripts\start-windows.cmd
```

Install Node LTS: [nodejs.org](https://nodejs.org) or:

```powershell
winget install OpenJS.NodeJS.LTS
```

Then **close and reopen** the terminal.

---

## 3. Open the app

Browser:

```text
http://localhost:3010
```

First run installs `node_modules` and creates `.env.local` from `.env.local.example` if missing.

---

## 4. Connect LM Studio

### A. Local LM Studio (same machine)

1. Open LM Studio → load a model.
2. **Developer → Local Server → Start** (port **1234**).
3. In MattChat: Provider **LM Studio**, Base URL:

   ```text
   http://127.0.0.1:1234/v1
   ```

4. **Scan** → pick **● loaded** model → **Send**.

### B. Remote / campus server

Example (Texas State):

```text
http://vpit-llm2.jck.txstate.edu:1234/v1
```

Rules:

- Use **`http://`**, not `https://`
- Include port **`1234`**
- Path ends with **`/v1`**

The **machine running MattChat** must reach that host (campus network / VPN).  
Your buddy’s browser does **not** need VPN if *you* host MattChat on a machine that already can.

Optional default in `.env.local`:

```bash
LM_STUDIO_BASE_URL=http://vpit-llm2.jck.txstate.edu:1234/v1
```

### Health check (macOS / Linux)

```bash
./scripts/check-env.sh
```

Should show `200` for `/v1/models`. Native `/api/v0/models` → `200` enables **● loaded** detection.

---

## 5. Cloud APIs (optional)

In the UI open **API keys**, or set in `.env.local`:

| Variable | Provider |
|----------|----------|
| `XAI_API_KEY` | Grok / SpaceXAI |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Gemini |
| `CUSTOM_BASE_URL` | Any OpenAI-compatible host |

Keys stay **server-side** (never shipped to the browser as full secrets).

---

## 6. Share with a buddy

See **[BUDDY.md](./BUDDY.md)** for the short copy/paste blurb.

| Mode | How |
|------|-----|
| Same Wi‑Fi / LAN | `./scripts/start-mac.sh --public` (or Linux/Windows `-Public`) → `http://YOUR_LAN_IP:3010` |
| Public internet (temporary) | `--share` / `-Share` → send the `https://….loca.lt` URL |
| Buddy runs their own copy | They clone this repo and run the start script for their OS |

**HTML only does not work** — they need a running MattChat server (yours via link, or their own clone).

---

## 7. Production-style run (optional)

```bash
npm install
npm run build
npm start          # http://0.0.0.0:3010 (see package.json)
```

Use a process manager (systemd, PM2, NSSM on Windows) if you want it always on.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `node: command not found` | Install Node 20 LTS; reopen terminal |
| Port 3010 in use | `PORT=3020 ./scripts/start-mac.sh` or stop the other process |
| Scan fails / Offline | LM Studio server running? Correct Base URL? Firewall allow 1234? |
| Shows Gemma, not Qwen | Check **what is loaded on the remote server** — MattChat reports what LM Studio reports |
| `removeChild` / blank UI | Hard refresh; try private window (browser extensions) |
| Windows scripts blocked | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| loca.lt password page | Click through; temporary tunnels sometimes ask for your public IP |

---

## 9. Project layout (quick)

```text
MattChat/
  scripts/
    start-mac.sh
    start-linux.sh
    start-windows.ps1
    start-windows.cmd
    check-env.sh
  src/                 # Next.js app + API routes
  .env.local.example   # copy → .env.local
  BUDDY.md             # share / public testing
  SETUP.md             # this file
  README.md
```

---

## 10. Manual start (no scripts)

```bash
npm install
cp .env.local.example .env.local   # Windows: copy .env.local.example .env.local
npm run dev                        # localhost only
npm run dev:public                 # LAN
npm run share                      # tunnel (server must already be running)
```
