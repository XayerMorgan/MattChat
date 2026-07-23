import "server-only";

import fs from "fs";
import path from "path";

/**
 * Server-only API key store for MattChat.
 * Keys live in config/api-keys.json (gitignored) — never bundled to the client.
 * Env vars still win when set (deploy / CI).
 */

export type KeySlotId =
  | "lmstudio"
  | "xai"
  | "openai"
  | "gemini"
  | "custom"
  | "anthropic";

export type KeySlotMeta = {
  id: KeySlotId;
  name: string;
  description: string;
  envVar: string;
  /** Optional second env for base URL */
  baseUrlEnvVar?: string;
  /** Default base URL (OpenAI-compatible where possible) */
  defaultBaseUrl?: string;
  needsKey: boolean;
  docsUrl?: string;
  placeholder?: string;
};

export const KEY_SLOTS: KeySlotMeta[] = [
  {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local OpenAI-compatible server (key optional)",
    envVar: "LM_STUDIO_API_KEY",
    baseUrlEnvVar: "LM_STUDIO_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    needsKey: false,
    docsUrl: "https://lmstudio.ai/docs",
    placeholder: "lm-studio (or leave blank)",
  },
  {
    id: "xai",
    name: "Grok / SpaceXAI (xAI)",
    description: "api.x.ai — Grok models",
    envVar: "XAI_API_KEY",
    defaultBaseUrl: "https://api.x.ai/v1",
    needsKey: true,
    docsUrl: "https://console.x.ai",
    placeholder: "xai-…",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "api.openai.com",
    envVar: "OPENAI_API_KEY",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
    docsUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "OpenAI-compatible Gemini endpoint",
    envVar: "GEMINI_API_KEY",
    defaultBaseUrl:
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    needsKey: true,
    docsUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Optional — use with a compatible proxy base URL",
    envVar: "ANTHROPIC_API_KEY",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    needsKey: true,
    docsUrl: "https://console.anthropic.com",
    placeholder: "sk-ant-…",
  },
  {
    id: "custom",
    name: "Custom endpoint",
    description: "Any OpenAI-compatible host",
    envVar: "CUSTOM_API_KEY",
    baseUrlEnvVar: "CUSTOM_BASE_URL",
    needsKey: false,
    placeholder: "optional key",
  },
];

export type StoredKeyEntry = {
  apiKey?: string;
  baseUrl?: string;
  /** ISO time last updated via UI */
  updatedAt?: string;
  label?: string;
};

export type KeyStoreFile = {
  version: 1;
  keys: Partial<Record<KeySlotId, StoredKeyEntry>>;
};

export type KeySlotPublic = {
  id: KeySlotId;
  name: string;
  description: string;
  needsKey: boolean;
  docsUrl?: string;
  placeholder?: string;
  defaultBaseUrl?: string;
  /** Whether a non-empty key is available (env or file) */
  configured: boolean;
  /** Source of the active key */
  source: "env" | "file" | "none" | "default";
  /** Masked preview e.g. sk-…abcd */
  maskedKey: string;
  /** Effective base URL if any */
  baseUrl: string;
  updatedAt?: string;
  label?: string;
};

const STORE_PATH = path.join(process.cwd(), "config", "api-keys.json");

function ensureConfigDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readKeyStore(): KeyStoreFile {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { version: 1, keys: {} };
    }
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as KeyStoreFile;
    if (!parsed || parsed.version !== 1 || typeof parsed.keys !== "object") {
      return { version: 1, keys: {} };
    }
    return parsed;
  } catch {
    return { version: 1, keys: {} };
  }
}

export function writeKeyStore(store: KeyStoreFile) {
  ensureConfigDir();
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, STORE_PATH);
  try {
    fs.chmodSync(STORE_PATH, 0o600);
  } catch {
    /* windows may ignore */
  }
}

