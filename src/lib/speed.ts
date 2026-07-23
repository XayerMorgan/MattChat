import type { ChatMessage, ContentPart, SourceConfig } from "@/lib/providers";

/** Default: fast path for Mac Metal interactive chat */
export const FAST_DEFAULTS = {
  enableThinking: false,
  maxTokens: 1024,
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
    "Prefer under 150 words unless the user asks for depth.";

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

export function resolveMaxTokens(source: SourceConfig): number {
  if (typeof source.maxTokens === "number" && source.maxTokens > 0) {
    return source.maxTokens;
  }
  return source.enableThinking === true ? 4096 : FAST_DEFAULTS.maxTokens;
}
