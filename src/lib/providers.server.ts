import "server-only";

import OpenAI from "openai";
import { resolveApiKey, type KeySlotId } from "@/lib/keys";
import {
  PROVIDER_META,
  displayModelName,
  isLocalBaseUrl,
  normalizeOpenAIBaseUrl,
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
  const sorted = [...ids].sort((a, b) => {
    const aVar = a.includes("@") ? 1 : 0;
    const bVar = b.includes("@") ? 1 : 0;
    return aVar - bVar || a.localeCompare(b);
  });
  for (const id of sorted) {
    const base = modelBaseId(id);
    if (seen.has(base)) continue;
    seen.add(base);
    const bare = ids.find((x) => x === base);
    out.push(bare || id);
  }
  return out;
}

/** Per-request timeout. Remote needs more headroom than loopback. */
function listTimeoutMs(baseURL: string): number {
  return isLocalBaseUrl(baseURL) ? 10_000 : 15_000;
}

export function resolveConnection(
  source: Pick<SourceConfig, "provider" | "baseUrl">
): { baseURL: string; apiKey: string } {
  const provider = source.provider;
  const resolved = resolveApiKey(providerToKeySlot(provider));

  if (provider === "lmstudio") {
    const baseURL = normalizeOpenAIBaseUrl(
      source.baseUrl || resolved.baseUrl || "http://127.0.0.1:1234/v1"
    );
    return { baseURL, apiKey: resolved.apiKey || "lm-studio" };
  }

  if (provider === "custom") {
    const baseURL = normalizeOpenAIBaseUrl(
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

  const baseURL = normalizeOpenAIBaseUrl(
    source.baseUrl || resolved.baseUrl || ""
  );
  if (!baseURL) {
    throw new Error(
      `No base URL configured for ${PROVIDER_META[provider].name}`
    );
  }

  return { baseURL, apiKey: resolved.apiKey };
}

type NativeList = {
  models: ModelInfo[];
  defaultModelId: string;
  loadedIds: string[];
  sourceUrl?: string;
};

function rowLooksLoaded(row: Record<string, unknown>): {
  loaded: boolean;
  instanceId: string;
  loadedContextLength?: number;
  maxContextLength?: number;
} {
  const state = String(row.state || row.status || "").toLowerCase();
  const instances = row.loaded_instances;
  const hasInstances = Array.isArray(instances) && instances.length > 0;
  let instanceId = "";
  let loadedContextLength: number | undefined;
  if (hasInstances) {
    const first = instances[0] as Record<string, unknown>;
    instanceId = String(first?.id || first?.model || "").trim();
    const fromInst = Number(
      first?.config &&
        typeof first.config === "object" &&
        (first.config as { contextLength?: unknown }).contextLength != null
        ? (first.config as { contextLength?: unknown }).contextLength
        : first?.context_length ?? first?.n_ctx
    );
    if (Number.isFinite(fromInst) && fromInst > 0) {
      loadedContextLength = Math.floor(fromInst);
    }
  }

  const maxContextLength = (() => {
    const n = Number(
      row.max_context_length ?? row.max_context_len ?? row.context_length
    );
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  })();

  const topLoadedCtx = (() => {
    const n = Number(row.loaded_context_length ?? row.loaded_context_len);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  })();

  // Strict loaded detection — do NOT treat idle/ready alone as loaded.
  // False positives (catalog order) were selecting Gemma while Qwen was expected.
  const explicitlyNotLoaded =
    state === "not-loaded" ||
    state === "unloaded" ||
    state === "not_loaded" ||
    row.loaded === false ||
    row.is_loaded === false;

  const explicitlyLoaded =
    state === "loaded" ||
    hasInstances ||
    row.loaded === true ||
    row.is_loaded === true ||
    row.in_memory === true ||
    String(row.load_state || "").toLowerCase() === "loaded";

  const loaded = explicitlyNotLoaded ? false : Boolean(explicitlyLoaded);

  return {
    loaded: Boolean(loaded),
    instanceId,
    loadedContextLength: topLoadedCtx ?? loadedContextLength,
    maxContextLength,
  };
}

/**
 * List models from LM Studio native APIs. GET-only — never loads a model.
 * Works for local and remote LM Studio when /api/v0 or /api/v1 is exposed.
 */
function parseLmStudioNativeRows(
  rows: Array<Record<string, unknown>>,
  sourceUrl?: string
): NativeList | null {
  const raw: ModelInfo[] = [];
  const rawLoaded: string[] = [];

  for (const row of rows) {
    const id = String(row.id || row.key || row.model || "").trim();
    if (!id) continue;

    const type = String(row.type || row.model_type || "llm").toLowerCase();
    if (type.includes("embed") || type === "embedding") continue;

    const { loaded, instanceId, loadedContextLength, maxContextLength } =
      rowLooksLoaded(row);
    const chatId = instanceId || id;
    raw.push({
      id,
      displayName: displayModelName(id),
      loaded: Boolean(loaded),
      loadedContextLength,
      maxContextLength,
    });
    if (loaded) {
      rawLoaded.push(chatId);
      if (id !== chatId) rawLoaded.push(id);
      // Also keep quant-suffixed variants if present
      const variant = String(row.selected_variant || "").trim();
      if (variant) rawLoaded.push(variant);
    }
  }

  if (!raw.length) return null;

  // Collapse org/model + org/model@quant duplicates in the picker
  const byBase = new Map<string, ModelInfo>();
  for (const m of raw) {
    const base = modelBaseId(m.id);
    const prev = byBase.get(base);
    if (!prev) {
      byBase.set(base, {
        id: m.id.includes("@") ? base : m.id,
        displayName: displayModelName(base),
        loaded: m.loaded,
        loadedContextLength: m.loadedContextLength,
        maxContextLength: m.maxContextLength,
      });
      continue;
    }
    byBase.set(base, {
      id: prev.id.includes("@") && !m.id.includes("@") ? m.id : prev.id,
      displayName: prev.displayName,
      loaded: Boolean(prev.loaded || m.loaded),
      loadedContextLength:
        m.loadedContextLength ?? prev.loadedContextLength,
      maxContextLength: m.maxContextLength ?? prev.maxContextLength,
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

  return { models, defaultModelId, loadedIds, sourceUrl };
}

async function listLmStudioNative(
  origin: string,
  apiKey: string
): Promise<NativeList | null> {
  // Prefer v0 (loaded state). Probe v0 + v1 in parallel.
  const urls = [`${origin}/api/v0/models`, `${origin}/api/v1/models`];
  const timeout = listTimeoutMs(origin);

  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          // Some remote LM Studio builds require a bearer even for native REST
          Authorization: `Bearer ${apiKey || "lm-studio"}`,
        },
        signal: AbortSignal.timeout(timeout),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      const json = (await res.json()) as {
        data?: Array<Record<string, unknown>>;
        models?: Array<Record<string, unknown>>;
      };
      const rows = json.data || json.models || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`${url} empty`);
      }
      return parseLmStudioNativeRows(
        rows as Array<Record<string, unknown>>,
        url
      );
    })
  );

  // Prefer result that actually reports something loaded; else first catalog.
  let fallback: NativeList | null = null;
  for (const r of settled) {
    if (r.status !== "fulfilled" || !r.value?.models?.length) continue;
    if (r.value.loadedIds.length) return r.value;
    if (!fallback) fallback = r.value;
  }
  return fallback;
}

