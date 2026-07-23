/** Client-safe provider types & helpers (no fs / secrets). */

export type ProviderId = "lmstudio" | "xai" | "openai" | "gemini" | "custom";

/** OpenAI-compatible multimodal content parts */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | {
      type: "input_audio";
      input_audio: { data: string; format: string };
    };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export type SourceConfig = {
  provider: ProviderId;
  model: string;
  /** LM Studio or custom OpenAI-compatible base URL (must include /v1) */
  baseUrl?: string;
  label?: string;
  temperature?: number;
  enableThinking?: boolean;
  maxTokens?: number;
};

export type ModelInfo = {
  id: string;
  displayName: string;
  loaded?: boolean;
  /** LM Studio: max context the GGUF supports */
  maxContextLength?: number;
  /** LM Studio: context actually loaded in VRAM right now (this is the hard cap) */
  loadedContextLength?: number;
};

export type ListModelsResult = {
  models: ModelInfo[];
  baseURL: string;
  defaultModelId: string;
  /** How the catalog was obtained — useful for remote LM Studio debugging */
  listSource?: "native" | "openai" | "sdk" | "merged";
  /** Human-readable scan notes (resolved host, load-state availability) */
  diagnostics?: string[];
};

export const PROVIDER_META: Record<
  ProviderId,
  {
    name: string;
    shortName: string;
    description: string;
    defaultModel: string;
    needsKey: boolean;
  }
> = {
  lmstudio: {
    name: "LM Studio",
    shortName: "LM Studio",
    description:
      "Local server — uses whatever model is already loaded (never auto-loads)",
    // Empty on purpose: never default to a catalog id that might force a load.
    defaultModel: "",
    needsKey: false,
  },
  xai: {
    name: "Grok / SpaceXAI (xAI)",
    shortName: "xAI",
    description: "Grok via api.x.ai — set key in API keys panel",
    defaultModel: "grok-4.5",
    needsKey: true,
  },
  openai: {
    name: "OpenAI",
    shortName: "OpenAI",
    description: "OpenAI Chat Completions — set key in API keys panel",
    defaultModel: "gpt-4.1-mini",
    needsKey: true,
  },
  gemini: {
    name: "Google Gemini",
    shortName: "Gemini",
    description: "Gemini OpenAI-compatible API — set key in API keys panel",
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
  },
  custom: {
    name: "Custom (OpenAI-compatible)",
    shortName: "Custom",
    description: "Any OpenAI-compatible endpoint",
    defaultModel: "",
    needsKey: false,
  },
};

export function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export function providerOrigin(baseURL: string): string {
  return stripTrailingSlash(baseURL)
    .replace(/\/v1$/i, "")
    .replace(/\/v1beta\/openai$/i, "");
}

/** True for loopback hosts — used for shorter timeouts / local-only safety. */
export function isLocalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return /127\.0\.0\.1|localhost/i.test(url);
  }
}

/**
 * Normalize OpenAI-compatible base URLs.
 * Bare host:port (common for remote LM Studio) becomes host:port/v1.
 * Leaves Gemini's /v1beta/openai path alone.
 *
 * Correct remote examples:
 *   http://192.168.1.50:1234      → http://192.168.1.50:1234/v1
 *   http://192.168.1.50:1234/v1  → unchanged
 * Wrong:
 *   https://… (LM Studio local server is HTTP)
 *   http://192.168.1.50          (missing port 1234)
 *   http://192.168.1.50:1234/v1/v1
 */
export function normalizeOpenAIBaseUrl(url: string): string {
  let u = (url || "").trim();
  if (!u) return u;
  // Allow host:port without scheme
  if (/^[\w.-]+:\d+/.test(u) && !/^[a-z]+:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  u = stripTrailingSlash(u);
  // Collapse accidental /v1/v1
  u = u.replace(/\/v1\/v1$/i, "/v1");
  // Already an OpenAI-compat root
  if (/\/v1$/i.test(u) || /\/v1beta\/openai$/i.test(u) || /\/openai$/i.test(u)) {
    return u;
  }
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    if (!path || path === "/") {
      return `${u}/v1`;
    }
  } catch {
    /* keep as-is */
  }
  return u;
}

