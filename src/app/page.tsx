"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  PROVIDER_META,
  displayModelName,
  isLmStudio,
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
import { streamChat } from "@/lib/streamClient";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { TimingCompare, TimingStrip } from "@/components/TimingStrip";
import { KeyManager } from "@/components/KeyManager";

type Mode = "single" | "ab";
type ConnState = "idle" | "loading" | "ok" | "error";

type UiMessage =
  | {
      id: string;
      kind: "user";
      content: string;
      attachmentNames?: string[];
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

type ModelRow = { id: string; loaded?: boolean };

type SourceRuntime = {
  models: string[];
  modelDetails: ModelRow[];
  defaultModelId: string;
  conn: ConnState;
  message: string;
};

// Bumped: drop stale localStorage that hard-coded qwen/qwen3.5-9b and
// caused LM Studio to load a second model on chat.
const STORAGE_KEY = "mattchat-v7";

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const sourceARef = useRef(sourceA);
  const sourceBRef = useRef(sourceB);
  sourceARef.current = sourceA;
  sourceBRef.current = sourceB;

  // Hydrate prefs client-side only. Never contacts LM Studio.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.sourceA) {
          const a = parsed.sourceA as SourceConfig;
          setSourceA({
            ...a,
            label: undefined,
            // Never reinstate a stale hard-coded catalog default (e.g. qwen).
            // Empty LM Studio model → server uses the already-loaded instance.
            model: a.model?.trim() || "",
          });
        }
        if (parsed.sourceB) {
          const b = parsed.sourceB as SourceConfig;
          setSourceB({
            ...b,
            label: undefined,
            model: b.model?.trim() || "",
          });
        }
        if (parsed.systemPrompt) setSystemPrompt(parsed.systemPrompt);
        if (parsed.personalityA) setPersonalityA(parsed.personalityA);
        if (parsed.personalityB) setPersonalityB(parsed.personalityB);
        if (typeof parsed.fastMode === "boolean") setFastMode(parsed.fastMode);
        // Mode is intentionally NOT restored — Single is always the default.
        setMode("single");
        if (Array.isArray(parsed.history)) setHistory(parsed.history);
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
    history,
  ]);

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
          maxTokens: 4096,
        };
    setSourceA((s) => ({ ...s, ...patch }));
    setSourceB((s) => ({ ...s, ...patch }));
    if (fastMode) setPersonalityA("concise");
  }, [fastMode, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

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
   */
  const fetchModels = useCallback(async (which: "a" | "b") => {
    if (busyRef.current) {
      setStatus("Generation in progress — scan blocked until it finishes.");
      return;
    }

    const source = which === "a" ? sourceARef.current : sourceBRef.current;

    setRuntime(which, {
      conn: "loading",
      message: "Manual catalog scan…",
    });

    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: source.provider,
          baseUrl: source.baseUrl || undefined,
        }),
      });
      const json = await res.json();
      const models = (json.models as string[]) || [];
      const defaultModelId =
        typeof json.defaultModelId === "string" ? json.defaultModelId : "";
      const modelDetails: ModelRow[] = Array.isArray(json.modelDetails)
        ? json.modelDetails.map((m: { id: string; loaded?: boolean }) => ({
            id: m.id,
            loaded: Boolean(m.loaded),
          }))
        : models.map((id: string) => ({ id }));

      if (!res.ok || json.ok === false) {
        setRuntime(which, {
          models: [],
          modelDetails: [],
          defaultModelId: "",
          conn: "error",
          message: json.error || "Failed to list models",
        });
        return;
      }

      const loadedModels = modelDetails
        .filter((m) => m.loaded)
        .map((m) => m.id);
      const selected = pickBestModel({
        provider: source.provider,
        models,
        defaultModelId,
        current: source.model,
        loadedModels,
      });

      const loadedCount = modelDetails.filter((m) => m.loaded).length;
      const msg = !models.length
        ? isLmStudio(source.provider)
          ? "Server reachable, but no models found."
          : "No models returned"
        : isLmStudio(source.provider)
          ? `${models.length} models · ${loadedCount} loaded · ${shortModel(selected)}`
          : `${models.length} models · ${shortModel(selected)}`;

      const runtime: SourceRuntime = {
        models,
        modelDetails,
        defaultModelId,
        conn: models.length || selected ? "ok" : "error",
        message: msg,
      };

      if (which === "a") {
        setSourceA((s) => ({ ...s, model: selected || s.model, label: undefined }));
        setRuntimeA(runtime);
      } else {
        setSourceB((s) => ({ ...s, model: selected || s.model, label: undefined }));
        setRuntimeB(runtime);
      }

      if (selected) {
        setStatus(
          `${which.toUpperCase()}: ${sourceLabel(source.provider, selected)}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRuntime(which, {
        models: [],
        modelDetails: [],
        defaultModelId: "",
        conn: "error",
        message,
      });
    }
  }, []);

  // No auto model scans. LM Studio is only contacted on:
  //   1) Send → POST /api/chat (exactly once)
  //   2) User clicks Scan → POST /api/models (optional)

  const updateSource = (which: "a" | "b", patch: Partial<SourceConfig>) => {
    if (which === "a") setSourceA((s) => ({ ...s, ...patch }));
    else setSourceB((s) => ({ ...s, ...patch }));
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setBusy(false);
    setStatus("Chat cleared.");
  };

  const setWinner = (msgId: string, winner: "a" | "b" | "tie") => {
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === msgId && m.kind === "ab" ? { ...m, winner } : m
      );
      const msg = next.find((m) => m.id === msgId);
      if (msg?.kind === "ab") {
        setHistory((h) =>
          [
            {
              id: msgId,
              at: new Date().toISOString(),
              prompt: msg.prompt,
              aLabel: msg.a.label || sourceLabel(sourceA.provider, sourceA.model),
              bLabel: msg.b.label || sourceLabel(sourceB.provider, sourceB.model),
              winner,
            },
            ...h,
          ].slice(0, 30)
        );
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
        const result = await streamChat({
          source: activeA,
          messages: historyForApi,
          signal: controller.signal,
          onThinking: (_chunk, full) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId && msg.kind === "assistant"
                  ? { ...msg, thinking: full, thinkingActive: true }
                  : msg
              )
            );
          },
          onDelta: (_chunk, full) => {
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
        setStatus(
          `Done · start→finish ${formatMs(result.latencyMs)}` +
            (result.ttftMs != null ? ` · TTFT ${formatMs(result.ttftMs)}` : "") +
            (result.thinking ? " · thinking shown" : "") +
            " · 1 request"
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
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
        setStatus(message);
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
    setMessages((m) => [
      ...m,
      {
        id: abId,
        kind: "ab",
        prompt: display,
        startIso,
        a: {
          text: "",
          thinking: "",
          thinkingActive: false,
          label: `${sourceLabel(activeA.provider, activeA.model)} · ${composedA.personalityName}`,
          model: activeA.model,
          loading: true,
          timing: { startIso },
        },
        b: {
          text: "",
          thinking: "",
          thinkingActive: false,
          label: `${sourceLabel(activeB.provider, activeB.model)} · ${composedB.personalityName}`,
          model: activeB.model,
          loading: true,
          timing: { startIso },
        },
      },
    ]);

    const runPane = async (
      which: "a" | "b",
      source: SourceConfig,
      apiMessages: ChatMessage[]
    ) => {
      try {
        const result = await streamChat({
          source,
          messages: apiMessages,
          signal: controller.signal,
          onMeta: (meta) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== abId || msg.kind !== "ab") return msg;
                return {
                  ...msg,
                  [which]: {
                    ...msg[which],
                    label: meta.label,
                    model: meta.model,
                  },
                };
              })
            );
          },
          onThinking: (_chunk, full) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== abId || msg.kind !== "ab") return msg;
                return {
                  ...msg,
                  [which]: {
                    ...msg[which],
                    thinking: full,
                    thinkingActive: true,
                  },
                };
              })
            );
          },
          onDelta: (_chunk, full) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== abId || msg.kind !== "ab") return msg;
                return {
                  ...msg,
                  [which]: {
                    ...msg[which],
                    text: full,
                    thinkingActive: false,
                  },
                };
              })
            );
          },
        });

        const endIso = nowIso();
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== abId || msg.kind !== "ab") return msg;
            return {
              ...msg,
              [which]: {
                ...msg[which],
                text: result.error
                  ? msg[which].text || result.error
                  : result.text || msg[which].text,
                thinking: result.thinking || msg[which].thinking,
                thinkingActive: false,
                latencyMs: result.latencyMs,
                ttftMs: result.ttftMs,
                error: result.error,
                loading: false,
                label: result.meta?.label || msg[which].label,
                model: result.meta?.model || msg[which].model,
                timing: {
                  startIso,
                  endIso,
                  durationMs:
                    result.latencyMs ??
                    Date.now() - new Date(startIso).getTime(),
                  ttftMs: result.ttftMs,
                  answerTtftMs: result.answerTtftMs,
                },
              },
            };
          })
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        const endIso = nowIso();
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== abId || msg.kind !== "ab") return msg;
            return {
              ...msg,
              [which]: {
                ...msg[which],
                error: message,
                loading: false,
                thinkingActive: false,
                timing: {
                  startIso,
                  endIso,
                  durationMs: Date.now() - new Date(startIso).getTime(),
                },
              },
            };
          })
        );
      }
    };

    try {
      await Promise.all([
        runPane("a", activeA, messagesA),
        runPane("b", activeB, messagesB),
      ]);
      setStatus("A/B complete — 2 parallel requests. Pick a winner if you want.");
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
    const details =
      runtime.modelDetails.length > 0
        ? runtime.modelDetails
        : runtime.models.map((id) => ({ id, loaded: undefined as boolean | undefined }));

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
              placeholder={
                source.provider === "lmstudio"
                  ? "http://127.0.0.1:1234/v1"
                  : source.provider === "gemini"
                    ? "https://generativelanguage.googleapis.com/v1beta/openai/"
                    : "https://host/v1"
              }
            />
          </div>
        )}

        <div className={styles.field}>
          <label>
            <span>
              Model
              {details.length > 0 ? ` (${details.length})` : ""}
            </span>
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
          </label>
          <div className={styles.row}>
            {details.length > 0 ? (
              <select
                className={styles.modelSelect}
                value={
                  details.some((m) => m.id === source.model)
                    ? source.model
                    : details[0].id
                }
                onChange={(e) => updateSource(which, { model: e.target.value })}
              >
                {details.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.loaded
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
              className={styles.iconBtn}
              onClick={() => void fetchModels(which)}
              disabled={runtime.conn === "loading" || busy}
              title="Optional: list models once. Not required for chat. Never auto-runs."
            >
              {runtime.conn === "loading" ? "…" : "Scan"}
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <label>
            <span>Personality</span>
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
          </label>
          <select
            value={personality}
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
          <p className={styles.hint}>
            {PERSONALITIES.find((p) => p.id === personality)?.blurb}
          </p>
        </div>

        <p className={styles.hint}>
          Source id: <strong>{derived}</strong>
        </p>

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
            max={8192}
            step={256}
            value={source.maxTokens ?? FAST_DEFAULTS.maxTokens}
            onChange={(e) =>
              updateSource(which, { maxTokens: Number(e.target.value) })
            }
          />
        </div>

        <p
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
        </p>
      </div>
    );
  };

  if (!hydrated) {
    return (
      <div className={styles.boot}>
        <div className={styles.bootDot} />
        <div>Starting MattChat…</div>
      </div>
    );
  }

  const topSub =
    mode === "single"
      ? sourceLabel(sourceA.provider, sourceA.model)
      : `A: ${sourceLabel(sourceA.provider, sourceA.model)}  ·  B: ${sourceLabel(sourceB.provider, sourceB.model)}`;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandLeft}>
            <h1>MattChat</h1>
            <p>Omnimodal chat · clinical timing · A/B</p>
          </div>
          <span className={styles.portPill}>:3010</span>
        </div>

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

        <KeyManager />

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
                {FAST_DEFAULTS.maxTokens} tokens, short history. Qwen gets{" "}
                <code>/no_think</code>.
              </>
            ) : (
              <>
                <strong>Thinking:</strong> full CoT (can take minutes). Use for
                hard analysis only.
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
            <div className={styles.sectionTitle}>Recent winners</div>
            <div className={styles.history}>
              {history.slice(0, 6).map((h) => (
                <div key={h.id} className={styles.historyItem}>
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
          </div>
          <div className={styles.topActions}>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={busy}
              title="Optional catalog list only — does not chat"
              onClick={() => {
                void fetchModels("a");
                if (mode === "ab") void fetchModels("b");
              }}
            >
              Scan models
            </button>
            <button type="button" className={styles.ghostBtn} onClick={clearChat}>
              Clear
            </button>
          </div>
        </div>

        <div className={styles.chatArea}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <h3>Ready when your sources are</h3>
              <p>
                MattChat discovers live models from LM Studio and commercial APIs
                instead of guessing. Confirm the green Connected badge, then send.
              </p>
              <ul className={styles.emptySteps}>
                <li>
                  <strong>1.</strong> Connect a model (prefer ● loaded in LM Studio)
                </li>
                <li>
                  <strong>2.</strong> Attach PDF / DOCX / text / images / audio / video
                </li>
                <li>
                  <strong>3.</strong> Send — Single mode by default; start/finish times logged
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
                      {m.attachmentNames && m.attachmentNames.length > 0 && (
                        <div className={styles.metrics} style={{ marginBottom: 8 }}>
                          {m.attachmentNames.map((n) => (
                            <span key={n} className={styles.metric}>
                              📎 {n}
                            </span>
                          ))}
                        </div>
                      )}
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
                  return (
                    <div key={m.id} className={styles.bubble}>
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
                      {m.content ||
                        (busy && !m.thinking ? "…" : "") ||
                        (m.thinking && !m.content && !busy ? "" : "")}
                      <TimingStrip timing={m.timing} />
                    </div>
                  );
                }

                return (
                  <div key={m.id} className={styles.abGrid}>
                    {(["a", "b"] as const).map((side) => {
                      const pane = m[side];
                      return (
                        <div
                          key={side}
                          className={`${styles.abPane} ${
                            side === "a" ? styles.abPaneA : styles.abPaneB
                          }`}
                        >
                          <div className={styles.abHeader}>
                            <div>
                              <strong>{pane.label}</strong>
                              <div className={styles.metrics}>
                                <span className={styles.metric}>
                                  {shortModel(pane.model)}
                                </span>
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
                          <div
                            className={`${styles.abBody} ${
                              pane.error ? styles.abBodyError : ""
                            }`}
                          >
                            {pane.error ? (
                              pane.error
                            ) : (
                              <>
                                <ThinkingBlock
                                  thinking={pane.thinking || ""}
                                  active={Boolean(pane.thinkingActive)}
                                  defaultOpen={Boolean(pane.thinkingActive)}
                                />
                                {pane.text ? (
                                  pane.text
                                ) : pane.loading ? (
                                  <span className={styles.streaming}>
                                    {pane.thinkingActive
                                      ? "Model is thinking…"
                                      : "Streaming…"}
                                  </span>
                                ) : (
                                  ""
                                )}
                                <TimingStrip timing={pane.timing} />
                              </>
                            )}
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
                        </div>
                      );
                    })}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <TimingCompare
                        a={m.a.timing}
                        b={m.b.timing}
                        aLabel={m.a.label}
                        bLabel={m.b.label}
                      />
                    </div>
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
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className={`${styles.attachChip} ${
                    a.error ? styles.attachChipBad : ""
                  }`}
                  title={a.error || a.name}
                >
                  <span>
                    📎 {a.name}
                    <span className={styles.attachMeta}>
                      {" "}
                      · {a.kind}
                      {a.pages ? ` · ${a.pages}p` : ""}
                      {" · "}
                      {formatBytes(a.size)}
                      {a.truncated ? " · truncated" : ""}
                      {a.error ? ` · ${a.error}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.attachRemove}
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
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
    </div>
  );
}