/**
 * Robust OpenAI-compatible GET /models — works for remote hosts and APIs
 * that return slightly non-standard JSON (array root, `models` key, etc.).
 */
async function listOpenAICompatibleModels(
  baseURL: string,
  apiKey: string
): Promise<ModelInfo[]> {
  const url = `${stripTrailingSlash(baseURL)}/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey || "lm-studio"}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(listTimeoutMs(baseURL)),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GET ${url} → ${res.status}${body ? `: ${body.slice(0, 220)}` : ""}`
    );
  }

  const json = (await res.json()) as unknown;
  let rows: unknown[] = [];
  if (Array.isArray(json)) {
    rows = json;
  } else if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) rows = obj.data;
    else if (Array.isArray(obj.models)) rows = obj.models;
  }

  const models: ModelInfo[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id || r.key || r.model || r.name || "").trim();
    if (!id) continue;
    const type = String(r.type || r.object || "").toLowerCase();
    if (type.includes("embed")) continue;
    const { loaded, loadedContextLength, maxContextLength } =
      rowLooksLoaded(r);
    models.push({
      id,
      displayName: displayModelName(id),
      // Only set when we truly know; undefined = unknown (remote /v1 often)
      loaded: loaded ? true : undefined,
      loadedContextLength,
      maxContextLength,
    });
  }

  // Preserve server order — LM Studio often lists the active/loaded model first.
  return models;
}

/**
 * Pin chat to a model already in LM Studio memory when we can tell.
 * Remote LM Studio often only exposes /v1 (no loaded flags) — in that case
 * we honor the requested id (or first catalog id) without forcing a load.
 */
