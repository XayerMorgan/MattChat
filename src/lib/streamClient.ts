import type { ChatMessage, SourceConfig } from "@/lib/providers";
import { mattchatHeaders } from "@/lib/clientId";
import { finalizeStreamOutput } from "@/lib/thinking";

export type StreamMeta = {
  label: string;
  model: string;
  provider: string;
};

export type StreamUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
};

export type StreamResult = {
  text: string;
  thinking: string;
  meta?: StreamMeta;
  latencyMs?: number;
  ttftMs?: number | null;
  answerTtftMs?: number | null;
  usage?: StreamUsage;
  error?: string;
  /** OpenAI-style finish_reason, e.g. stop | length */
  finishReason?: string | null;
  /** True when still truncated after any auto-continues */
  truncated?: boolean;
  maxTokens?: number | null;
  /** Continuation rounds after the first request (0 = single shot) */
  continueCount?: number;
};

const MAX_AUTO_CONTINUES = 3;

function stripTruncationFooter(text: string): string {
  return text
    .replace(/\n\n— \[Stopped: hit max tokens[^\]]*\]\s*$/i, "")
    .trimEnd();
}

/** Heuristic: user asked for multi-part tasks and the answer still looks short of them. */
export function looksIncompleteStructuredAnswer(
  userPrompt: string,
  answer: string
): boolean {
  const prompt = userPrompt || "";
  const text = answer || "";
  if (text.trim().length < 400) return false;

  const taskNums = new Set<number>();
  const re = /(?:^|\n)\s*(\d{1,2})[.)]\s+\S/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) taskNums.add(n);
  }
  if (taskNums.size < 3) return false;

  const maxTask = Math.max(...taskNums);
  const found = new Set<number>();
  const ansRe =
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:section\s+)?(\d{1,2})(?:[.)]|\s*[:—-])\s+\S/gi;
  while ((m = ansRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= maxTask) found.add(n);
  }

  if (/assumption/i.test(text)) found.add(1);
  if (/risk\s*matrix|likelihood\s*[×x*]\s*impact/i.test(text)) found.add(2);
  if (/recommend|go\/no-go|phased decision/i.test(text)) found.add(3);
  if (/additional information|still need|before a final board/i.test(text))
    found.add(4);
  if (/stakeholder|faculty senate|campus presidents/i.test(text)) found.add(5);

  const missingHigh = [...taskNums].filter((n) => n >= 3 && !found.has(n));
  if (missingHigh.length >= 2) return true;
  if (maxTask >= 4 && !found.has(maxTask) && text.length < 14000) return true;

  // Cut off mid-sentence / mid-list even if section headers exist
  const trimmed = text.trim();
  if (
    trimmed.length > 800 &&
    (/[,:;]\s*$/.test(trimmed) ||
      /\b(the|a|an|and|or|of|to|for|with|including|that|which)\s*$/i.test(
        trimmed
      ) ||
      /\*\*[^*]+$/.test(trimmed) ||
      /^\s*[-*]\s+\S[^\n]*$/m.test(trimmed.slice(-120)) &&
        !/[.!?)]\s*$/.test(trimmed))
  ) {
    return true;
  }
  return false;
}

function mergeUsage(
  a?: StreamUsage,
  b?: StreamUsage
): StreamUsage | undefined {
  if (!a && !b) return undefined;
  const add = (x: number | null | undefined, y: number | null | undefined) => {
    if (x == null && y == null) return null;
    return (x ?? 0) + (y ?? 0);
  };
  return {
    promptTokens: add(a?.promptTokens, b?.promptTokens),
    completionTokens: add(a?.completionTokens, b?.completionTokens),
    totalTokens: add(a?.totalTokens, b?.totalTokens),
    reasoningTokens: add(a?.reasoningTokens, b?.reasoningTokens),
  };
}

function extractUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const c = messages[i].content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((p) =>
          p && typeof p === "object" && "text" in p
            ? String((p as { text?: string }).text || "")
            : ""
        )
        .join("\n");
    }
  }
  return "";
}

