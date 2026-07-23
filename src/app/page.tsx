"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  PROVIDER_META,
  describeLmStudioBaseUrl,
  displayModelName,
  isLmStudio,
  normalizeOpenAIBaseUrl,
  pickBestModel,
  sourceLabel,
  type ChatMessage,
  type ContentPart,
  type ProviderId,
  type SourceConfig,
} from "@/lib/providers";
import {
  PERSONALITIES,
  composeSystemPrompt,
  randomPersonality,
  type PersonalityId,
} from "@/lib/personalities";
import {
  MAX_MEDIA_BYTES,
  MODALITY_SUPPORT,
  audioFormatFromFile,
  buildAttachmentContext,
  classifyFile,
  dataUrlToBase64,
  formatBytes,
  type PreparedAttachment,
} from "@/lib/attachments";
import { nowIso, type TimingStamp } from "@/lib/time";
import { FAST_DEFAULTS } from "@/lib/speed";
import { streamChatComplete } from "@/lib/streamClient";
import { mattchatHeaders } from "@/lib/clientId";
import {
  newSessionId,
  promptPreview,
  runSessionExport,
  type QueryMetric,
  type TranscriptMessage,
} from "@/lib/sessionMetrics";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { TimingCompare, TimingStrip } from "@/components/TimingStrip";
import { ApiKeysButton, KeyManager } from "@/components/KeyManager";
import { HostStatusBar } from "@/components/HostStatusBar";
import { ExportSessionModal } from "@/components/ExportSessionModal";
import {
  AttachmentPreviewList,
  preparedToPreview,
  type AttachmentPreviewItem,
} from "@/components/AttachmentPreview";
import { CopyBox } from "@/components/CopyBox";
import { HelpButton, HelpPanel } from "@/components/HelpPanel";
import {
  APP_BRAND,
  APP_TAGLINE,
  appBuiltByLabel,
  appVersionLabel,
} from "@/lib/appMeta";
import {
  estimateTokens,
  formatTokPerSec,
  formatTokenCount,
  tokensPerSecond,
} from "@/lib/tokens";

type Mode = "single" | "ab";
type ConnState = "idle" | "loading" | "ok" | "error";

type UiMessage =
  | {
      id: string;
      kind: "user";
      content: string;
      attachmentNames?: string[];
      attachmentPreviews?: AttachmentPreviewItem[];
      startIso: string;
    }
  | {
      id: string;
      kind: "assistant";
      content: string;
      thinking?: string;
      thinkingActive?: boolean;
      sourceLabel?: string;
      timing?: TimingStamp;
    }
  | {
      id: string;
      kind: "ab";
      prompt: string;
      startIso: string;
      a: PaneState;
      b: PaneState;
      winner?: "a" | "b" | "tie";
    };

type PaneState = {
  text: string;
  thinking?: string;
  thinkingActive?: boolean;
  label: string;
  model: string;
  latencyMs?: number;
  ttftMs?: number | null;
  error?: string;
  loading: boolean;
  timing?: TimingStamp;
};

type AbHistoryItem = {
  id: string;
  at: string;
  prompt: string;
  aLabel: string;
  bLabel: string;
  winner: "a" | "b" | "tie";
};

/** Live generation strip (top bar) — proves the stream is alive */
type LiveGenStats = {
  active: boolean;
  label: string;
  /** Completion tokens (estimate until usage arrives) */
  outTokens: number;
  thinkingTokens: number;
  tokensPerSec: number;
  elapsedMs: number;
  continueRound?: number;
  /** True when numbers come from provider usage, not char estimate */
  exact?: boolean;
  promptTokens?: number | null;
  totalTokens?: number | null;
};