/** Soft validation for LM Studio base URLs (client tip text). */
export function describeLmStudioBaseUrl(url: string): {
  normalized: string;
  ok: boolean;
  tips: string[];
} {
  const tips: string[] = [];
  const normalized = normalizeOpenAIBaseUrl(url || "");
  if (!normalized) {
    return {
      normalized: "http://127.0.0.1:1234/v1",
      ok: false,
      tips: ["Enter the LM Studio host, e.g. http://192.168.1.50:1234/v1"],
    };
  }
  try {
    const u = new URL(normalized);
    if (u.protocol === "https:") {
      tips.push("LM Studio’s local server is usually http:// not https://");
    }
    if (!u.port && !isLocalBaseUrl(normalized)) {
      tips.push("Remote LM Studio normally uses port 1234");
    }
    if (u.pathname.replace(/\/+$/, "") !== "/v1") {
      tips.push(`Path should end with /v1 (resolved: ${u.pathname || "/"})`);
    }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      tips.push("This is loopback — only reaches LM Studio on this Mac");
    } else {
      tips.push(
        `Remote origin ${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""} — MattChat server must reach this IP`
      );
    }
    return { normalized, ok: tips.every((t) => !t.startsWith("Path")), tips };
  } catch {
    return {
      normalized,
      ok: false,
      tips: ["Invalid URL — use http://IP:1234/v1"],
    };
  }
}

export function displayModelName(id: string): string {
  if (!id) return "";
  // Prefer bare model segment, but keep enough to distinguish variants
  const base = id.split("/").pop() || id;
  return base;
}

/** True if `id` is one of the loaded LM Studio instances (exact or base match). */
export function isLoadedModelId(
  id: string,
  loadedModels: string[] | undefined
): boolean {
  if (!id || !loadedModels?.length) return false;
  if (loadedModels.includes(id)) return true;
  const base = id.replace(/@[^/@]+$/i, "");
  return loadedModels.some(
    (L) => L === base || L.replace(/@[^/@]+$/i, "") === base
  );
}

export function sourceLabel(provider: ProviderId, model: string): string {
  const modelName = displayModelName(model) || "no model";
  const host =
    provider === "lmstudio"
      ? "LM Studio"
      : PROVIDER_META[provider].shortName;
  return `${modelName} · ${host}`;
}

export function isLmStudio(provider: ProviderId): boolean {
  return provider === "lmstudio";
}

export function pickBestModel(opts: {
  provider: ProviderId;
  models: string[];
  defaultModelId?: string;
  current?: string;
  /** LM Studio: ids currently loaded in memory (prefer these over catalog-only) */
  loadedModels?: string[];
}): string {
  const { provider, models, defaultModelId, current, loadedModels } = opts;
  const cur = (current || "").trim();

  if (!models.length) {
    if (provider === "lmstudio") {
      return defaultModelId || loadedModels?.[0] || cur || "";
    }
    return cur || PROVIDER_META[provider].defaultModel || "";
  }

  const currentOk = Boolean(cur && models.includes(cur));
  // Important: empty loadedModels means "unknown", NOT "everything is fine".
  // Treating unknown as fine kept stale picks (e.g. Gemma) after Scan.
  const loadStateKnown = Boolean(loadedModels && loadedModels.length > 0);
  const currentIsLoaded = isLoadedModelId(cur, loadedModels);

  if (provider === "lmstudio") {
    // Hard rule: if we know what's in memory, only stay on a loaded id.
    // This is what made Gemma stick while Qwen was the only ● loaded model.
    if (loadStateKnown) {
      if (currentIsLoaded) {
        // Prefer the canonical loaded id from the server list
        const exact = loadedModels!.find((id) => id === cur);
        return exact || loadedModels![0];
      }
      if (defaultModelId && isLoadedModelId(defaultModelId, loadedModels)) {
        return (
          loadedModels!.find((id) => id === defaultModelId) ||
          loadedModels![0]
        );
      }
      const loadedInCatalog = loadedModels!.find((id) => models.includes(id));
      if (loadedInCatalog) return loadedInCatalog;
      return loadedModels![0];
    }

    // Load state unknown (remote /v1-only): prefer server default, then current.
    if (defaultModelId && models.includes(defaultModelId)) return defaultModelId;
    if (currentOk) return cur;
    if (defaultModelId) return defaultModelId;
    return models[0];
  }

  if (currentOk) return cur;
  if (defaultModelId && models.includes(defaultModelId)) return defaultModelId;
  const builtIn = PROVIDER_META[provider].defaultModel;
  if (builtIn && models.includes(builtIn)) return builtIn;
  return models[0];
}