export async function pinToLoadedLmStudioModel(
  baseURL: string,
  requested: string
): Promise<{ model: string; remapped: boolean; loadedIds: string[] }> {
  const origin = providerOrigin(baseURL);
  const native = await listLmStudioNative(origin, "lm-studio");
  const loadedIds = native?.loadedIds || [];
  const req = (requested || "").trim();

  if (loadedIds.length) {
    if (req) {
      const exact = loadedIds.find((id) => id === req);
      if (exact) {
        return { model: exact, remapped: false, loadedIds };
      }
      const fuzzy = loadedIds.find((id) => modelsMatch(id, req));
      if (fuzzy) {
        return { model: fuzzy, remapped: fuzzy !== req, loadedIds };
      }
      return { model: loadedIds[0], remapped: true, loadedIds };
    }
    return { model: loadedIds[0], remapped: Boolean(req), loadedIds };
  }

  try {
    const catalog = await listOpenAICompatibleModels(baseURL, "lm-studio");
    const ids = catalog.map((m) => m.id);
    const loadedFromCatalog = catalog
      .filter((m) => m.loaded === true)
      .map((m) => m.id);
    if (loadedFromCatalog.length) {
      if (req && loadedFromCatalog.some((id) => modelsMatch(id, req))) {
        const match =
          loadedFromCatalog.find((id) => id === req) ||
          loadedFromCatalog.find((id) => modelsMatch(id, req))!;
        return { model: match, remapped: match !== req, loadedIds: loadedFromCatalog };
      }
      return {
        model: loadedFromCatalog[0],
        remapped: !req || !modelsMatch(req, loadedFromCatalog[0]),
        loadedIds: loadedFromCatalog,
      };
    }
    if (req && ids.includes(req)) {
      return { model: req, remapped: false, loadedIds: [] };
    }
    if (req && ids.some((id) => modelsMatch(id, req))) {
      const match = ids.find((id) => modelsMatch(id, req))!;
      return { model: match, remapped: match !== req, loadedIds: [] };
    }
    if (req) {
      return { model: req, remapped: false, loadedIds: [] };
    }
    if (ids[0]) {
      return { model: ids[0], remapped: true, loadedIds: [] };
    }
  } catch {
    /* fall through */
  }

  if (req) {
    return { model: req, remapped: false, loadedIds: [] };
  }

  throw new Error(
    "Could not list models on this LM Studio host. " +
      "Check Base URL (http://IP:1234/v1), Local Server is running + “Serve on Network”, " +
      "and the host is reachable from the MattChat machine."
  );
}

