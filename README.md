# MattChat

Web chat frontend for **LM Studio** and commercial OpenAI-compatible APIs, with **side-by-side A/B testing** of two sources on the same prompt.

## Features

- **Single chat** against one provider/model
- **A/B mode**: same prompt → Source A and Source B stream in parallel
- Providers:
  - **LM Studio** (local, configurable base URL)
  - **SpaceXAI / xAI** (`XAI_API_KEY`, default model `grok-4.5`)
  - **OpenAI** (`OPENAI_API_KEY`)
  - **Custom** OpenAI-compatible base URL
- Live streaming, TTFT + total latency metrics
- Mark A / B / Tie winners (stored in `localStorage`)
- Model list refresh via each provider’s `/models` endpoint

## Setup

```bash
cd MattChat
npm install
cp .env.local.example .env.local
# edit .env.local with keys you need
npm run dev
```

Open [http://localhost:3010](http://localhost:3010).

MattChat defaults to **port 3010** so it does not collide with apps on 3000. Override anytime with `npm run dev -- --port 3020`.

### Environment

| Variable | Used by |
|----------|---------|
| `XAI_API_KEY` | SpaceXAI (xAI) |
| `OPENAI_API_KEY` | OpenAI (and optional fallback for custom) |
| `LM_STUDIO_BASE_URL` | Optional default LM Studio URL (`http://127.0.0.1:1234/v1`) |
| `CUSTOM_API_KEY` | Optional key for custom endpoints |

Keys stay **server-side** only. Never put them in client code.

### LM Studio

1. Load **one** model in LM Studio (prefer small quants if RAM is tight — e.g. Nemotron Nano **4B**, not Omni 30B).
2. Start the **Local Server** (default port `1234`).
3. In the UI, set Source A/B provider to **LM Studio**. Chat pins to whatever is already loaded — MattChat will **not** auto-load another model.

**Important:** requesting an unloaded id used to make LM Studio load a second model (and often hang). The chat API now only talks to models that are already in memory. If the UI still has a stale id, the server remaps to the loaded instance.

**Nemotron:** reasoning is on by default. With Fast mode on, MattChat sends `reasoning_effort: "none"` so replies don’t spend the whole budget on hidden thinking.

### A/B workflow

1. Switch mode to **A/B Test**.
2. Configure Source A (e.g. LM Studio) and Source B (e.g. SpaceXAI `grok-4.5`).
3. Send a prompt → both panes stream.
4. Click **Winner A**, **Winner B**, or **Tie** to log preference locally.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Production server |

## Notes

- Conversation history in single mode is multi-turn. A/B turns send the shared transcript + the new user message to both sources; prior A/B assistant outputs are not injected as “the” assistant reply (avoids polluting both sides).
- For large local models, watch RAM/VRAM; LM Studio may refuse loads that would freeze the machine.
