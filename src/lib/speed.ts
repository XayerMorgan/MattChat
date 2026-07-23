import type { ChatMessage, ContentPart, SourceConfig } from "@/lib/providers";

/** Default: fast path for Mac Metal interactive chat */
export const FAST_DEFAULTS = {
  enableThinking: false,
  /**
   * Fast mode still needs room for structured answers (risk matrices, memos).
   * Long Board-style prompts often need 8k+; auto-continue covers the rest.
   */
  maxTokens: 8192,
  /** Thinking / deep mode default completion budget */
  thinkingMaxTokens: 16384,
  /** How many prior user/assistant pairs to keep */
  maxTurns: 2,
  temperature: 0.5,
} as const;

export function isQwenFamily(model: string): boolean {
  return /qwen/i.test(model || "");
}

/** Nemotron Nano / Omni — reasoning models that use reasoning_content by default */
export function isNemotronFamily(model: string): boolean {
  return /nemotron/i.test(model || "");
}

export function isThinkingModelName(model: string): boolean {
  return (
    /think|reason|r1|qwq/i.test(model || "") ||
    isQwenFamily(model) ||
    isNemotronFamily(model)
  );
}

/**
 * Prepare messages for a fast or thinking-enabled run.
 * - Strips excess history (caller should already cap; we re-cap)
 * - Injects no-think instructions for Qwen when enableThinking is false
 */
export function prepareMessagesForSpeed(
  messages: ChatMessage[],
  source: SourceConfig
): ChatMessage[] {
  const enableThinking = source.enableThinking === true;
  const out = messages.map((m) => ({ ...m, content: m.content }));

  if (enableThinking) return out;

  const noThinkSystem =
    "Speed mode: answer directly in plain language. " +
    "Do NOT write <think> blocks, chain-of-thought, or hidden reasoning. " +
    "Match response length to the request: short for simple questions, " +
    "complete and structured when the user asks for matrices, memos, or multi-part analysis.";

  // Strengthen / replace system
  if (out.length && out[0].role === "system") {
    const prev =
      typeof out[0].content === "string" ? out[0].content : "";
    out[0] = {
      role: "system",
      content: `${prev}\n\n${noThinkSystem}`.trim(),
    };
  } else {
    out.unshift({ role: "system", content: noThinkSystem });
  }

  // Qwen chat templates often honor /no_think on the last user turn
  if (isQwenFamily(source.model)) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role !== "user") continue;
      const c = out[i].content;
      if (typeof c === "string") {
        if (!/\/no_think\b/i.test(c)) {
          out[i] = { role: "user", content: `${c}\n\n/no_think` };
        }
      } else if (Array.isArray(c)) {
        const parts = [...c] as ContentPart[];
        const lastText = [...parts]
          .reverse()
          .find((p) => p.type === "text") as
          | { type: "text"; text: string }
          | undefined;
        if (lastText && !/\/no_think\b/i.test(lastText.text)) {
          lastText.text = `${lastText.text}\n\n/no_think`;
        } else if (!lastText) {
          parts.push({ type: "text", text: "/no_think" });
        }
        out[i] = { role: "user", content: parts };
      }
      break;
    }
  }

  return out;
}

export type ResolveMaxTokensOpts = {
  /** Approx size of the user-facing prompt (chars) — long memos need more room */
  promptChars?: number;
  /**
   * LM Studio *loaded* context (n_ctx), not the GGUF max.
   * Generation cannot exceed remaining context after the prompt.
   */
  loadedContextLength?: number;
};

/**
 * Resolve completion budget for a request.
 * - Raises a floor for long structured prompts (so stale 1024 prefs cannot clip Board memos)
 * - Caps to loaded LM Studio context so we don't request more than the server can emit
 */
export function resolveMaxTokens(
  source: SourceConfig,
  opts?: ResolveMaxTokensOpts
): number {
  let max =
    typeof source.maxTokens === "number" && source.maxTokens > 0
      ? Math.floor(source.maxTokens)
      : source.enableThinking === true
        ? FAST_DEFAULTS.thinkingMaxTokens
        : FAST_DEFAULTS.maxTokens;

  // Stale localStorage often still has 1024 from early Fast defaults
  if (max > 0 && max < 2048) {
    max = source.enableThinking
      ? FAST_DEFAULTS.thinkingMaxTokens
      : FAST_DEFAULTS.maxTokens;
  }

  // Long multi-part prompts (CIO memos etc.) need a higher floor even if the
  // slider was left low — auto-continue still helps but first segment should breathe.
  const chars = opts?.promptChars ?? 0;
  if (chars >= 2500 && max < 8192) {
    max = 8192;
  } else if (chars >= 1200 && max < 4096) {
    max = 4096;
  }

  max = Math.min(Math.max(max, 256), 32768);

  const loadedCtx = opts?.loadedContextLength;
  if (typeof loadedCtx === "number" && loadedCtx > 0) {
    // Leave headroom for system + history + this prompt inside n_ctx.
    // Without this, max_tokens=16k on an 8k loaded model is silently clipped.
    const reserve = Math.min(
      Math.max(2048, Math.floor(loadedCtx * 0.35)),
      Math.floor(loadedCtx * 0.6)
    );
    const room = Math.max(256, loadedCtx - reserve);
    if (max > room) max = room;
  }

  return max;
}

/** Human-readable note when generation is limited by loaded context */
export function contextCapNote(
  requested: number,
  effective: number,
  loadedCtx?: number
): string | undefined {
  if (!loadedCtx || effective >= requested) return undefined;
  return (
    `Capped max_tokens ${requested} → ${effective} because LM Studio loaded context is only ${loadedCtx}. ` +
    `Raise context when loading the model in LM Studio (your GGUF may allow more).`
  );
}
