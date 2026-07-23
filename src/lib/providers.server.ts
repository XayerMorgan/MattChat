import "server-only";

import OpenAI from "openai";
import { resolveApiKey, type KeySlotId } from "@/lib/keys";
import {
  PROVIDER_META,
  displayModelName,
  providerOrigin,
  sourceLabel,
  stripTrailingSlash,
  type ListModelsResult,
  type ModelInfo,
  type ProviderId,
  type SourceConfig,
} from "@/lib/providers";

function providerToKeySlot(provider: ProviderId): KeySlotId {
  return provider as KeySlotId;
}

/** Strip trailing `@q4_k_m` / similar quant suffix used by LM Studio variants. */
export function modelBaseId(id: string): string {
  return (id || "").replace(/@[^/@]+$/i, "");
}

export function modelsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return modelBaseId(a) === modelBaseId(b);
}

/**
 * LM Studio often lists both `org/model` and `org/model@q4_k_m` as "loaded"
 * for a single in-memory instance. Prefer the bare id (matches loaded_instances).
 */
export function preferCanonicalModelIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Prefer bare ids first
  const sorted = [...ids].sort((a, b) => {
    const aVar = a.includes("@") ? 1 : 0;
    const bVar = b.includes("@") ? 1 : 0;
    return aVar - bVar || a.localeCompare(b);
  });
  for (const id of sorted) {
    const base = modelBaseId(id);
    if (seen.has(base)) continue;
    seen.add(base);
    // Prefer the bare id form when present in the list
    const bare = ids.find((x) => x === base);
    out.push(bare || id);
  }
  return out;
}

export function resolveConnection(
  source: Pick<SourceConfig, "provider" | "baseUrl">
): { baseURL: string; apiKey: string } {
  const provider = source.provider;
  const resolved = resolveApiKey(providerToKeySlot(provider));

  if (provider === "lmstudio") {
    const baseURL = stripTrailingSlash(
      source.baseUrl || resolved.baseUrl || "http://127.0.0.1:1234/v1"
    );
    return { baseURL, apiKey: resolved.apiKey || "lm-studio" };
  }

  if (provider === "custom") {
    const baseURL = stripTrailingSlash(
      source.baseUrl || resolved.baseUrl || ""
    );
    if (!baseURL) {
      throw new Error(
        "Custom provider requires a base URL (set in source or API keys panel)."
      );
    }
    return {
      baseURL,
      apiKey: resolved.apiKey || "not-needed",
    };
  }

  if (PROVIDER_META[provider].needsKey && !resolved.apiKey) {
    throw new Error(
      `Missing API key for ${PROVIDER_META[provider].name}. Open the API keys panel and save a key (or set env).`
    );
  }

  const baseURL = stripTrailingSlash(
    source.baseUrl || resolved.baseUrl || ""
  );
  if (!baseURL) {
    throw new Error(
      `No base URL configured for ${PROVIDER_META[provider].name}`
    );
  }

  return { baseURL, apiKey: resolved.apiKey };
}

/**
 * List models from LM Studio native APIs. GET-only — never loads a model.
 */
