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
};

export type ListModelsResult = {
  models: ModelInfo[];
  baseURL: string;
  defaultModelId: string;
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
  return stripTrailingSlash(baseURL).replace(/\/v1$/i, "");
}

export function displayModelName(id: string): string {
  if (!id) return "";
  const base = id.split("/").pop() || id;
  return base;
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
  if (!models.length) {
    if (provider === "lmstudio") {
      return defaultModelId || loadedModels?.[0] || current?.trim() || "";
    }
    return current?.trim() || PROVIDER_META[provider].defaultModel || "";
  }

  const currentOk = Boolean(current && models.includes(current));
  const currentLoaded =
    !loadedModels?.length ||
    (current ? loadedModels.includes(current) : false);

  // Keep the user's selection only if it's actually loadable/loaded.
  // Otherwise LM Studio hangs while it tries to swap in an unloaded model
  // (e.g. default qwen while nvidia/nemotron-3-nano-4b is the one in memory).
  if (currentOk && currentLoaded) return current as string;

  if (provider === "lmstudio") {
    if (defaultModelId && models.includes(defaultModelId)) return defaultModelId;
    if (loadedModels?.length) {
      const loadedInCatalog = loadedModels.find((id) => models.includes(id));
      if (loadedInCatalog) return loadedInCatalog;
      return loadedModels[0];
    }
    if (defaultModelId) return defaultModelId;
    if (currentOk) return current as string;
    return models[0];
  }

  if (currentOk) return current as string;
  if (defaultModelId && models.includes(defaultModelId)) return defaultModelId;
  const builtIn = PROVIDER_META[provider].defaultModel;
  if (builtIn && models.includes(builtIn)) return builtIn;
  return models[0];
}