/** Ensure every history row has a unique id (localStorage may hold old dupes). */
function sanitizeHistory(items: AbHistoryItem[]): AbHistoryItem[] {
  const seen = new Set<string>();
  const out: AbHistoryItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    let id = String(raw.id || "");
    if (!id || seen.has(id)) {
      id = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${out.length}`;
    }
    seen.add(id);
    out.push({
      id,
      at: String(raw.at || new Date().toISOString()),
      prompt: String(raw.prompt || ""),
      aLabel: String(raw.aLabel || "A"),
      bLabel: String(raw.bLabel || "B"),
      winner:
        raw.winner === "a" || raw.winner === "b" || raw.winner === "tie"
          ? raw.winner
          : "tie",
    });
  }
  return out.slice(0, 30);
}

type ModelRow = {
  id: string;
  loaded?: boolean;
  loadedContextLength?: number;
  maxContextLength?: number;
};

type SourceRuntime = {
  models: string[];
  modelDetails: ModelRow[];
  defaultModelId: string;
  conn: ConnState;
  message: string;
  /** Server scan notes (resolved URL, native vs openai, loaded ids) */
  diagnostics?: string[];
  listSource?: string;
  hasLoadState?: boolean;
};

// Bumped to drop stale maxTokens:1024 Fast defaults that clipped Board memos.
// Older mattchat-v* keys are removed on hydrate.
const STORAGE_KEY = "mattchat-v9";
const DEFAULT_CLIENT_NAME = "MattChat";

/** Never hardcode a catalog id — server pins chat to the already-loaded model. */
const DEFAULT_LM_MODEL = "";

const defaultSource = (provider: ProviderId): SourceConfig => ({
  provider,
  model:
    provider === "lmstudio"
      ? DEFAULT_LM_MODEL
      : PROVIDER_META[provider].defaultModel,
  baseUrl: provider === "lmstudio" ? "http://127.0.0.1:1234/v1" : "",
  temperature: FAST_DEFAULTS.temperature,
  enableThinking: FAST_DEFAULTS.enableThinking,
  maxTokens: FAST_DEFAULTS.maxTokens,
});

const emptyRuntime = (): SourceRuntime => ({
  models: [],
  modelDetails: [],
  defaultModelId: "",
  conn: "idle",
  message: "",
  diagnostics: [],
  listSource: "",
  hasLoadState: false,
});

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMs(ms?: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function shortModel(id?: string) {
  if (!id) return "no model";
  return displayModelName(id);
}

/** Controlled <select> value must always match an <option> or React can throw removeChild. */
function safeSelectValue(
  options: Array<{ id: string }>,
  preferred: string | undefined
): string {
  if (!options.length) return "";
  if (preferred && options.some((o) => o.id === preferred)) return preferred;
  return options[0].id;
}

export default function Home() {
  // Gate all interactive UI until client mount so SSR HTML matches
  // (avoids localStorage + extension attribute hydration noise).
  const [hydrated, setHydrated] = useState(false);

  const [mode, setMode] = useState<Mode>("single");
  const [sourceA, setSourceA] = useState<SourceConfig>(() =>
    defaultSource("lmstudio")
  );
  const [sourceB, setSourceB] = useState<SourceConfig>(() =>
    defaultSource("xai")
  );
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful assistant. Be accurate and brief."
  );
  /** Global fast path — off only when you want full thinking models */
  const [fastMode, setFastMode] = useState(true);
  /** Per-source personality (Dialectic Arena–style roster + random) */
  const [personalityA, setPersonalityA] = useState<PersonalityId>("concise");
  const [personalityB, setPersonalityB] = useState<PersonalityId>("helpful");
  const [runtimeA, setRuntimeA] = useState<SourceRuntime>(emptyRuntime);
  const [runtimeB, setRuntimeB] = useState<SourceRuntime>(emptyRuntime);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<AbHistoryItem[]>([]);
  const [status, setStatus] = useState("");
  const [apiConfigOpen, setApiConfigOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"export" | "clear">("export");
  const [helpOpen, setHelpOpen] = useState(false);
  const [clientName, setClientName] = useState(DEFAULT_CLIENT_NAME);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(DEFAULT_CLIENT_NAME);
  const [sessionId] = useState(() => newSessionId());
  const [sessionMetrics, setSessionMetrics] = useState<QueryMetric[]>([]);
  const [liveGen, setLiveGen] = useState<LiveGenStats | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const sourceARef = useRef(sourceA);
  const sourceBRef = useRef(sourceB);
  const genStartMsRef = useRef(0);
  /** Throttle live strip updates so we don't re-render every token */
  const liveLastUiMsRef = useRef(0);
  sourceARef.current = sourceA;
  sourceBRef.current = sourceB;

  const applyClientName = useCallback((raw: string) => {
    const next = raw.trim().slice(0, 48) || DEFAULT_CLIENT_NAME;
    setClientName(next);
    setNameDraft(next);
    setEditingName(false);
  }, []);

  const recordMetric = useCallback((row: QueryMetric) => {
    setSessionMetrics((prev) => [...prev, row]);
  }, []);

  const sessionTokenTotals = useMemo(() => {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    let withUsage = 0;
    for (const m of sessionMetrics) {
      if (m.promptTokens != null) prompt += m.promptTokens;
      if (m.completionTokens != null) completion += m.completionTokens;
      if (m.totalTokens != null) {
        total += m.totalTokens;
        withUsage += 1;
      }
    }
    return {
      prompt,
      completion,
      total,
      withUsage,
      queries: sessionMetrics.length,
    };
  }, [sessionMetrics]);

  const pushLiveGen = useCallback(
    (opts: {
      label: string;
      content?: string;
      thinking?: string;
      continueRound?: number;
      force?: boolean;
      exact?: boolean;
      outTokens?: number;
      thinkingTokens?: number;
      promptTokens?: number | null;
      totalTokens?: number | null;
    }) => {
      const now = Date.now();
      if (!opts.force && now - liveLastUiMsRef.current < 120) return;
      liveLastUiMsRef.current = now;
      const start = genStartMsRef.current || now;
      const elapsedMs = Math.max(1, now - start);
      const outTokens =
        opts.outTokens ?? estimateTokens(opts.content || "");
      const thinkingTokens =
        opts.thinkingTokens ?? estimateTokens(opts.thinking || "");
      const all = outTokens + thinkingTokens;
      setLiveGen({
        active: true,
        label: opts.label,
        outTokens,
        thinkingTokens,
        tokensPerSec: tokensPerSecond(all, elapsedMs),
        elapsedMs,
        continueRound: opts.continueRound,
        exact: opts.exact,
        promptTokens: opts.promptTokens,
        totalTokens: opts.totalTokens,
      });
    },
    []
  );

  // Keep tok/s ticking even when the model is quiet for a moment
  useEffect(() => {
    if (!busy || !liveGen?.active) return;
    const id = window.setInterval(() => {
      setLiveGen((prev) => {
        if (!prev?.active) return prev;
        const elapsedMs = Math.max(1, Date.now() - (genStartMsRef.current || Date.now()));
        const all = prev.outTokens + prev.thinkingTokens;
        return {
          ...prev,
          elapsedMs,
          tokensPerSec: tokensPerSecond(all, elapsedMs),
        };
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [busy, liveGen?.active]);

  // Hydrate prefs client-side only. Never contacts LM Studio.
  useEffect(() => {
    try {
      // Drop older storage versions (duplicate history keys, old defaults, etc.)
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && /^mattchat-v\d+$/.test(k) && k !== STORAGE_KEY) {
            localStorage.removeItem(k);
            i -= 1;
          }
        }
      } catch {
        /* ignore */
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.sourceA) {
          const a = parsed.sourceA as SourceConfig;
          const maxTokens =
            typeof a.maxTokens === "number" && a.maxTokens >= 2048
              ? a.maxTokens
              : FAST_DEFAULTS.maxTokens;
          setSourceA({
            ...a,
            label: undefined,
            // Never reinstate a stale hard-coded catalog default (e.g. qwen).
            // Empty LM Studio model → server uses the already-loaded instance.
            model: a.model?.trim() || "",
            maxTokens,
          });
        }
        if (parsed.sourceB) {
          const b = parsed.sourceB as SourceConfig;
          const maxTokens =
            typeof b.maxTokens === "number" && b.maxTokens >= 2048
              ? b.maxTokens
              : FAST_DEFAULTS.maxTokens;
          setSourceB({
            ...b,
            label: undefined,
            model: b.model?.trim() || "",
            maxTokens,
          });
        }
        if (parsed.systemPrompt) setSystemPrompt(parsed.systemPrompt);
        if (parsed.personalityA) setPersonalityA(parsed.personalityA);
        if (parsed.personalityB) setPersonalityB(parsed.personalityB);
        if (typeof parsed.fastMode === "boolean") setFastMode(parsed.fastMode);
        if (typeof parsed.clientName === "string" && parsed.clientName.trim()) {
          const n = parsed.clientName.trim().slice(0, 48);
          setClientName(n);
          setNameDraft(n);
        }
        // Mode is intentionally NOT restored — Single is always the default.
        setMode("single");
        if (Array.isArray(parsed.history)) {
          setHistory(sanitizeHistory(parsed.history as AbHistoryItem[]));
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
    // Always land in Single, even with no saved prefs
    setMode("single");
    setHydrated(true);
  }, []);

  // Persist after hydration only
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sourceA,
        sourceB,
        systemPrompt,
        personalityA,
        personalityB,
        fastMode,
        clientName,
        // Do not persist mode — Single is always default on load
        history,
      })
    );
  }, [
    hydrated,
    sourceA,
    sourceB,
    systemPrompt,
    personalityA,
    personalityB,
    fastMode,
    clientName,
    history,
  ]);

  // Keep browser tab title in sync with the custom client name
  useEffect(() => {
    if (!hydrated) return;
    document.title = clientName || DEFAULT_CLIENT_NAME;
  }, [hydrated, clientName]);

  // Focus the inline rename field when editing
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  // Global "?" opens Help (skip when typing in inputs)
  useEffect(() => {
    if (!hydrated) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        t?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hydrated]);

  // Keep source flags aligned with Fast mode toggle
  useEffect(() => {
    if (!hydrated) return;
    const patch: Partial<SourceConfig> = fastMode
      ? {
          enableThinking: false,
          maxTokens: FAST_DEFAULTS.maxTokens,
          temperature: FAST_DEFAULTS.temperature,
        }
      : {
          enableThinking: true,
          maxTokens: FAST_DEFAULTS.thinkingMaxTokens,
        };
    setSourceA((s) => ({ ...s, ...patch }));
    setSourceB((s) => ({ ...s, ...patch }));
    if (fastMode) setPersonalityA("concise");
  }, [fastMode, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  /**
   * Keep source.model locked to a ● loaded LM Studio id after Scan.
   * Prevents the dropdown showing Qwen while state still has a stale Gemma
   * (chat would then request the wrong model).
   */
  useEffect(() => {
    if (!hydrated) return;
    const sync = (
      provider: ProviderId,
      model: string,
      runtime: SourceRuntime,
      setSource: typeof setSourceA
    ) => {
      if (!isLmStudio(provider)) return;
      const loaded = runtime.modelDetails
        .filter((m) => m.loaded === true)
        .map((m) => m.id);
      if (!loaded.length) return;
      if (model && loaded.includes(model)) return;
      const next =
        (runtime.defaultModelId && loaded.includes(runtime.defaultModelId)
          ? runtime.defaultModelId
          : loaded[0]) || model;
      if (!next || next === model) return;
      setSource((s) => ({ ...s, model: next, label: undefined }));
    };
    sync(sourceA.provider, sourceA.model, runtimeA, setSourceA);
    sync(sourceB.provider, sourceB.model, runtimeB, setSourceB);
  }, [
    hydrated,
    sourceA.provider,
    sourceA.model,
    runtimeA.modelDetails,
    runtimeA.defaultModelId,
    sourceB.provider,
    sourceB.model,
    runtimeB.modelDetails,
    runtimeB.defaultModelId,
  ]);

  /**
   * One-click speed path: only last few turns + one system message.
   * Never re-hit /api/models from here — catalog is separate from chat.
   */
  // Fast mode: tiny history → better Metal TTFT. Thinking mode: a bit more context.
  const maxTurns = fastMode ? FAST_DEFAULTS.maxTurns : 6;

  const transcriptMessages = useMemo((): ChatMessage[] => {
    const base: ChatMessage[] = [];
    for (const m of messages) {
      if (m.kind === "user") base.push({ role: "user", content: m.content });
      if (m.kind === "assistant")
        base.push({ role: "assistant", content: m.content });
    }
    if (base.length > maxTurns * 2) {
      return base.slice(-(maxTurns * 2));
    }
    return base;
  }, [messages, maxTurns]);

  const buildMessagesForSource = useCallback(
    (
      userContent: string | ContentPart[],
      composed: { system: string; personalityName: string; personalityId: string }
    ): ChatMessage[] => {
      const out: ChatMessage[] = [
        { role: "system", content: composed.system },
      ];
      out.push(...transcriptMessages);
      out.push({ role: "user", content: userContent });
      return out;
    },
    [transcriptMessages]
  );

  const prepareFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setAttaching(true);
    setStatus(`Preparing ${list.length} file(s)…`);
    const prepared: PreparedAttachment[] = [];

    for (const file of list) {
      const kind = classifyFile(file);
      const base = {
        id: uid(),
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        kind,
      };

      try {
        if (file.size > MAX_MEDIA_BYTES && (kind === "image" || kind === "audio" || kind === "video")) {
          prepared.push({
            ...base,
            error: `File too large (max ${formatBytes(MAX_MEDIA_BYTES)})`,
          });
          continue;
        }

        if (kind === "image" || kind === "audio" || kind === "video") {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () =>
              reject(new Error(`Failed to read ${kind}`));
            reader.readAsDataURL(file);
          });
          if (kind === "audio") {
            prepared.push({
              ...base,
              dataUrl,
              base64: dataUrlToBase64(dataUrl),
              audioFormat: audioFormatFromFile(file),
            });
          } else {
            prepared.push({ ...base, dataUrl });
          }
          continue;
        }

        if (kind === "unknown") {
          prepared.push({
            ...base,
            error:
              "Unsupported type — use PDF, DOCX, text, image, audio, or video",
          });
          continue;
        }

        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/extract", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok || json.error) {
          prepared.push({
            ...base,
            error: json.error || `Extract failed (${res.status})`,
          });
          continue;
        }
        prepared.push({
          ...base,
          kind: (json.kind as PreparedAttachment["kind"]) || kind,
          text: json.text,
          pages: json.pages,
          truncated: json.truncated,
        });
      } catch (err) {
        prepared.push({
          ...base,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setAttachments((prev) => [...prev, ...prepared].slice(0, 12));
    setAttaching(false);
    const ok = prepared.filter((p) => !p.error).length;
    const bad = prepared.filter((p) => p.error).length;
    setStatus(
      `Attached ${ok} file(s)` +
        (bad ? ` · ${bad} failed` : "") +
        (ok ? " · ready to analyze" : "")
    );
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const buildUserPayload = (
    prompt: string,
    atts: PreparedAttachment[]
  ): { display: string; apiContent: string | ContentPart[] } => {
    const docContext = buildAttachmentContext(atts);
    const textBody = [prompt, docContext].filter(Boolean).join("\n\n");
    const images = atts.filter((a) => a.kind === "image" && a.dataUrl);
    const audios = atts.filter(
      (a) => a.kind === "audio" && a.base64 && a.audioFormat
    );
    const videos = atts.filter((a) => a.kind === "video" && a.dataUrl);

    const needsParts =
      images.length > 0 || audios.length > 0 || videos.length > 0;
    if (!needsParts) {
      return { display: textBody || prompt, apiContent: textBody || prompt };
    }

    const parts: ContentPart[] = [
      {
        type: "text",
        text:
          textBody ||
          prompt ||
          "Analyze the attached media (images / audio / video).",
      },
    ];
    for (const img of images) {
      if (img.dataUrl) {
        parts.push({
          type: "image_url",
          image_url: { url: img.dataUrl },
        });
      }
    }
    for (const aud of audios) {
      if (aud.base64 && aud.audioFormat) {
        parts.push({
          type: "input_audio",
          input_audio: { data: aud.base64, format: aud.audioFormat },
        });
      }
    }
    // Video: no universal OpenAI chat part; send as data URL under image_url
    // for servers that accept video/* inline (Gemini-compatible stacks).
    for (const vid of videos) {
      if (vid.dataUrl) {
        parts.push({
          type: "image_url",
          image_url: { url: vid.dataUrl },
        });
      }
    }
    return { display: textBody || prompt, apiContent: parts };
  };

  const setRuntime = (which: "a" | "b", patch: Partial<SourceRuntime>) => {
    if (which === "a") setRuntimeA((r) => ({ ...r, ...patch }));
    else setRuntimeB((r) => ({ ...r, ...patch }));
  };

  /**
   * Manual only — never auto-called on load, poll, or send.
   * Chat uses /api/chat only (one request per Send).
   * On failure we keep the previous catalog so the Scan control stays usable.
   */
  const fetchModels = useCallback(async (which: "a" | "b") => {
    if (busyRef.current) {
      setStatus("Generation in progress — scan blocked until it finishes.");
      return;
    }

    const source = which === "a" ? sourceARef.current : sourceBRef.current;

    setRuntime(which, {
      conn: "loading",
      message: "Scanning models…",
    });

    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...mattchatHeaders(),
        },
        body: JSON.stringify({
          provider: source.provider,
          baseUrl: source.baseUrl || undefined,
        }),
      });

      let json: {
        ok?: boolean;
        error?: string;
        models?: string[];
        defaultModelId?: string;
        modelDetails?: Array<{ id: string; loaded?: boolean }>;
        loadedModels?: string[];
        baseURL?: string;
        listSource?: string;
        diagnostics?: string[];
        hasLoadState?: boolean;
      } = {};
      try {
        json = await res.json();
      } catch {
        throw new Error(
          `Scan failed (${res.status}) — non-JSON response from /api/models`
        );
      }

      if (!res.ok || json.ok === false) {
        // Preserve prior models/details so the Scan/Retry button never
        // disappears when the catalog layout collapses.
        setRuntime(which, {
          conn: "error",
          message: json.error || `Failed to list models (${res.status})`,
          diagnostics: Array.isArray(json.diagnostics) ? json.diagnostics : [],
        });
        setStatus(
          `${which.toUpperCase()} scan failed — fix Base URL / key, then Retry`
        );
        return;
      }

      const models = (json.models as string[]) || [];
      const defaultModelId =
        typeof json.defaultModelId === "string" ? json.defaultModelId : "";
      const modelDetails: ModelRow[] = Array.isArray(json.modelDetails)
        ? json.modelDetails.map(
            (m: {
              id: string;
              loaded?: boolean;
              loadedContextLength?: number;
              maxContextLength?: number;
            }) => ({
              id: m.id,
              // loaded may be undefined for remote OpenAI-compat hosts
              loaded:
                typeof m.loaded === "boolean" ? m.loaded : undefined,
              loadedContextLength:
                typeof m.loadedContextLength === "number"
                  ? m.loadedContextLength
                  : undefined,
              maxContextLength:
                typeof m.maxContextLength === "number"
                  ? m.maxContextLength
                  : undefined,
            })
          )
        : models.map((id: string) => ({ id }));

      const loadedModels = modelDetails
        .filter((m) => m.loaded === true)
        .map((m) => m.id);
      const serverLoaded = Array.isArray(json.loadedModels)
        ? json.loadedModels
        : [];
      const loadedUnion = Array.from(
        new Set([...loadedModels, ...serverLoaded])
      );
      const diagnostics: string[] = Array.isArray(json.diagnostics)
        ? [...json.diagnostics]
        : [];
      const listSource =
        typeof json.listSource === "string" ? json.listSource : "";

      // LM Studio hard rule: if anything is ● loaded, selection MUST be one of
      // those ids. Never keep a stale catalog pick (e.g. Gemma) over loaded Qwen.
      let selected = pickBestModel({
        provider: source.provider,
        models,
        defaultModelId,
        current: source.model,
        loadedModels: loadedUnion,
      });
      if (isLmStudio(source.provider) && loadedUnion.length > 0) {
        if (!loadedUnion.includes(selected)) {
          selected =
            (defaultModelId && loadedUnion.includes(defaultModelId)
              ? defaultModelId
              : loadedUnion[0]) || selected;
        }
      } else if (
        isLmStudio(source.provider) &&
        !loadedUnion.length &&
        defaultModelId
      ) {
        // Remote catalog-only: prefer server default (often first = active),
        // then fuzzy-match current against catalog (qwen3.6-27b etc.).
        const fuzzy = models.find(
          (id) =>
            id === source.model ||
            id.toLowerCase().includes((source.model || "").toLowerCase()) ||
            (source.model || "").toLowerCase().includes(id.toLowerCase())
        );
        selected = defaultModelId || fuzzy || selected || models[0] || "";
      }

      const loadedCount = loadedUnion.length;
      const loadedCtx =
        modelDetails.find((m) => m.loaded && m.loadedContextLength)
          ?.loadedContextLength ??
        modelDetails.find((m) => m.id === selected)?.loadedContextLength;
      const maxCtx =
        modelDetails.find((m) => m.loaded && m.maxContextLength)
          ?.maxContextLength ??
        modelDetails.find((m) => m.id === selected)?.maxContextLength;

      if (loadedCtx != null) {
        diagnostics.push(
          `Loaded context (n_ctx): ${loadedCtx.toLocaleString()}` +
            (maxCtx != null ? ` · GGUF max ${maxCtx.toLocaleString()}` : "")
        );
        if (loadedCtx < 16384) {
          diagnostics.push(
            `Generation is limited by loaded context (${loadedCtx}), not Max tokens alone. ` +
              `In LM Studio, unload and reload the model with context ≥ 32k–49k if you need long Board memos.`
          );
        }
      }

      const hostNote =
        typeof json.baseURL === "string" && json.baseURL
          ? ` · ${json.baseURL}`
          : "";
      const ctxShort =
        loadedCtx != null ? ` · ctx ${loadedCtx.toLocaleString()}` : "";
      const msg = !models.length
        ? isLmStudio(source.provider)
          ? `Server reachable, but no models found${hostNote}`
          : `No models returned${hostNote}`
        : isLmStudio(source.provider) && loadedCount > 0
          ? `${models.length} models · ${loadedCount} loaded · ${shortModel(selected)}${ctxShort}${hostNote}`
          : isLmStudio(source.provider)
            ? `${models.length} models · no ● load state (${listSource || "catalog"})${hostNote} — pick your loaded model`
            : `${models.length} models · ${shortModel(selected)}${hostNote}`;

      const runtime: SourceRuntime = {
        models,
        modelDetails,
        defaultModelId:
          isLmStudio(source.provider) && loadedUnion.length
            ? loadedUnion.includes(defaultModelId)
              ? defaultModelId
              : loadedUnion[0]
            : defaultModelId,
        conn: models.length || selected ? "ok" : "error",
        message: msg,
        diagnostics,
        listSource,
        hasLoadState: loadedCount > 0,
      };

      const nextBaseUrl =
        isLmStudio(source.provider) || source.provider === "custom"
          ? typeof json.baseURL === "string" && json.baseURL
            ? json.baseURL
            : undefined
          : undefined;

      if (which === "a") {
        setSourceA((s) => ({
          ...s,
          // Always write the resolved selection — never fall back to a stale
          // Gemma id when Scan found a loaded model.
          model: selected || s.model,
          ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
          label: undefined,
        }));
        setRuntimeA(runtime);
      } else {
        setSourceB((s) => ({
          ...s,
          model: selected || s.model,
          ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
          label: undefined,
        }));
        setRuntimeB(runtime);
      }

      if (selected) {
        setStatus(
          `${which.toUpperCase()}: ${sourceLabel(source.provider, selected)}` +
            (loadedCtx != null
              ? ` · loaded ctx ${loadedCtx.toLocaleString()}` +
                (maxCtx != null && maxCtx !== loadedCtx
                  ? ` (GGUF max ${maxCtx.toLocaleString()})`
                  : "")
              : "")
        );
      } else {
        setStatus(`${which.toUpperCase()}: scan complete — no model selected`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Keep prior catalog; only flip connection state + message
      setRuntime(which, {
        conn: "error",
        message,
      });
      setStatus(`${which.toUpperCase()} scan failed — ${message}`);
    }
  }, []);

  // No auto model scans. LM Studio is only contacted on:
  //   1) Send → POST /api/chat (exactly once)
  //   2) User clicks Scan → POST /api/models (optional)

  const updateSource = (which: "a" | "b", patch: Partial<SourceConfig>) => {
    if (which === "a") setSourceA((s) => ({ ...s, ...patch }));
    else setSourceB((s) => ({ ...s, ...patch }));
  };

  const openExport = (mode: "export" | "clear") => {
    if (mode === "export" && !sessionMetrics.length && !messages.length) {
      setStatus("Nothing to export yet — send a chat first.");
      return;
    }
    if (mode === "clear") {
      abortRef.current?.abort();
      setBusy(false);
      busyRef.current = false;
    }
    setExportMode(mode);
    setExportOpen(true);
  };

  const applyExportAndMaybeClear = (opts: {
    csvFilename: string;
    chatFilename: string;
    saveMetrics: boolean;
    saveChat: boolean;
    sessionNote: string;
    abQualityNote: string;
    clearAfter: boolean;
  }) => {
    const transcript = messages as unknown as TranscriptMessage[];
    const saved = runSessionExport({
      metrics: sessionMetrics,
      messages: transcript,
      sessionId,
      exportOpts: {
        csvFilename: opts.csvFilename,
        chatFilename: opts.chatFilename,
        saveMetrics: opts.saveMetrics,
        saveChat: opts.saveChat,
        sessionNote: opts.sessionNote,
        abQualityNote: opts.abQualityNote,
      },
    });

    const bits: string[] = [];
    if (saved.csvName) bits.push(`metrics → ${saved.csvName}`);
    if (saved.chatName) bits.push(`chat → ${saved.chatName}`);
    if (opts.abQualityNote.trim()) bits.push("A/B note included");
    if (opts.sessionNote.trim()) bits.push("session notes included");

    if (opts.clearAfter) {
      setMessages([]);
      setHistory([]);
      setAttachments([]);
      setInput("");
      setSessionMetrics([]);
      setStatus(
        bits.length
          ? `Exported ${bits.join(" · ")}. Chats cleared.`
          : "All chats cleared (nothing exported)."
      );
    } else {
      setStatus(
        bits.length ? `Exported ${bits.join(" · ")}.` : "Nothing selected to export."
      );
    }
    setExportOpen(false);
  };

  const hasAbInSession =
    messages.some((m) => m.kind === "ab") ||
    sessionMetrics.some((m) => m.mode === "ab") ||
    history.length > 0;

  const setWinner = (msgId: string, winner: "a" | "b" | "tie") => {
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === msgId && m.kind === "ab" ? { ...m, winner } : m
      );
      const msg = next.find((m) => m.id === msgId);
      if (msg?.kind === "ab") {
        const entry: AbHistoryItem = {
          // Unique React key even if the same A/B turn is re-judged
          id: `${msgId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: new Date().toISOString(),
          prompt: msg.prompt,
          aLabel: msg.a.label || sourceLabel(sourceA.provider, sourceA.model),
          bLabel: msg.b.label || sourceLabel(sourceB.provider, sourceB.model),
          winner,
        };
        setHistory((h) => {
          // Drop prior votes for this A/B turn (old plain msgId or msgId-*)
          const without = h.filter(
            (x) => x.id !== msgId && !x.id.startsWith(`${msgId}-`)
          );
          return sanitizeHistory([entry, ...without]);
        });
      }
      return next;
    });
  };

  const canSend = useMemo(() => {
    if (busy || attaching) return false;
    const hasText = input.trim().length > 0;
    const hasFiles = attachments.some((a) => !a.error);
    if (!hasText && !hasFiles) return false;
    // LM Studio: empty model is ok — server pins to whatever is already loaded.
    // Other providers need an explicit model id.
    if (!isLmStudio(sourceA.provider) && !sourceA.model.trim()) return false;
    if (
      mode === "ab" &&
      !isLmStudio(sourceB.provider) &&
      !sourceB.model.trim()
    ) {
      return false;
    }
    return true;
  }, [
    input,
    busy,
    attaching,
    attachments,
    sourceA.model,
    sourceA.provider,
    sourceB.model,
    sourceB.provider,
    mode,
  ]);

  /**
   * If a prior Scan showed which models are loaded, avoid chatting against an
   * unloaded id (LM Studio hangs for a long time while swapping). Prefer the
   * loaded model automatically.
   */
  const ensureLoadedLmModel = (which: "a" | "b"): SourceConfig => {
    const source = which === "a" ? sourceA : sourceB;
    if (!isLmStudio(source.provider)) return source;
    const runtime = which === "a" ? runtimeA : runtimeB;
    const loaded = runtime.modelDetails
      .filter((m) => m.loaded)
      .map((m) => m.id);
    if (!loaded.length) return source;
    if (loaded.includes(source.model)) return source;
    const nextModel =
      (runtime.defaultModelId && loaded.includes(runtime.defaultModelId)
        ? runtime.defaultModelId
        : loaded[0]) || source.model;
    if (nextModel === source.model) return source;
    const next = { ...source, model: nextModel, label: undefined };
    if (which === "a") setSourceA(next);
    else setSourceB(next);
    setStatus(
      `${which.toUpperCase()}: switched to loaded ${shortModel(nextModel)} (previous id was not in memory)`
    );
    return next;
  };

  const send = async () => {
    if (!canSend) return;

    const prompt = input.trim();
    const attsSnapshot = [...attachments];
    const startIso = nowIso();
    const { display, apiContent } = buildUserPayload(prompt, attsSnapshot);
    const activeA = ensureLoadedLmModel("a");
    const activeB = mode === "ab" ? ensureLoadedLmModel("b") : sourceB;

    setInput("");
    setAttachments([]);
    setBusy(true);
    busyRef.current = true;
    genStartMsRef.current = Date.now();
    liveLastUiMsRef.current = 0;
    setLiveGen({
      active: true,
      label: mode === "ab" ? "A/B" : "Single",
      outTokens: 0,
      thinkingTokens: 0,
      tokensPerSec: 0,
      elapsedMs: 0,
    });
    setStatus(
      attsSnapshot.length
        ? `1 chat stream to model · ${attsSnapshot.length} attachment(s) · no catalog traffic`
        : "1 chat stream to model · no catalog traffic"
    );
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: UiMessage = {
      id: uid(),
      kind: "user",
      content: display,
      attachmentNames: attsSnapshot.map((a) => a.name),
      attachmentPreviews: attsSnapshot.map(preparedToPreview),
      startIso,
    };
    setMessages((m) => [...m, userMsg]);

    if (mode === "single") {
      const composed = composeSystemPrompt(systemPrompt, personalityA);
      const historyForApi = buildMessagesForSource(apiContent, composed);
      const assistantId = uid();
      setMessages((m) => [
        ...m,
        {
          id: assistantId,
          kind: "assistant",
          content: "",
          thinking: "",
          thinkingActive: false,
          sourceLabel: `${sourceLabel(activeA.provider, activeA.model)} · ${composed.personalityName}`,
          timing: { startIso },
        },
      ]);

      try {
        let lastContent = "";
        let lastThinking = "";
        let contRound = 0;
        const result = await streamChatComplete({
          source: activeA,
          messages: historyForApi,
          signal: controller.signal,
          onContinue: (round) => {
            contRound = round;
            setStatus(
              `Auto-continue ${round}/${3} — finishing long multi-part answer…`
            );
            pushLiveGen({
              label: "Single",
              content: lastContent,
              thinking: lastThinking,
              continueRound: round,
              force: true,
            });
          },
          onThinking: (_chunk, full) => {
            lastThinking = full;
            pushLiveGen({
              label: "Single",
              content: lastContent,
              thinking: full,
              continueRound: contRound || undefined,
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId && msg.kind === "assistant"
                  ? { ...msg, thinking: full, thinkingActive: true }
                  : msg
              )
            );
          },
          onDelta: (_chunk, full) => {
            lastContent = full;
            pushLiveGen({
              label: "Single",
              content: full,
              thinking: lastThinking,
              continueRound: contRound || undefined,
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId && msg.kind === "assistant"
                  ? {
                      ...msg,
                      content: full,
                      thinkingActive: false,
                    }
                  : msg
              )
            );
          },
        });

        const endIso = nowIso();
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId && msg.kind === "assistant"
              ? {
                  ...msg,
                  content: result.error
                    ? `Error: ${result.error}`
                    : result.text || msg.content,
                  thinking: result.thinking || msg.thinking,
                  thinkingActive: false,
                  timing: {
                    startIso,
                    endIso,
                    durationMs: result.latencyMs ?? Date.now() - new Date(startIso).getTime(),
                    ttftMs: result.ttftMs,
                    answerTtftMs: result.answerTtftMs,
                  },
                }
              : msg
          )
        );
        // Always log provider token usage when present (CSV / session totals)
        recordMetric({
          sessionId,
          queryId: assistantId,
          timestampIso: endIso,
          mode: "single",
          pane: "",
          provider: activeA.provider,
          model: result.meta?.model || activeA.model,
          label: result.meta?.label || sourceLabel(activeA.provider, activeA.model),
          personality: composed.personalityName,
          promptPreview: promptPreview(prompt || display),
          promptChars: (prompt || display).length,
          responseChars: (result.text || "").length,
          thinkingChars: (result.thinking || "").length,
          latencyMs: result.latencyMs ?? null,
          ttftMs: result.ttftMs ?? null,
          answerTtftMs: result.answerTtftMs ?? null,
          promptTokens: result.usage?.promptTokens ?? null,
          completionTokens: result.usage?.completionTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
          reasoningTokens: result.usage?.reasoningTokens ?? null,
          error: result.error || "",
        });
        const durationMs =
          result.latencyMs ?? Date.now() - new Date(startIso).getTime();
        const completionTok =
          result.usage?.completionTokens ??
          estimateTokens(result.text || "") +
            estimateTokens(result.thinking || "");
        const finalOut =
          result.usage?.completionTokens ??
          estimateTokens(result.text || "");
        const finalThink =
          result.usage?.reasoningTokens ??
          estimateTokens(result.thinking || "");
        setLiveGen({
          active: false,
          label: "Single",
          outTokens: finalOut,
          thinkingTokens: finalThink,
          tokensPerSec: tokensPerSecond(
            finalOut + finalThink || completionTok,
            durationMs
          ),
          elapsedMs: durationMs,
          exact: result.usage?.completionTokens != null,
          promptTokens: result.usage?.promptTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
        });
        const tok =
          result.usage?.totalTokens != null
            ? ` · ${formatTokenCount(result.usage.totalTokens)} tokens (prompt ${formatTokenCount(result.usage.promptTokens)} + out ${formatTokenCount(result.usage.completionTokens)})`
            : result.usage?.completionTokens != null
              ? ` · ${formatTokenCount(result.usage.completionTokens)} completion tokens`
              : "";
        const segs = (result.continueCount ?? 0) + 1;
        setStatus(
          `Done · start→finish ${formatMs(result.latencyMs)}` +
            (result.ttftMs != null ? ` · TTFT ${formatMs(result.ttftMs)}` : "") +
            tok +
            (result.thinking ? " · thinking shown" : "") +
            (segs > 1 ? ` · ${segs} segments (auto-continue)` : " · 1 request") +
            (result.truncated
              ? ` · still TRUNCATED — raise Max tokens`
              : "")
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setLiveGen(null);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const endIso = nowIso();
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId && msg.kind === "assistant"
              ? {
                  ...msg,
                  content: `Error: ${message}`,
                  thinkingActive: false,
                  timing: {
                    startIso,
                    endIso,
                    durationMs: Date.now() - new Date(startIso).getTime(),
                  },
                }
              : msg
          )
        );
        recordMetric({
          sessionId,
          queryId: assistantId,
          timestampIso: endIso,
          mode: "single",
          pane: "",
          provider: activeA.provider,
          model: activeA.model,
          label: sourceLabel(activeA.provider, activeA.model),
          personality: composed.personalityName,
          promptPreview: promptPreview(prompt || display),
          promptChars: (prompt || display).length,
          responseChars: 0,
          thinkingChars: 0,
          latencyMs: Date.now() - new Date(startIso).getTime(),
          ttftMs: null,
          answerTtftMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          reasoningTokens: null,
          error: message,
        });
        setStatus(message);
        setLiveGen(null);
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
      return;
    }

    const composedA = composeSystemPrompt(systemPrompt, personalityA);
    const composedB = composeSystemPrompt(systemPrompt, personalityB);
    const messagesA = buildMessagesForSource(apiContent, composedA);
    const messagesB = buildMessagesForSource(apiContent, composedB);

    const abId = uid();
    const initialA: PaneState = {
      text: "",
      thinking: "",
      thinkingActive: false,
      label: `${sourceLabel(activeA.provider, activeA.model)} · ${composedA.personalityName}`,
      model: activeA.model,
      loading: true,
      timing: { startIso },
    };
    const initialB: PaneState = {
      text: "",
      thinking: "",
      thinkingActive: false,
      label: `${sourceLabel(activeB.provider, activeB.model)} · ${composedB.personalityName}`,
      model: activeB.model,
      loading: true,
      timing: { startIso },
    };

    // Authoritative live draft for this A/B turn. Parallel stream setStates used to
    // clobber each other (especially on a 2nd test in one session), so pane A text
    // could vanish. Always merge from abDraft *inside* the setState updater.
    const abDraft = {
      a: { ...initialA },
      b: { ...initialB },
    };

    const publishAb = (which: "a" | "b", patch: Partial<PaneState>) => {
      // Never let an empty patch wipe a non-empty text/thinking already drafted
      const prevPane = abDraft[which];
      const nextPatch = { ...patch };
      if (
        typeof nextPatch.text === "string" &&
        !nextPatch.text.trim() &&
        prevPane.text.trim()
      ) {
        delete nextPatch.text;
      }
      if (
        typeof nextPatch.thinking === "string" &&
        !nextPatch.thinking.trim() &&
        (prevPane.thinking || "").trim()
      ) {
        delete nextPatch.thinking;
      }
      abDraft[which] = { ...abDraft[which], ...nextPatch };
      // Live token strip: sum both panes so long A/B runs still look alive
      const combinedOut = `${abDraft.a.text || ""}\n${abDraft.b.text || ""}`;
      const combinedThink = `${abDraft.a.thinking || ""}\n${abDraft.b.thinking || ""}`;
      pushLiveGen({
        label: "A/B",
        content: combinedOut,
        thinking: combinedThink,
      });
      setMessages((prev) => {
        // Read draft at apply-time so queued updates never apply a stale snap
        // that would blank side A when side B publishes.
        const snapA = { ...abDraft.a };
        const snapB = { ...abDraft.b };
        const idx = prev.findIndex(
          (msg) => msg.id === abId && msg.kind === "ab"
        );
        if (idx === -1) {
          // Race: stream events before the initial ab row committed
          return [
            ...prev,
            {
              id: abId,
              kind: "ab" as const,
              prompt: display,
              startIso,
              a: snapA,
              b: snapB,
            },
          ];
        }
        return prev.map((msg) => {
          if (msg.id !== abId || msg.kind !== "ab") return msg;
          return { ...msg, a: snapA, b: snapB };
        });
      });
    };

    setMessages((m) => [
      ...m,
      {
        id: abId,
        kind: "ab",
        prompt: display,
        startIso,
        a: { ...abDraft.a },
        b: { ...abDraft.b },
      },
    ]);

    const truncatedSides: string[] = [];

    const runPane = async (
      which: "a" | "b",
      source: SourceConfig,
      apiMessages: ChatMessage[]
    ) => {
      try {
        const result = await streamChatComplete({
          source,
          messages: apiMessages,
          signal: controller.signal,
          onContinue: (round) => {
            setStatus(
              `Side ${which.toUpperCase()}: auto-continue ${round}/3…`
            );
            pushLiveGen({
              label: "A/B",
              content: `${abDraft.a.text || ""}\n${abDraft.b.text || ""}`,
              thinking: `${abDraft.a.thinking || ""}\n${abDraft.b.thinking || ""}`,
              continueRound: round,
              force: true,
            });
          },
          onMeta: (meta) => {
            publishAb(which, { label: meta.label, model: meta.model });
          },
          onThinking: (_chunk, full) => {
            publishAb(which, { thinking: full, thinkingActive: true });
          },
          onDelta: (_chunk, full) => {
            publishAb(which, { text: full, thinkingActive: false });
          },
        });

        if (result.truncated) truncatedSides.push(which.toUpperCase());

        const endIso = nowIso();
        const personalityName =
          which === "a"
            ? composedA.personalityName
            : composedB.personalityName;

        // Prefer stream result (finalize may peel post-</think> answer only).
        // Never dump thinking/CoT into the output box.
        // result.text already includes a truncation notice when finish_reason=length.
        const finalText = result.error
          ? abDraft[which].text || result.error
          : result.text.trim()
            ? result.text
            : abDraft[which].text;
        const finalThinking =
          result.thinking || abDraft[which].thinking || "";

        // Per-pane usage is recorded for CSV / session totals
        recordMetric({
          sessionId,
          queryId: `${abId}-${which}`,
          timestampIso: endIso,
          mode: "ab",
          pane: which,
          provider: source.provider,
          model: result.meta?.model || source.model,
          label: result.meta?.label || sourceLabel(source.provider, source.model),
          personality: personalityName,
          promptPreview: promptPreview(prompt || display),
          promptChars: (prompt || display).length,
          responseChars: (finalText || "").length,
          thinkingChars: (finalThinking || "").length,
          latencyMs: result.latencyMs ?? null,
          ttftMs: result.ttftMs ?? null,
          answerTtftMs: result.answerTtftMs ?? null,
          promptTokens: result.usage?.promptTokens ?? null,
          completionTokens: result.usage?.completionTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
          reasoningTokens: result.usage?.reasoningTokens ?? null,
          error: result.error || "",
        });
        publishAb(which, {
          text: finalText,
          thinking: finalThinking,
          thinkingActive: false,
          latencyMs: result.latencyMs,
          ttftMs: result.ttftMs,
          error: result.error,
          loading: false,
          label: result.meta?.label || abDraft[which].label,
          model: result.meta?.model || abDraft[which].model,
          timing: {
            startIso,
            endIso,
            durationMs:
              result.latencyMs ?? Date.now() - new Date(startIso).getTime(),
            ttftMs: result.ttftMs,
            answerTtftMs: result.answerTtftMs,
          },
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        const endIso = nowIso();
        const personalityName =
          which === "a"
            ? composedA.personalityName
            : composedB.personalityName;
        recordMetric({
          sessionId,
          queryId: `${abId}-${which}`,
          timestampIso: endIso,
          mode: "ab",
          pane: which,
          provider: source.provider,
          model: source.model,
          label: sourceLabel(source.provider, source.model),
          personality: personalityName,
          promptPreview: promptPreview(prompt || display),
          promptChars: (prompt || display).length,
          responseChars: 0,
          thinkingChars: 0,
          latencyMs: Date.now() - new Date(startIso).getTime(),
          ttftMs: null,
          answerTtftMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          reasoningTokens: null,
          error: message,
        });
        publishAb(which, {
          error: message,
          loading: false,
          thinkingActive: false,
          timing: {
            startIso,
            endIso,
            durationMs: Date.now() - new Date(startIso).getTime(),
          },
        });
      }
    };

    try {
      await Promise.all([
        runPane("a", activeA, messagesA),
        runPane("b", activeB, messagesB),
      ]);
      setStatus(
        "A/B complete — 2 parallel requests. Pick a winner if you want." +
          (truncatedSides.length
            ? ` · TRUNCATED on ${truncatedSides.join(" & ")} — raise Max tokens`
            : "")
      );
      setLiveGen((prev) => {
        if (!prev) return prev;
        const elapsedMs = Math.max(
          1,
          Date.now() - (genStartMsRef.current || Date.now())
        );
        const all = prev.outTokens + prev.thinkingTokens;
        return {
          ...prev,
          active: false,
          elapsedMs,
          tokensPerSec: tokensPerSecond(all, elapsedMs),
        };
      });
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const connClass = (conn: ConnState) => {
    if (conn === "ok") return styles.connOk;
    if (conn === "error") return styles.connBad;
    if (conn === "loading") return styles.connLoading;
    return "";
  };

  const connLabel = (conn: ConnState) => {
    if (conn === "ok") return "Connected";
    if (conn === "error") return "Offline";
    if (conn === "loading") return "Checking…";
    return "Idle";
  };

  const renderSourceEditor = (which: "a" | "b") => {
    const source = which === "a" ? sourceA : sourceB;
    const runtime = which === "a" ? runtimeA : runtimeB;
    const personality = which === "a" ? personalityA : personalityB;
    const setPersonality = which === "a" ? setPersonalityA : setPersonalityB;
    const showBase =
      source.provider === "lmstudio" || source.provider === "custom";
    const isLocal = isLmStudio(source.provider);
    const derived = sourceLabel(source.provider, source.model);
    const details: ModelRow[] =
      runtime.modelDetails.length > 0
        ? runtime.modelDetails
        : runtime.models.map((id) => ({
            id,
            loaded: undefined as boolean | undefined,
          }));

    return (
      <div
        className={`${styles.section} ${
          which === "a" ? styles.sectionA : styles.sectionB
        }`}
      >
        <div className={styles.sectionTitle}>
          <span>Source {which.toUpperCase()}</span>
          <div className={styles.statusRow}>
            <span className={which === "a" ? styles.badgeA : styles.badgeB}>
              {which.toUpperCase()}
            </span>
            <span
              className={`${styles.conn} ${connClass(runtime.conn)}`}
              title="Connection badge only updates when you click Scan — not on every message"
            >
              <span className={styles.connDot} />
              {source.model
                ? runtime.conn === "ok"
                  ? "Ready"
                  : "Model set"
                : connLabel(runtime.conn)}
            </span>
          </div>
        </div>

        <div className={styles.sourceIdentity} title={source.model || undefined}>
          <div className={styles.sourceModel}>
            {shortModel(source.model) === "no model"
              ? isLocal
                ? "auto · use loaded"
                : "No model"
              : shortModel(source.model)}
          </div>
          <div className={styles.sourceHost}>
            {isLocal ? "LM Studio (local)" : PROVIDER_META[source.provider].name}
            {" · "}
            {PERSONALITIES.find((p) => p.id === personality)?.name || "None"}
          </div>
        </div>

        <div className={styles.field}>
          <label>Provider</label>
          <select
            value={source.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderId;
              updateSource(which, {
                provider,
                // LM Studio: leave empty — chat pins to the loaded instance.
                // Never set a catalog id that could force a second model load.
                model: isLmStudio(provider)
                  ? source.provider === "lmstudio" && source.model.trim()
                    ? source.model
                    : ""
                  : PROVIDER_META[provider].defaultModel,
                baseUrl: isLmStudio(provider)
                  ? source.baseUrl || "http://127.0.0.1:1234/v1"
                  : provider === "custom"
                    ? source.baseUrl
                    : "",
                label: undefined,
              });
            }}
          >
            {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => (
              <option key={id} value={id}>
                {PROVIDER_META[id].name}
              </option>
            ))}
          </select>
        </div>

        {(showBase || source.provider === "gemini") && (
          <div className={styles.field}>
            <label>Base URL {source.provider === "gemini" ? "(optional override)" : ""}</label>
            <input
              value={source.baseUrl || ""}
              onChange={(e) => updateSource(which, { baseUrl: e.target.value })}
              onBlur={() => {
                if (!source.baseUrl?.trim()) return;
                if (isLmStudio(source.provider) || source.provider === "custom") {
                  const n = normalizeOpenAIBaseUrl(source.baseUrl);
                  if (n && n !== source.baseUrl) {
                    updateSource(which, { baseUrl: n });
                  }
                }
              }}
              placeholder={
                source.provider === "lmstudio"
                  ? "http://192.168.x.x:1234/v1"
                  : source.provider === "gemini"
                    ? "https://generativelanguage.googleapis.com/v1beta/openai/"
                    : "https://host/v1"
              }
              spellCheck={false}
            />
            {isLocal && (
              <div className={styles.urlHint}>
                {(() => {
                  const d = describeLmStudioBaseUrl(source.baseUrl || "");
                  return (
                    <>
                      <span className={styles.urlNorm}>→ {d.normalized}</span>
                      {d.tips.slice(0, 2).map((t, i) => (
                        <span key={`tip-${i}`} className={styles.urlTip}>
                          {t}
                        </span>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        <div className={styles.field}>
          <div className={styles.fieldLabelRow}>
            <label htmlFor={`model-${which}`}>
              Model
              {details.length > 0 ? ` (${details.length})` : ""}
            </label>
            {runtime.defaultModelId && (
              <button
                type="button"
                className={styles.linkish}
                onClick={() =>
                  updateSource(which, { model: runtime.defaultModelId })
                }
                title="Use LM Studio currently loaded default"
              >
                Use loaded default
              </button>
            )}
          </div>
          <div className={styles.row}>
            {details.length > 0 ? (
              <select
                id={`model-${which}`}
                className={styles.modelSelect}
                value={(() => {
                  const loadedIds = details
                    .filter((m) => m.loaded === true)
                    .map((m) => m.id);
                  // Prefer ● loaded when known, but always clamp to a real option id.
                  let preferred = source.model;
                  if (isLocal && loadedIds.length > 0) {
                    if (source.model && loadedIds.includes(source.model)) {
                      preferred = source.model;
                    } else if (
                      runtime.defaultModelId &&
                      loadedIds.includes(runtime.defaultModelId)
                    ) {
                      preferred = runtime.defaultModelId;
                    } else {
                      preferred = loadedIds[0];
                    }
                  } else if (
                    runtime.defaultModelId &&
                    details.some((m) => m.id === runtime.defaultModelId)
                  ) {
                    preferred = source.model || runtime.defaultModelId;
                  }
                  return safeSelectValue(details, preferred);
                })()}
                onChange={(e) => updateSource(which, { model: e.target.value })}
              >
                {details.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.loaded === true
                      ? `● ${shortModel(m.id)} (loaded)`
                      : m.loaded === false
                        ? `○ ${shortModel(m.id)}`
                        : shortModel(m.id)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={styles.modelSelect}
                value={source.model}
                onChange={(e) => updateSource(which, { model: e.target.value })}
                placeholder={
                  isLocal
                    ? "auto (loaded model)"
                    : source.provider === "xai"
                      ? "grok-4.5"
                      : "model id"
                }
              />
            )}
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.scanBtn}`}
              onClick={() => void fetchModels(which)}
              disabled={runtime.conn === "loading" || busy}
              title="List models from this provider. Always available — retry after errors."
            >
              {runtime.conn === "loading"
                ? "Scanning…"
                : runtime.conn === "error"
                  ? "Retry"
                  : "Scan"}
            </button>
          </div>
          {isLocal && (() => {
            const loadedRows = details.filter((m) => m.loaded === true);
            const selectedRow = details.find((m) => m.id === source.model);
            if (runtime.conn === "loading") return null;
            if (loadedRows.length > 0) {
              const ids = loadedRows.map((m) => shortModel(m.id)).join(", ");
              const selectedIsLoaded = selectedRow?.loaded === true;
              return (
                <div
                  className={
                    selectedIsLoaded ? styles.hintOk : styles.hintBad
                  }
                  style={{ marginTop: 6 }}
                >
                  <strong>LM Studio reports ● in memory:</strong> {ids}
                  {!selectedIsLoaded && source.model ? (
                    <>
                      <br />
                      Selection <code>{shortModel(source.model)}</code> is{" "}
                      <strong>not</strong> loaded on this host — chat will pin
                      to the ● model above (or load will fail).
                    </>
                  ) : null}
                  {loadedRows[0]?.loadedContextLength != null ? (
                    <>
                      <br />
                      Loaded context:{" "}
                      {loadedRows[0].loadedContextLength.toLocaleString()}
                      {loadedRows[0].maxContextLength != null
                        ? ` (GGUF max ${loadedRows[0].maxContextLength.toLocaleString()})`
                        : ""}
                    </>
                  ) : null}
                </div>
              );
            }
            if (details.length > 0 && runtime.hasLoadState === false) {
              return (
                <div className={styles.hint} style={{ marginTop: 6 }}>
                  No ● load flags from this host — catalog only. Pick the model
                  that is actually loaded in LM Studio.
                </div>
              );
            }
            if (details.length > 0) {
              return (
                <div className={styles.hintBad} style={{ marginTop: 6 }}>
                  No model is loaded on this LM Studio host right now. Load
                  Qwen (or your model) in LM Studio on the server, then Scan
                  again.
                </div>
              );
            }
            return null;
          })()}
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabelRow}>
            <label htmlFor={`personality-${which}`}>Personality</label>
            <button
              type="button"
              className={styles.linkish}
              title="Roll a random personality from the roster (like Dialectic Arena 🎲)"
              onClick={() => {
                const p = randomPersonality();
                setPersonality(p.id as PersonalityId);
                setStatus(
                  `${which.toUpperCase()} personality → ${p.name}`
                );
              }}
            >
              🎲 Randomize
            </button>
          </div>
          <select
            id={`personality-${which}`}
            value={safeSelectValue(
              PERSONALITIES.map((p) => ({ id: p.id })),
              personality
            )}
            onChange={(e) =>
              setPersonality(e.target.value as PersonalityId)
            }
          >
            {PERSONALITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className={styles.hint}>
            {PERSONALITIES.find((p) => p.id === personality)?.blurb}
          </div>
        </div>

        <div className={styles.hint}>
          Source id: <strong>{derived}</strong>
        </div>

        <div className={styles.field}>
          <label>
            <span>Temperature</span>
            <span>{(source.temperature ?? 0.5).toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={source.temperature ?? 0.5}
            onChange={(e) =>
              updateSource(which, { temperature: Number(e.target.value) })
            }
          />
        </div>

        <div className={styles.field}>
          <label>
            <span>Max tokens</span>
            <span>{source.maxTokens ?? FAST_DEFAULTS.maxTokens}</span>
          </label>
          <input
            type="range"
            min={256}
            max={16384}
            step={256}
            value={source.maxTokens ?? FAST_DEFAULTS.maxTokens}
            onChange={(e) =>
              updateSource(which, { maxTokens: Number(e.target.value) })
            }
          />
          <p className={styles.hint}>
            Hard cap per generation segment. Long Board memos: use ≥8k–16k.
            MattChat auto-continues up to 3 extra segments if the model hits
            the cap or stops mid multi-part answer.
          </p>
        </div>

        <div
          className={`${styles.hint} ${
            runtime.conn === "ok"
              ? styles.hintOk
              : runtime.conn === "error"
                ? styles.hintBad
                : ""
          }`}
        >
          {runtime.message ||
            (isLocal
              ? "1 Send = 1 chat stream. Scan is optional."
              : PROVIDER_META[source.provider].description)}
        </div>
        {isLocal && runtime.diagnostics && runtime.diagnostics.length > 0 && (
          <ul className={styles.diagList}>
            {runtime.diagnostics.map((line, i) => (
              <li key={`diag-${which}-${i}`}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  if (!hydrated) {
    return (
      <div className={styles.boot}>
        <div className={styles.bootDot} />
        <div>Starting {DEFAULT_CLIENT_NAME}…</div>
      </div>
    );
  }

  const displayName = clientName.trim() || DEFAULT_CLIENT_NAME;

  const topSub =
    mode === "single"
      ? sourceLabel(sourceA.provider, sourceA.model)
      : `A: ${sourceLabel(sourceA.provider, sourceA.model)}  ·  B: ${sourceLabel(sourceB.provider, sourceB.model)}`;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandLeft}>
            {editingName ? (
              <form
                className={styles.brandNameForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  applyClientName(nameDraft);
                }}
              >
                <input
                  ref={nameInputRef}
                  className={styles.brandNameInput}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => applyClientName(nameDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setNameDraft(clientName);
                      setEditingName(false);
                    }
                  }}
                  maxLength={48}
                  aria-label="Client name"
                  spellCheck={false}
                />
              </form>
            ) : (
              <button
                type="button"
                className={styles.brandNameBtn}
                onClick={() => {
                  setNameDraft(clientName);
                  setEditingName(true);
                }}
                title="Click to rename this client (your local label)"
              >
                <h1>{displayName}</h1>
                <span className={styles.brandEditHint} aria-hidden>
                  ✎
                </span>
              </button>
            )}
            <div className={styles.officialBrand} title={`${APP_BRAND} ${appVersionLabel()}`}>
              <div className={styles.officialBrandRow}>
                <span className={styles.officialMark} aria-hidden>
                  M
                </span>
                <div className={styles.officialBrandText}>
                  <span className={styles.officialName}>{APP_BRAND}</span>
                  <span className={styles.officialMeta}>
                    <span className={styles.officialVersion}>{appVersionLabel()}</span>
                    <span className={styles.officialDot} aria-hidden>
                      ·
                    </span>
                    <span className={styles.officialBuilt}>{appBuiltByLabel()}</span>
                  </span>
                </div>
              </div>
            </div>
            <p className={styles.brandTagline}>{APP_TAGLINE}</p>
          </div>
          <span className={styles.portPill}>:3010</span>
        </div>
        <HostStatusBar />

        <div className={styles.modeToggle}>
          <button
            type="button"
            className={`${styles.modeBtn} ${
              mode === "single" ? styles.modeBtnActive : ""
            }`}
            onClick={() => setMode("single")}
          >
            Single
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${
              mode === "ab" ? styles.modeBtnActive : ""
            }`}
            onClick={() => setMode("ab")}
          >
            A/B Test
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <span>Response speed</span>
          </div>
          <div className={styles.modeToggle}>
            <button
              type="button"
              className={`${styles.modeBtn} ${
                fastMode ? styles.modeBtnActive : ""
              }`}
              onClick={() => setFastMode(true)}
              title="Disable thinking / CoT — target seconds on Metal"
            >
              Fast
            </button>
            <button
              type="button"
              className={`${styles.modeBtn} ${
                !fastMode ? styles.modeBtnActive : ""
              }`}
              onClick={() => setFastMode(false)}
              title="Allow thinking models (slower, minutes on long CoT)"
            >
              Thinking
            </button>
          </div>
          <p className={styles.hint}>
            {fastMode ? (
              <>
                <strong>Fast:</strong> no chain-of-thought, max{" "}
                {FAST_DEFAULTS.maxTokens} tokens (raise in Max tokens for long
                memos), short history. Qwen gets <code>/no_think</code>.
              </>
            ) : (
              <>
                <strong>Thinking:</strong> full CoT, max{" "}
                {FAST_DEFAULTS.thinkingMaxTokens} tokens (can take minutes). Use
                for hard analysis.
              </>
            )}
          </p>
          <p className={styles.hint}>
            LM Studio tip: for chat, set context to <strong>8k–32k</strong>, not
            200k. Huge n_ctx still taxes Metal KV cache even on short prompts.
            Keep GPU offload at max.
          </p>
        </div>

        {renderSourceEditor("a")}
        {mode === "ab" && renderSourceEditor("b")}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Base system prompt</div>
          <div className={styles.field}>
            <textarea
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
          <p className={styles.hint}>
            Combined with each source&apos;s personality on every send (Random each
            message re-rolls like Dialectic Arena 🎲).
          </p>
        </div>

        {history.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <span>Recent winners</span>
              <button
                type="button"
                className={styles.linkish}
                onClick={() => {
                  setHistory([]);
                  setStatus("Winner history cleared.");
                }}
                title="Clear A/B winner history only"
              >
                Clear
              </button>
            </div>
            <div className={styles.history}>
              {history.slice(0, 6).map((h, i) => (
                <div
                  key={`${h.id}__${h.at}__${i}`}
                  className={styles.historyItem}
                >
                  <strong>
                    {h.winner === "tie"
                      ? "Tie"
                      : h.winner === "a"
                        ? `A · ${h.aLabel}`
                        : `B · ${h.bLabel}`}
                  </strong>
                  <div>
                    {h.prompt.slice(0, 72)}
                    {h.prompt.length > 72 ? "…" : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {status && <p className={styles.hint}>{status}</p>}
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div className={styles.topbarMeta}>
            <h2>{mode === "single" ? "Chat" : "Side-by-side A/B"}</h2>
            <div className={styles.topbarSub}>{topSub}</div>
            {(liveGen || sessionTokenTotals.total > 0) && (
              <div
                className={`${styles.liveTokens} ${
                  liveGen?.active ? styles.liveTokensActive : ""
                }`}
                title={
                  liveGen?.exact
                    ? "Token counts from provider usage"
                    : "Live estimates (~4 chars/token) until the provider reports usage; session totals use logged usage when available"
                }
              >
                {liveGen ? (
                  <>
                    <span className={styles.livePulse} aria-hidden />
                    <strong>{liveGen.active ? "Live" : "Last"}</strong>
                    <span>
                      out {formatTokenCount(liveGen.outTokens)}
                      {liveGen.thinkingTokens > 0
                        ? ` · think ${formatTokenCount(liveGen.thinkingTokens)}`
                        : ""}
                    </span>
                    <span className={styles.liveTps}>
                      {formatTokPerSec(liveGen.tokensPerSec)}
                    </span>
                    <span>
                      {liveGen.elapsedMs >= 1000
                        ? `${(liveGen.elapsedMs / 1000).toFixed(1)}s`
                        : `${liveGen.elapsedMs}ms`}
                    </span>
                    {liveGen.continueRound ? (
                      <span>cont {liveGen.continueRound}/3</span>
                    ) : null}
                    {liveGen.totalTokens != null ? (
                      <span>
                        total {formatTokenCount(liveGen.totalTokens)}
                        {liveGen.promptTokens != null
                          ? ` (prompt ${formatTokenCount(liveGen.promptTokens)})`
                          : ""}
                      </span>
                    ) : null}
                    {!liveGen.exact && liveGen.active ? (
                      <span className={styles.liveEst}>est.</span>
                    ) : null}
                  </>
                ) : null}
                {sessionTokenTotals.total > 0 || sessionTokenTotals.withUsage > 0 ? (
                  <span className={styles.sessionTokens}>
                    Session{" "}
                    {formatTokenCount(sessionTokenTotals.total)} total
                    {sessionTokenTotals.completion > 0
                      ? ` · ${formatTokenCount(sessionTokenTotals.completion)} out`
                      : ""}
                    {" · "}
                    {sessionTokenTotals.queries} quer
                    {sessionTokenTotals.queries === 1 ? "y" : "ies"}
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <div className={styles.topActions}>
            <ApiKeysButton onClick={() => setApiConfigOpen(true)} />
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={busy || runtimeA.conn === "loading" || runtimeB.conn === "loading"}
              title="List models from active source(s). Safe to retry after errors."
              onClick={() => {
                void fetchModels("a");
                if (mode === "ab") void fetchModels("b");
              }}
            >
              {runtimeA.conn === "loading" ||
              (mode === "ab" && runtimeB.conn === "loading")
                ? "Scanning…"
                : runtimeA.conn === "error" ||
                    (mode === "ab" && runtimeB.conn === "error")
                  ? "Retry scan"
                  : "Scan models"}
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={!sessionMetrics.length && !messages.length}
              title="Export metrics CSV and/or full chat transcript"
              onClick={() => openExport("export")}
            >
              Export
              {sessionMetrics.length > 0 ? ` (${sessionMetrics.length})` : ""}
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => openExport("clear")}
              disabled={
                busy && messages.length === 0 && !sessionMetrics.length
              }
              title="Optionally export CSV + chat (with A/B notes), then clear"
            >
              Clear all chats
            </button>
            <HelpButton onClick={() => setHelpOpen(true)} />
          </div>
        </div>

        <div className={styles.chatArea}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <h3>Ready when your sources are</h3>
              <p>
                {displayName} discovers live models from LM Studio and commercial
                APIs instead of guessing. Confirm the green Connected badge, then
                send — or open{" "}
                <button
                  type="button"
                  className={styles.linkish}
                  onClick={() => setHelpOpen(true)}
                >
                  Help
                </button>{" "}
                in the top right for a full tour.
              </p>
              <ul className={styles.emptySteps}>
                <li>
                  <strong>1.</strong> Click{" "}
                  <button
                    type="button"
                    className={styles.linkish}
                    onClick={() => setApiConfigOpen(true)}
                  >
                    API keys
                  </button>{" "}
                  (top bar) for Grok, OpenAI, LM Studio, etc.
                </li>
                <li>
                  <strong>2.</strong> Connect a model (prefer ● loaded in LM Studio)
                </li>
                <li>
                  <strong>3.</strong> Attach PDF / DOCX / text / images / audio / video
                </li>
                <li>
                  <strong>4.</strong> Send — Single mode by default; start/finish times logged
                </li>
              </ul>
              <div className={styles.modalityBox}>
                <div className={styles.modalityTitle}>Modality cheat sheet</div>
                <p className={styles.hint}>
                  <strong>Images:</strong> LM Studio VLMs (Qwen VLM), Grok vision,
                  OpenAI, Gemini.
                  <br />
                  <strong>Audio:</strong> Best on <strong>Gemini</strong> &amp; OpenAI
                  audio models; local LM Studio usually needs a separate ASR path.
                  <br />
                  <strong>Video:</strong> Best on <strong>Gemini</strong> omni models.
                  Local chat servers typically do <em>not</em> natively understand video.
                </p>
                <p className={styles.hint}>
                  Active source ({sourceA.provider}):{" "}
                  {MODALITY_SUPPORT[sourceA.provider]?.note || "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.messages}>
              {messages.map((m) => {
                if (m.kind === "user") {
                  return (
                    <div
                      key={m.id}
                      className={`${styles.bubble} ${styles.bubbleUser}`}
                    >
                      {m.attachmentPreviews && m.attachmentPreviews.length > 0 ? (
                        <AttachmentPreviewList
                          items={m.attachmentPreviews}
                          compact
                        />
                      ) : m.attachmentNames && m.attachmentNames.length > 0 ? (
                        <div className={styles.metrics} style={{ marginBottom: 8 }}>
                          {m.attachmentNames.map((n) => (
                            <span key={n} className={styles.metric}>
                              📎 {n}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {m.content}
                      <TimingStrip
                        timing={{ startIso: m.startIso }}
                        compact
                      />
                      <div className={styles.timingNote}>
                        Prompt started (finish stamps on the reply)
                      </div>
                    </div>
                  );
                }
                if (m.kind === "assistant") {
                  const streaming =
                    busy &&
                    !m.timing?.endIso &&
                    Boolean(m.thinkingActive || !m.content?.trim());
                  return (
                    <div
                      key={m.id}
                      className={`${styles.bubble} ${styles.bubbleSingle}`}
                    >
                      {m.sourceLabel && (
                        <div className={styles.metrics} style={{ marginBottom: 8 }}>
                          <span className={styles.metric}>{m.sourceLabel}</span>
                        </div>
                      )}
                      <ThinkingBlock
                        thinking={m.thinking || ""}
                        active={Boolean(m.thinkingActive)}
                        defaultOpen={Boolean(m.thinkingActive)}
                      />
                      {/* Single mode: one full-width output/copy box */}
                      <CopyBox
                        text={m.content || ""}
                        label="Output"
                        large
                        streaming={Boolean(streaming)}
                        placeholder={
                          m.thinkingActive
                            ? "Model is thinking…"
                            : streaming
                              ? "Streaming…"
                              : "No output yet"
                        }
                      />
                      <TimingStrip timing={m.timing} />
                    </div>
                  );
                }

                // A/B: two locked grid columns — Side A left, Side B right.
                // Each column has exactly one output CopyBox (never both under B).
                const sides = [
                  { side: "a" as const, pane: m.a },
                  { side: "b" as const, pane: m.b },
                ];

                return (
                  <div key={m.id} className={styles.abBlock}>
                    <div className={styles.abGrid}>
                      {sides.map(({ side, pane }) => (
                        <section
                          key={`${m.id}-${side}`}
                          className={`${styles.abPane} ${
                            side === "a" ? styles.abPaneA : styles.abPaneB
                          }`}
                          aria-label={`Side ${side.toUpperCase()} output`}
                        >
                          <div className={styles.abHeader}>
                            <div>
                              <strong>Side {side.toUpperCase()}</strong>
                              <div className={styles.metrics}>
                                <span className={styles.metric}>
                                  {shortModel(pane.model)}
                                </span>
                              </div>
                              <div className={styles.metrics}>
                                <span className={styles.metric}>{pane.label}</span>
                              </div>
                            </div>
                            <div className={styles.metrics}>
                              <span className={styles.metric}>
                                TTFT {formatMs(pane.ttftMs)}
                              </span>
                              <span className={styles.metric}>
                                {formatMs(pane.latencyMs)}
                              </span>
                            </div>
                          </div>

                          <div className={styles.abBody}>
                            {pane.error ? (
                              <div className={styles.abBodyError}>{pane.error}</div>
                            ) : (
                              <ThinkingBlock
                                thinking={pane.thinking || ""}
                                active={Boolean(pane.thinkingActive)}
                                defaultOpen={Boolean(pane.thinkingActive)}
                              />
                            )}
                            <TimingStrip timing={pane.timing} />
                          </div>

                          <div className={styles.abOutput}>
                            <CopyBox
                              text={
                                pane.error
                                  ? pane.error
                                  : pane.text || ""
                              }
                              label={
                                pane.error
                                  ? `Side ${side.toUpperCase()} · error`
                                  : `Side ${side.toUpperCase()} · output`
                              }
                              streaming={
                                !pane.error && Boolean(pane.loading)
                              }
                              placeholder={
                                pane.thinkingActive
                                  ? "Thinking…"
                                  : pane.loading
                                    ? "Streaming…"
                                    : "No output yet"
                              }
                            />
                          </div>

                          <div className={styles.abFooter}>
                            <button
                              type="button"
                              className={`${styles.pickBtn} ${
                                m.winner === side
                                  ? side === "a"
                                    ? styles.activeA
                                    : styles.activeB
                                  : ""
                              }`}
                              disabled={pane.loading || !!pane.error}
                              onClick={() => setWinner(m.id, side)}
                            >
                              Winner {side.toUpperCase()}
                            </button>
                            {side === "b" && (
                              <button
                                type="button"
                                className={`${styles.pickBtn} ${
                                  m.winner === "tie" ? styles.activeA : ""
                                }`}
                                disabled={m.a.loading || m.b.loading}
                                onClick={() => setWinner(m.id, "tie")}
                              >
                                Tie
                              </button>
                            )}
                          </div>
                        </section>
                      ))}
                    </div>
                    <TimingCompare
                      a={m.a.timing}
                      b={m.b.timing}
                      aLabel={m.a.label}
                      bLabel={m.b.label}
                    />
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className={styles.composer}>
          {attachments.length > 0 && (
            <div className={styles.attachList}>
              <AttachmentPreviewList
                items={attachments.map(preparedToPreview)}
                onRemove={removeAttachment}
              />
            </div>
          )}
          <div className={styles.composerInner}>
            <div className={styles.composerMain}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  !sourceA.model && !isLmStudio(sourceA.provider)
                    ? "Select a connected model first…"
                    : "Ask about text, or attach PDF / DOCX / images…"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={(e) => {
                  const files = e.clipboardData?.files;
                  if (files && files.length) {
                    e.preventDefault();
                    void prepareFiles(files);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer?.files?.length) {
                    void prepareFiles(e.dataTransfer.files);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                disabled={busy || attaching}
              />
              <div className={styles.composerTools}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.csv,.json,.xml,.html,.log,.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mov,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*,image/*,audio/*,video/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      void prepareFiles(e.target.files);
                      e.target.value = "";
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.ghostBtn}
                  disabled={busy || attaching}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {attaching ? "Reading…" : "Attach files"}
                </button>
                <span className={styles.attachHint}>
                  PDF · DOCX · text · image · audio · video
                </span>
              </div>
            </div>
            <button
              type="button"
              className={styles.sendBtn}
              onClick={() => void send()}
              disabled={!canSend}
            >
              {busy ? "Running…" : mode === "ab" ? "Compare" : "Send"}
            </button>
          </div>
        </div>
      </main>

      <KeyManager
        open={apiConfigOpen}
        onOpenChange={setApiConfigOpen}
        panelOnly
      />
      <ExportSessionModal
        open={exportOpen}
        mode={exportMode}
        sessionId={sessionId}
        metricsCount={sessionMetrics.length}
        messagesCount={messages.length}
        hasAb={hasAbInSession}
        onCancel={() => {
          setExportOpen(false);
          if (exportMode === "clear") {
            setStatus("Clear cancelled — chats kept.");
          }
        }}
        onConfirm={applyExportAndMaybeClear}
      />
      <HelpPanel
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        clientName={clientName}
        onClientNameChange={applyClientName}
      />
    </div>
  );
}
