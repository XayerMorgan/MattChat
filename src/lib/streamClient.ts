import type { ChatMessage, SourceConfig } from "@/lib/providers";
import { mattchatHeaders } from "@/lib/clientId";

export type StreamMeta = {
  label: string;
  model: string;
  provider: string;
};

export type StreamResult = {
  text: string;
  thinking: string;
  meta?: StreamMeta;
  latencyMs?: number;
  ttftMs?: number | null;
  answerTtftMs?: number | null;
  error?: string;
};

export async function streamChat(opts: {
  source: SourceConfig;
  messages: ChatMessage[];
  onDelta?: (text: string, full: string) => void;
  onThinking?: (text: string, full: string) => void;
  onMeta?: (meta: StreamMeta) => void;
  signal?: AbortSignal;
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
    // Surface capacity errors cleanly
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
  let error: string | undefined;

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
        error?: string;
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
      } else if (event.type === "error") {
        error = event.error || "Unknown stream error";
      }
    }
  }

  return { text, thinking, meta, latencyMs, ttftMs, answerTtftMs, error };
}