/**
 * Single stream request (one HTTP call).
 */
export async function streamChat(opts: {
  source: SourceConfig;
  messages: ChatMessage[];
  onDelta?: (text: string, full: string) => void;
  onThinking?: (text: string, full: string) => void;
  onMeta?: (meta: StreamMeta) => void;
  signal?: AbortSignal;
  suppressTruncationFooter?: boolean;
}): Promise<StreamResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...mattchatHeaders(),
    },
    body: JSON.stringify({ source: opts.source, messages: opts.messages }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const fallback = await res.text().catch(() => "");
    try {
      const j = JSON.parse(fallback) as { error?: string; code?: string };
      if (j?.error) throw new Error(j.error);
    } catch (e) {
      if (e instanceof Error && e.message && e.message !== fallback) throw e;
    }
    throw new Error(fallback || `Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let thinking = "";
  let meta: StreamMeta | undefined;
  let latencyMs: number | undefined;
  let ttftMs: number | null | undefined;
  let answerTtftMs: number | null | undefined;
  let usage: StreamUsage | undefined;
  let error: string | undefined;
  let finishReason: string | null | undefined;
  let truncated = false;
  let maxTokens: number | null | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: {
        type: string;
        text?: string;
        label?: string;
        model?: string;
        provider?: string;
        latencyMs?: number;
        ttftMs?: number | null;
        answerTtftMs?: number | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
        reasoningTokens?: number | null;
        error?: string;
        finishReason?: string | null;
        truncated?: boolean;
        maxTokens?: number | null;
      };
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (event.type === "meta" && event.label && event.model && event.provider) {
        meta = {
          label: event.label,
          model: event.model,
          provider: event.provider,
        };
        opts.onMeta?.(meta);
      } else if (event.type === "thinking" && event.text) {
        thinking += event.text;
        opts.onThinking?.(event.text, thinking);
      } else if (event.type === "delta" && event.text) {
        text += event.text;
        opts.onDelta?.(event.text, text);
      } else if (event.type === "done") {
        latencyMs = event.latencyMs;
        ttftMs = event.ttftMs ?? null;
        answerTtftMs = event.answerTtftMs ?? null;
        usage = {
          promptTokens: event.promptTokens ?? null,
          completionTokens: event.completionTokens ?? null,
          totalTokens: event.totalTokens ?? null,
          reasoningTokens: event.reasoningTokens ?? null,
        };
        finishReason = event.finishReason ?? null;
        truncated = Boolean(event.truncated || event.finishReason === "length");
        maxTokens =
          typeof event.maxTokens === "number" ? event.maxTokens : null;
      } else if (event.type === "error") {
        error = event.error || "Unknown stream error";
      }
    }
  }

  const finalized = finalizeStreamOutput(thinking, text);
  let outText = finalized.content;
  if (truncated && outText.trim() && !opts.suppressTruncationFooter) {
    outText = `${outText.trimEnd()}\n\n— [Stopped: hit max tokens${
      maxTokens != null ? ` (${maxTokens})` : ""
    }. Raise Max tokens in the source panel.]`;
  }

  return {
    text: outText,
    thinking: finalized.thinking,
    meta,
    latencyMs,
    ttftMs,
    answerTtftMs,
    usage,
    error,
    finishReason,
    truncated,
    maxTokens,
    continueCount: 0,
  };
}

/**
 * Stream a completion and auto-continue when truncated or when a multi-part
 * answer clearly stopped early (up to MAX_AUTO_CONTINUES extra requests).
 */
export async function streamChatComplete(opts: {
  source: SourceConfig;
  messages: ChatMessage[];
  onDelta?: (text: string, full: string) => void;
  onThinking?: (text: string, full: string) => void;
  onMeta?: (meta: StreamMeta) => void;
  onContinue?: (round: number) => void;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const userPrompt = extractUserText(opts.messages);

  let combinedText = "";
  let combinedThinking = "";
  let meta: StreamMeta | undefined;
  let totalLatency = 0;
  let firstTtft: number | null | undefined;
  let firstAnswerTtft: number | null | undefined;
  let usage: StreamUsage | undefined;
  let lastError: string | undefined;
  let finishReason: string | null | undefined;
  let truncated = false;
  let maxTokens: number | null | undefined;
  let continueCount = 0;

  for (let round = 0; round <= MAX_AUTO_CONTINUES; round++) {
    if (opts.signal?.aborted) break;

    const baseText = combinedText;
    const baseThink = combinedThinking;
    const isContinue = round > 0;

    if (isContinue) {
      continueCount = round;
      opts.onContinue?.(round);
    }

    const messages: ChatMessage[] = isContinue
      ? [
          ...opts.messages,
          { role: "assistant", content: baseText },
          {
            role: "user",
            content:
              "Continue your previous answer from exactly where you stopped. " +
              "Do not restart and do not repeat finished sections. " +
              "Do not invent dollar figures, timeline percentages, or case-study outcomes that were not provided. " +
              "Finish any incomplete section first, then complete every remaining numbered task in order " +
              "(assumptions, risk matrix, recommendation with go/no-go criteria, information still needed, stakeholder communication).",
          },
        ]
      : opts.messages;

    const result = await streamChat({
      source: opts.source,
      messages,
      signal: opts.signal,
      suppressTruncationFooter: true,
      onMeta: (m) => {
        meta = m;
        opts.onMeta?.(m);
      },
      onThinking: (chunk, fullSeg) => {
        const full = baseThink
          ? `${baseThink}${baseThink.endsWith("\n") ? "" : "\n"}${fullSeg}`
          : fullSeg;
        combinedThinking = full;
        opts.onThinking?.(chunk, full);
      },
      onDelta: (chunk, fullSeg) => {
        const full = baseText + fullSeg;
        combinedText = full;
        opts.onDelta?.(chunk, full);
      },
    });

    // Prefer finalized segment text (cleaner) over raw stream accumulation
    const segText = stripTruncationFooter(result.text || "");
    const segThink = result.thinking || "";
    combinedText = baseText + segText;
    combinedThinking = baseThink
      ? segThink
        ? `${baseThink}\n${segThink}`
        : baseThink
      : segThink;
    opts.onDelta?.("", combinedText);
    if (combinedThinking) opts.onThinking?.("", combinedThinking);

    if (result.meta) meta = result.meta;
    totalLatency += result.latencyMs ?? 0;
    if (firstTtft == null && result.ttftMs != null) firstTtft = result.ttftMs;
    if (firstAnswerTtft == null && result.answerTtftMs != null) {
      firstAnswerTtft = result.answerTtftMs;
    }
    usage = mergeUsage(usage, result.usage);
    lastError = result.error;
    finishReason = result.finishReason ?? finishReason;
    truncated = Boolean(result.truncated);
    maxTokens = result.maxTokens ?? maxTokens;

    if (result.error) break;
    if (round >= MAX_AUTO_CONTINUES) break;

    const needLength = truncated && combinedText.trim().length > 0;
    const needStructure =
      !needLength &&
      looksIncompleteStructuredAnswer(userPrompt, combinedText);

    if (!needLength && !needStructure) break;
  }

  let outText = combinedText;
  if (truncated && outText.trim()) {
    outText = `${outText.trimEnd()}\n\n— [Stopped: still over max tokens after ${
      continueCount + 1
    } segment(s)${
      maxTokens != null ? ` · ${maxTokens}/segment` : ""
    }. Raise Max tokens for longer single-shot replies.]`;
  }

  return {
    text: outText,
    thinking: combinedThinking,
    meta,
    latencyMs: totalLatency || undefined,
    ttftMs: firstTtft,
    answerTtftMs: firstAnswerTtft,
    usage,
    error: lastError,
    finishReason,
    truncated,
    maxTokens,
    continueCount,
  };
}
