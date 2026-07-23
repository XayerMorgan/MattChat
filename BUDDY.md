# MattChat — buddy test guide

HTML alone **does not work**. MattChat is a Next.js app: the browser UI needs the MattChat **server**, and that server talks to LM Studio / APIs.

## Option A — Use a shared public link (easiest for your buddy)

Someone on campus (you) runs MattChat; buddy opens a public HTTPS URL.

### You (host)

```bash
cd MattChat
npm install
# optional default remote LM Studio:
# echo 'LM_STUDIO_BASE_URL=http://vpit-llm2.jck.txstate.edu:1234/v1' >> .env.local
npm run dev:public
```

In a **second** terminal, expose port 3010:

```bash
# free temporary public URL (no account)
npx --yes localtunnel --port 3010
```

Or, if you have Cloudflare Tunnel installed:

```bash
cloudflared tunnel --url http://127.0.0.1:3010
```

Send your buddy the URL printed (e.g. `https://something.loca.lt`).

**Keep both terminals running** while they test.

### Your buddy

1. Open the link you sent.
2. Source A → provider **LM Studio**.
3. Base URL:

   ```text
   http://vpit-llm2.jck.txstate.edu:1234/v1
   ```

   (Or leave blank if you set `LM_STUDIO_BASE_URL` on the host.)
4. Click **Scan**, pick the **● loaded** model (or the model that is loaded on the remote server).
5. Send a message.

**Network note:** The MattChat **server** (your Mac) must reach `vpit-llm2…:1234`. Your buddy does **not** need VPN to the LLM host if *you* host MattChat on a machine that already can.

---

## Option B — Same campus / LAN only (no public internet)

You run:

```bash
npm run dev:public
```

Buddy opens:

```text
http://<YOUR_MAC_LAN_IP>:3010
```

Example: `http://10.40.0.113:3010`  
Find your IP: System Settings → Network, or `ipconfig getifaddr en0`.

Both of you need to be on a network that can reach that IP (and the host must reach LM Studio).

---

## Option C — Buddy runs MattChat themselves

```bash
git clone <your-repo-url>
cd MattChat
npm install
npm run dev
```

Open `http://localhost:3010`, set Base URL to the LM Studio host, Scan, chat.

His machine must reach the LM Studio URL (campus network / VPN if required).

---

## What to tell your buddy (copy/paste)

```text
MattChat buddy test

1) Open: <PASTE_PUBLIC_OR_LAN_URL>
2) Provider: LM Studio
3) Base URL: http://vpit-llm2.jck.txstate.edu:1234/v1
4) Click Scan → select the loaded model (●)
5) Type a message → Send

If Scan fails: the host machine must be online and able to reach vpit-llm2:1234.
You only need a browser — no install if using Option A or B.
```

---

## Security (public links)

- A public tunnel exposes **your** MattChat instance to anyone with the URL.
- Users can point Base URL at hosts **your server** can reach (including campus LM Studio).
- Prefer a temporary tunnel; stop it when done.
- Do not put production API keys in a casually shared public instance unless you trust testers.

---

## Checklist before inviting someone

- [ ] LM Studio on the target host is running (port 1234)
- [ ] From the MattChat host: `curl -s -o /dev/null -w "%{http_code}\n" http://vpit-llm2.jck.txstate.edu:1234/v1/models` → `200`
- [ ] `npm run dev:public` is running
- [ ] Tunnel or LAN URL works in an incognito window
- [ ] Scan shows models; chat returns a reply
