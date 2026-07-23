# MattChat

Web chat for **LM Studio** and commercial OpenAI-compatible APIs, with **side-by-side A/B testing**.

- Streaming chat + timing (TTFT / total)
- Single or A/B mode
- Local or remote LM Studio (`http://host:1234/v1`)
- Optional cloud providers (xAI / OpenAI / Gemini / custom)
- Attachments: PDF, DOCX, text, images, audio, video

> **Not a static HTML page.** You need Node.js and a running MattChat server (or a link to someone else’s).

---

## Quick start

### macOS

```bash
git clone https://github.com/<OWNER>/MattChat.git
cd MattChat
chmod +x scripts/*.sh
./scripts/start-mac.sh
```

Open [http://localhost:3010](http://localhost:3010).

### Linux

```bash
git clone https://github.com/<OWNER>/MattChat.git
cd MattChat
chmod +x scripts/*.sh
./scripts/start-linux.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/<OWNER>/MattChat.git
cd MattChat
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # once, if needed
.\scripts\start-windows.ps1
```

Or double-click `scripts\start-windows.cmd`.

---

## Scripts

| OS | Local | LAN (others on network) | Public tunnel |
|----|--------|-------------------------|---------------|
| **macOS** | `./scripts/start-mac.sh` | `./scripts/start-mac.sh --public` | `./scripts/start-mac.sh --share` |
| **Linux** | `./scripts/start-linux.sh` | `./scripts/start-linux.sh --public` | `./scripts/start-linux.sh --share` |
| **Windows** | `.\scripts\start-windows.ps1` | `.\scripts\start-windows.ps1 -Public` | `.\scripts\start-windows.ps1 -Share` |

npm equivalents:

```bash
npm install
npm run dev           # localhost:3010
npm run dev:public    # 0.0.0.0:3010 (LAN)
npm run share         # localtunnel (server must already be running)
npm run build && npm start
```

Health check (macOS/Linux):

```bash
./scripts/check-env.sh
```

---

## Connect LM Studio

1. Load a model in LM Studio and **start Local Server** (port `1234`).
2. In MattChat → Provider **LM Studio** → Base URL:

| Where is LM Studio? | Base URL |
|---------------------|----------|
| Same computer | `http://127.0.0.1:1234/v1` |
| Another machine / campus | `http://HOSTNAME_OR_IP:1234/v1` |
| Example campus host | `http://vpit-llm2.jck.txstate.edu:1234/v1` |

3. Click **Scan**, select the **● loaded** model, send a message.

Optional default in `.env.local`:

```bash
cp .env.local.example .env.local
# edit LM_STUDIO_BASE_URL=...
```

Full LM Studio notes (network, firewall, ● loaded detection): see [SETUP.md](./SETUP.md).

---

## Share with a buddy

| Goal | Do this |
|------|---------|
| Friend on same network | Start with `--public` / `-Public`, send `http://YOUR_LAN_IP:3010` |
| Friend on the internet | Start with `--share` / `-Share`, send the `https://….loca.lt` link |
| Friend runs their own | They clone this repo and use the start script for their OS |

Copy/paste blurb and security notes: **[BUDDY.md](./BUDDY.md)**  
Full install & troubleshooting: **[SETUP.md](./SETUP.md)**

---

## Environment (optional)

| Variable | Used by |
|----------|---------|
| `LM_STUDIO_BASE_URL` | Default LM Studio OpenAI base (`…/v1`) |
| `LM_STUDIO_API_KEY` | Usually unused (`lm-studio`) |
| `XAI_API_KEY` | Grok / SpaceXAI |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Gemini |
| `CUSTOM_BASE_URL` / `CUSTOM_API_KEY` | Custom OpenAI-compatible host |

Keys can also be saved via the in-app **API keys** panel (`config/api-keys.json`, gitignored).

---

## Docs

| File | Contents |
|------|----------|
| [SETUP.md](./SETUP.md) | Install on Mac / Linux / Windows, LM Studio, production |
| [BUDDY.md](./BUDDY.md) | Share link + buddy testing |
| [AGENTS.md](./AGENTS.md) | Notes for AI coding agents |

---

## License

Private project unless a LICENSE file is added — check the repository settings.