async function listLmStudioNative(origin: string): Promise<{
  models: ModelInfo[];
  defaultModelId: string;
  loadedIds: string[];
} | null> {
  const urls = [`${origin}/api/v0/models`, `${origin}/api/v1/models`];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<Record<string, unknown>>;
        models?: Array<Record<string, unknown>>;
      };
      const rows = json.data || json.models || [];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const raw: ModelInfo[] = [];
      const rawLoaded: string[] = [];

      for (const row of rows) {
        const id = String(row.id || row.key || row.model || "");
        if (!id) continue;

        const type = String(row.type || row.model_type || "llm").toLowerCase();
        if (type.includes("embed") || type === "embedding") continue;

        const state = String(row.state || row.status || "").toLowerCase();
        const instances = row.loaded_instances;
        const hasInstances = Array.isArray(instances) && instances.length > 0;
        // Prefer instance id when present — that's the real chat target
        let instanceId = "";
        if (hasInstances) {
          const first = instances[0] as Record<string, unknown>;
          instanceId = String(first?.id || "").trim();
        }

        const loaded =
          state === "loaded" ||
          state === "idle" ||
          hasInstances ||
          row.loaded === true;

        const chatId = instanceId || id;
        raw.push({
          id,
          displayName: displayModelName(id),
          loaded: Boolean(loaded),
        });
        if (loaded) {
          rawLoaded.push(chatId);
          if (id !== chatId) rawLoaded.push(id);
        }
      }

      if (!raw.length) continue;

      // Collapse org/model + org/model@quant duplicates in the picker
      const byBase = new Map<string, ModelInfo>();
      for (const m of raw) {
        const base = modelBaseId(m.id);
        const prev = byBase.get(base);
        if (!prev) {
          byBase.set(base, {
            // Prefer bare id for display/chat
            id: m.id.includes("@") ? base : m.id,
            displayName: displayModelName(base),
            loaded: m.loaded,
          });
          continue;
        }
        byBase.set(base, {
          id: prev.id.includes("@") && !m.id.includes("@") ? m.id : prev.id,
          displayName: prev.displayName,
          loaded: Boolean(prev.loaded || m.loaded),
        });
      }

      const models = Array.from(byBase.values());
      models.sort((a, b) => {
        if (Boolean(a.loaded) !== Boolean(b.loaded)) {
          return a.loaded ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });

      const loadedIds = preferCanonicalModelIds(rawLoaded);
      const defaultModelId =
        loadedIds[0] || models.find((m) => m.loaded)?.id || models[0]?.id || "";

      return { models, defaultModelId, loadedIds };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Pin chat to a model that is ALREADY in LM Studio memory.
 * Never passes an unloaded id upstream — that would force LM Studio to load
 * another model (and often hang / thrash RAM).
 */
export async function pinToLoadedLmStudioModel(
  baseURL: string,
  requested: string
): Promise<{ model: string; remapped: boolean; loadedIds: string[] }> {
  const origin = providerOrigin(baseURL);
  const native = await listLmStudioNative(origin);
  const loadedIds = native?.loadedIds || [];

  if (!loadedIds.length) {
    throw new Error(
      "No model is loaded in LM Studio. Load one model there first, then chat. " +
        "MattChat will not auto-load models."
    );
  }

  const req = (requested || "").trim();
  if (req) {
    const exact =
      loadedIds.find((id) => id === req) ||
      // catalog may still list variant form
      (native?.models || [])
        .filter((m) => m.loaded)
        .map((m) => m.id)
        .find((id) => id === req);
    if (exact) {
      const canonical =
        loadedIds.find((id) => modelsMatch(id, exact)) || exact;
      return {
        model: canonical,
        remapped: canonical !== req,
        loadedIds,
      };
    }

    const fuzzy = loadedIds.find((id) => modelsMatch(id, req));
    if (fuzzy) {
      return { model: fuzzy, remapped: fuzzy !== req, loadedIds };
    }

    // Requested model is NOT loaded. Refuse to ask LM Studio to load it.
    return {
      model: loadedIds[0],
      remapped: true,
      loadedIds,
    };
  }

  return { model: loadedIds[0], remapped: true, loadedIds };
}

export async function resolveProvider(source: SourceConfig): Promise<{
  client: OpenAI;
  model: string;
  label: string;
  baseURL: string;
  remappedFrom?: string;
}> {
  const { baseURL, apiKey } = resolveConnection(source);

  let model = (source.model || "").trim();
  let remappedFrom: string | undefined;

  if (source.provider === "lmstudio") {
    const pinned = await pinToLoadedLmStudioModel(baseURL, model);
    if (pinned.remapped && model && model !== pinned.model) {
      remappedFrom = model;
    }
    model = pinned.model;
  } else if (!model) {
    throw new Error("Model is required.");
  }

  if (!model) {
    throw new Error(
      source.provider === "lmstudio"
        ? "No LM Studio model loaded. Load a model in LM Studio first."
        : "Model is required."
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: source.provider === "lmstudio" ? 180_000 : 120_000,
    maxRetries: 0,
  });

  return {
    client,
    model,
    label: sourceLabel(source.provider, model),
    baseURL,
    remappedFrom,
  };
}

export async function listModels(
  source: Pick<SourceConfig, "provider" | "baseUrl">
): Promise<ListModelsResult> {
  const { baseURL, apiKey } = resolveConnection(source);
  const provider = source.provider;

  if (provider === "lmstudio") {
    const origin = providerOrigin(baseURL);
    const native = await listLmStudioNative(origin);
    if (native?.defaultModelId || native?.models?.length) {
      return {
        models: native!.models,
        baseURL,
        defaultModelId: native!.defaultModelId,
      };
    }
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: 8_000,
    maxRetries: 0,
  });
  const list = await client.models.list();
  const models = list.data
    .map((m) => ({
      id: m.id,
      displayName: displayModelName(m.id),
      loaded: undefined as boolean | undefined,
    }))
    .filter((m) => m.id)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const defaultModelId =
    provider === "lmstudio"
      ? models[0]?.id || ""
      : PROVIDER_META[provider].defaultModel &&
          models.some((m) => m.id === PROVIDER_META[provider].defaultModel)
        ? PROVIDER_META[provider].defaultModel
        : models[0]?.id || PROVIDER_META[provider].defaultModel || "";

  return { models, baseURL, defaultModelId };
}