/** Look up loaded / max context for a model id from LM Studio catalog. */
export async function getLmStudioContextInfo(
  baseURL: string,
  modelId: string
): Promise<{ loadedContextLength?: number; maxContextLength?: number }> {
  try {
    const listed = await listModels({
      provider: "lmstudio",
      baseUrl: baseURL,
    });
    const hit =
      listed.models.find((m) => modelsMatch(m.id, modelId) && m.loaded) ||
      listed.models.find((m) => modelsMatch(m.id, modelId)) ||
      listed.models.find((m) => m.loaded);
    return {
      loadedContextLength: hit?.loadedContextLength,
      maxContextLength: hit?.maxContextLength,
    };
  } catch {
    return {};
  }
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
        ? "No LM Studio model available. Load one or set a model id."
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
  const errors: string[] = [];
  const diagnostics: string[] = [`Resolved base URL: ${baseURL}`];

  if (provider === "lmstudio") {
    const origin = providerOrigin(baseURL);
    diagnostics.push(`Native origin: ${origin}`);
    if (isLocalBaseUrl(baseURL)) {
      diagnostics.push("Host is loopback (this machine only)");
    } else {
      diagnostics.push(
        "Host is remote — MattChat’s Node server must reach this IP:port"
      );
    }

    const [nativeResult, openaiResult] = await Promise.allSettled([
      listLmStudioNative(origin, apiKey),
      listOpenAICompatibleModels(baseURL, apiKey),
    ]);

    const native =
      nativeResult.status === "fulfilled" ? nativeResult.value : null;
    const openaiModels =
      openaiResult.status === "fulfilled" ? openaiResult.value : null;

    if (nativeResult.status === "rejected") {
      errors.push(
        nativeResult.reason instanceof Error
          ? nativeResult.reason.message
          : String(nativeResult.reason)
      );
    } else if (!native) {
      errors.push("LM Studio native /api/v0|/api/v1 not available");
      diagnostics.push(
        "No native REST catalog — ● loaded state unavailable. " +
          "In LM Studio: Developer → Local Server → start server, enable network access."
      );
    } else {
      diagnostics.push(
        `Native OK (${native.sourceUrl || "api"}) · ${native.models.length} models · ` +
          `${native.loadedIds.length} loaded` +
          (native.loadedIds[0] ? ` · ${native.loadedIds[0]}` : "")
      );
      if (native.loadedIds.length) {
        diagnostics.push(
          `● IN MEMORY (authoritative): ${native.loadedIds.join(", ")}`
        );
      } else {
        diagnostics.push(
          "No model reports state=loaded / loaded_instances on this host. " +
            "Load a model in LM Studio on that machine, then Scan again."
        );
      }
      const catalogIds = native.models.map((m) => m.id).slice(0, 12);
      if (catalogIds.length) {
        diagnostics.push(`Catalog sample: ${catalogIds.join(", ")}`);
      }
    }

    if (openaiResult.status === "rejected") {
      errors.push(
        openaiResult.reason instanceof Error
          ? openaiResult.reason.message
          : String(openaiResult.reason)
      );
    } else if (openaiModels?.length) {
      diagnostics.push(`OpenAI /models OK · ${openaiModels.length} models`);
    }

    // Prefer native (has ● loaded). Merge openai catalog ids if useful.
    if (native?.models?.length) {
      const byId = new Map(native.models.map((m) => [m.id, { ...m }]));
      if (openaiModels?.length) {
        for (const m of openaiModels) {
          const base = modelBaseId(m.id);
          const existing =
            byId.get(m.id) ||
            byId.get(base) ||
            [...byId.values()].find((x) => modelBaseId(x.id) === base);
          if (existing) {
            // Promote loaded flag if either source says so
            if (m.loaded === true) existing.loaded = true;
            continue;
          }
          byId.set(m.id, m);
        }
      }
      const models = Array.from(byId.values());
      // Loaded first, then preserve readability
      models.sort((a, b) => {
        if (Boolean(a.loaded) !== Boolean(b.loaded)) {
          return a.loaded ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
      const loadedIds = preferCanonicalModelIds([
        ...native.loadedIds,
        ...models.filter((m) => m.loaded).map((m) => m.id),
      ]);
      // Mark canonical loaded rows
      for (const m of models) {
        if (loadedIds.some((id) => modelsMatch(id, m.id))) m.loaded = true;
      }
      const defaultModelId =
        loadedIds[0] ||
        native.defaultModelId ||
        models.find((m) => m.loaded)?.id ||
        models[0]?.id ||
        "";
      return {
        models,
        baseURL,
        defaultModelId,
        listSource: openaiModels?.length ? "merged" : "native",
        diagnostics,
      };
    }

    // OpenAI-compat only
    if (openaiModels?.length) {
      const loaded = openaiModels.filter((m) => m.loaded === true);
      if (!loaded.length) {
        diagnostics.push(
          "Catalog only (no ● loaded flags). Pick your loaded model manually " +
            "(e.g. qwen3.6-27b), or expose LM Studio native REST on this host."
        );
      }
      return {
        models: openaiModels,
        baseURL,
        defaultModelId:
          loaded[0]?.id || openaiModels[0]?.id || "",
        listSource: "openai",
        diagnostics,
      };
    }

    errors.push(`No models at ${baseURL}/models`);
    throw new Error(
      `Could not list LM Studio models at ${baseURL}. ${errors.join(" · ")} ` +
        `Tips: use http://IP:1234/v1 (not https), enable “Serve on Network” in LM Studio, ` +
        `allow port 1234 through the remote firewall.`
    );
  }

  // Commercial / custom OpenAI-compatible providers
  try {
    const models = await listOpenAICompatibleModels(baseURL, apiKey);
    if (models.length) {
      models.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const builtIn = PROVIDER_META[provider].defaultModel;
      const defaultModelId =
        builtIn && models.some((m) => m.id === builtIn)
          ? builtIn
          : models[0]?.id || builtIn || "";
      return {
        models,
        baseURL,
        defaultModelId,
        listSource: "openai",
        diagnostics,
      };
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL,
      timeout: listTimeoutMs(baseURL),
      maxRetries: 0,
    });
    const list = await client.models.list();
    const models: ModelInfo[] = [];
    for await (const m of list) {
      if (!m?.id) continue;
      models.push({
        id: m.id,
        displayName: displayModelName(m.id),
        loaded: undefined,
      });
    }
    models.sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (models.length) {
      const builtIn = PROVIDER_META[provider].defaultModel;
      const defaultModelId =
        builtIn && models.some((x) => x.id === builtIn)
          ? builtIn
          : models[0]?.id || builtIn || "";
      return {
        models,
        baseURL,
        defaultModelId,
        listSource: "sdk",
        diagnostics,
      };
    }
    errors.push("OpenAI SDK returned an empty model list");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  throw new Error(
    `Could not list models for ${PROVIDER_META[provider].name} (${baseURL}). ${errors.join(" · ")}`
  );
}