export function maskSecret(secret: string): string {
  const s = secret.trim();
  if (!s) return "";
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function getSlotMeta(id: KeySlotId): KeySlotMeta {
  const meta = KEY_SLOTS.find((s) => s.id === id);
  if (!meta) throw new Error(`Unknown key slot: ${id}`);
  return meta;
}

/**
 * Resolve the active API key for a slot.
 * Priority: process.env → config/api-keys.json → optional default
 */
export function resolveApiKey(id: KeySlotId): {
  apiKey: string;
  baseUrl: string;
  source: KeySlotPublic["source"];
} {
  const meta = getSlotMeta(id);
  const store = readKeyStore();
  const entry = store.keys[id] || {};

  const envKey = (process.env[meta.envVar] || "").trim();
  const fileKey = (entry.apiKey || "").trim();

  let apiKey = "";
  let source: KeySlotPublic["source"] = "none";

  if (envKey) {
    apiKey = envKey;
    source = "env";
  } else if (fileKey) {
    apiKey = fileKey;
    source = "file";
  } else if (id === "lmstudio") {
    apiKey = "lm-studio";
    source = "default";
  }

  const envBase = meta.baseUrlEnvVar
    ? (process.env[meta.baseUrlEnvVar] || "").trim()
    : "";
  const baseUrl =
    envBase ||
    (entry.baseUrl || "").trim() ||
    meta.defaultBaseUrl ||
    "";

  return { apiKey, baseUrl, source };
}

export function listKeySlotsPublic(): KeySlotPublic[] {
  return KEY_SLOTS.map((meta) => {
    const { apiKey, baseUrl, source } = resolveApiKey(meta.id);
    const store = readKeyStore();
    const entry = store.keys[meta.id] || {};
    const hasRealKey =
      source === "env" ||
      source === "file" ||
      (source === "default" && meta.id === "lmstudio");

    return {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      needsKey: meta.needsKey,
      docsUrl: meta.docsUrl,
      placeholder: meta.placeholder,
      defaultBaseUrl: meta.defaultBaseUrl,
      configured: meta.needsKey ? source === "env" || source === "file" : true,
      source,
      maskedKey:
        source === "env" || source === "file"
          ? maskSecret(apiKey)
          : source === "default"
            ? "(default)"
            : "",
      baseUrl,
      updatedAt: entry.updatedAt,
      label: entry.label,
    };
  });
}

export type UpsertKeyInput = {
  id: KeySlotId;
  /** Omit or empty to leave existing key; pass "" with clearKey to wipe */
  apiKey?: string;
  clearKey?: boolean;
  baseUrl?: string;
  label?: string;
};

export function upsertKey(input: UpsertKeyInput): KeySlotPublic {
  const meta = getSlotMeta(input.id);
  const store = readKeyStore();
  const prev = store.keys[input.id] || {};
  const next: StoredKeyEntry = { ...prev };

  if (input.clearKey) {
    delete next.apiKey;
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    // Ignore masked placeholders submitted by mistake
    if (!input.apiKey.includes("…") && !input.apiKey.includes("...")) {
      next.apiKey = input.apiKey.trim();
    }
  }

  if (typeof input.baseUrl === "string") {
    const b = input.baseUrl.trim();
    if (b) next.baseUrl = b.replace(/\/+$/, "");
    else delete next.baseUrl;
  }

  if (typeof input.label === "string") {
    const l = input.label.trim();
    if (l) next.label = l;
    else delete next.label;
  }

  next.updatedAt = new Date().toISOString();
  store.keys[input.id] = next;
  writeKeyStore(store);

  // Return public view
  return listKeySlotsPublic().find((s) => s.id === input.id)!;
}

export function deleteKey(id: KeySlotId): void {
  getSlotMeta(id);
  const store = readKeyStore();
  delete store.keys[id];
  writeKeyStore(store);
}

/** Live connectivity check — one short request, no chat loop. */
export async function testKeySlot(id: KeySlotId): Promise<{
  ok: boolean;
  message: string;
  latencyMs: number;
}> {
  const started = Date.now();
  const { apiKey, baseUrl } = resolveApiKey(id);
  const meta = getSlotMeta(id);

  if (meta.needsKey && !apiKey) {
    return {
      ok: false,
      message: `No API key configured for ${meta.name}`,
      latencyMs: Date.now() - started,
    };
  }

  if (!baseUrl) {
    return {
      ok: false,
      message: `No base URL for ${meta.name}`,
      latencyMs: Date.now() - started,
    };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey || "none"}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });

    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        message: `${meta.name} responded ${res.status}${
          body ? `: ${body.slice(0, 160)}` : ""
        }`,
        latencyMs,
      };
    }

    let count = 0;
    try {
      const json = (await res.json()) as { data?: unknown[] };
      count = Array.isArray(json.data) ? json.data.length : 0;
    } catch {
      /* ignore parse — status was ok */
    }

    return {
      ok: true,
      message:
        count > 0
          ? `Connected · ${count} model(s) visible`
          : `Connected to ${meta.name}`,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
}
