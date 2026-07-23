# Hand this to a teammate

**Goal:** You run MattChat on **your** computer. Everyone talks to the **same Mac Studio** LM Studio server. No shared HTML, no tunnel required.

```text
Your PC  →  MattChat (localhost:3010)  →  Mac Studio LM Studio (:1234)
```

---

## You need

1. **Node.js 18+** — https://nodejs.org (LTS)  
2. This **git repo** (clone or ZIP)  
3. Network access to the lab host (campus / VPN as required)

You do **not** need LM Studio on your laptop.

---

## Install & start

### Mac

```bash
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
chmod +x scripts/*.sh
./scripts/start-mac.sh
```

### Linux

```bash
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
chmod +x scripts/*.sh
./scripts/start-linux.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/XayerMorgan/MattChat.git
cd MattChat
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\scripts\start-windows.ps1
```

Browser: **http://localhost:3010**

---

## Point at the Mac Studio

| Setting | Value |
|---------|--------|
| Provider | **LM Studio** |
| Base URL | `http://vpit-llm2.jck.txstate.edu:1234/v1` |

1. Click **Scan**  
2. Select the **● loaded** model (whatever is loaded on the Studio)  
3. Send a message  

Optional — save as default in `.env.local`:

```bash
LM_STUDIO_BASE_URL=http://vpit-llm2.jck.txstate.edu:1234/v1
```

---

## Quick test from a terminal

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  http://vpit-llm2.jck.txstate.edu:1234/v1/models
```

- **200** → you can reach the Studio; open MattChat and Scan  
- **fail / timeout** → VPN, campus network, or LM Studio server not running on the host  

---

## Copy/paste (short)

```text
1. Install Node LTS from https://nodejs.org
2. git clone https://github.com/XayerMorgan/MattChat.git && cd MattChat
3. Mac/Linux:  ./scripts/start-mac.sh   or  ./scripts/start-linux.sh
   Windows:    .\scripts\start-windows.ps1
4. Open http://localhost:3010
5. Provider: LM Studio
6. Base URL: http://vpit-llm2.jck.txstate.edu:1234/v1
7. Scan → pick ● loaded model → chat
```

Full detail: **[SETUP.md](./SETUP.md)**
