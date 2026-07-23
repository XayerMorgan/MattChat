/**
 * Streaming splitter for reasoning / "thinking" models.
 *
 * Handles:
 * - Dedicated API fields: reasoning_content, reasoning (when passed through)
 * - Inline tags often used by Qwen / DeepSeek / local GGUF ports:
 *   <think>…</think>, <thinking>…</thinking>, <|think|>…</|think|>
 */

const OPEN_TAGS = ["<think>", "<thinking>", "<|think|>", "<|thinking|>"] as const;
const CLOSE_TAGS = ["</think>", "</thinking>", "</|think|>", "</|thinking|>"] as const;

function findEarliest(
  haystack: string,
  needles: readonly string[],
  from = 0
): { index: number; tag: string } | null {
  let best: { index: number; tag: string } | null = null;
  for (const tag of needles) {
    const index = haystack.indexOf(tag, from);
    if (index === -1) continue;
    if (!best || index < best.index) best = { index, tag };
  }
  return best;
}

/** True if `s` ends with a proper prefix of any tag (could complete next chunk). */
function endsWithPartialTag(s: string, tags: readonly string[]): number {
  const max = Math.min(s.length, 24);
  for (let len = max; len >= 1; len--) {
    const suffix = s.slice(-len);
    for (const tag of tags) {
      if (tag.startsWith(suffix) && suffix !== tag) return len;
    }
  }
  return 0;
}

export class ThinkingSplitter {
  private buffer = "";
  private inThink = false;

  /**
   * Feed a content chunk. Returns newly completed thinking / answer slices.
   * Partial tags are held until the next chunk.
   */
  push(chunk: string): { thinking: string; content: string } {
    if (!chunk) return { thinking: "", content: "" };
    this.buffer += chunk;

    let thinking = "";
    let content = "";

    // Hold back partial open/close tags at the end of the buffer
    const holdTags = this.inThink ? CLOSE_TAGS : OPEN_TAGS;
    const hold = endsWithPartialTag(this.buffer, holdTags);
    const workEnd = hold > 0 ? this.buffer.length - hold : this.buffer.length;
    let work = this.buffer.slice(0, workEnd);
    this.buffer = this.buffer.slice(workEnd);

    while (work.length) {
      if (!this.inThink) {
        const open = findEarliest(work, OPEN_TAGS);
        if (!open) {
          content += work;
          work = "";
          break;
        }
        content += work.slice(0, open.index);
        work = work.slice(open.index + open.tag.length);
        this.inThink = true;
      } else {
        const close = findEarliest(work, CLOSE_TAGS);
        if (!close) {
          thinking += work;
          work = "";
          break;
        }
        thinking += work.slice(0, close.index);
        work = work.slice(close.index + close.tag.length);
        this.inThink = false;
      }
    }

    return { thinking, content };
  }

  /** Flush any held buffer (end of stream). */
  flush(): { thinking: string; content: string; stillThinking: boolean } {
    const leftover = this.buffer;
    this.buffer = "";
    if (!leftover) {
      return { thinking: "", content: "", stillThinking: this.inThink };
    }
    if (this.inThink) {
      return { thinking: leftover, content: "", stillThinking: true };
    }
    return { thinking: "", content: leftover, stillThinking: false };
  }

  get isThinking(): boolean {
    return this.inThink;
  }
}

/**
 * Non-streaming helper: strip think blocks from a finished string
 * and return { thinking, content }.
 */
export function splitThinkingFromText(raw: string): {
  thinking: string;
  content: string;
} {
  const splitter = new ThinkingSplitter();
  const mid = splitter.push(raw);
  const end = splitter.flush();
  return {
    thinking: mid.thinking + end.thinking,
    content: mid.content + end.content,
  };
}

/** Pull reasoning fields some providers put beside content. */
export function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const d = delta as Record<string, unknown>;
  const candidates = [
    d.reasoning_content,
    d.reasoning,
    d.reasoning_text,
    d.thinking,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  // Some SDKs nest under delta.reasoning_content as object — rare
  return "";
}

function hasThinkMarkup(s: string): boolean {
  const lower = s.toLowerCase();
  for (const tag of OPEN_TAGS) {
    if (lower.includes(tag.toLowerCase())) return true;
  }
  for (const tag of CLOSE_TAGS) {
    if (lower.includes(tag.toLowerCase())) return true;
  }
  return false;
}

/**
 * After a stream ends, recover *only* answer text that was clearly separated
 * from thinking (e.g. text after `</think>`).
 *
 * Never dumps raw reasoning / LM Studio CoT into the output box. If the model
 * only streamed thinking and no answer content, content stays empty.
 */
export function finalizeStreamOutput(
  thinking: string,
  content: string
): { thinking: string; content: string } {
  let t = typeof thinking === "string" ? thinking : "";
  let c = typeof content === "string" ? content : "";

  // 1) Peel any trailing answer after the last closing think tag in thinking
  let lastClose = -1;
  let closeLen = 0;
  for (const tag of CLOSE_TAGS) {
    const idx = t.toLowerCase().lastIndexOf(tag.toLowerCase());
    if (idx > lastClose) {
      lastClose = idx;
      closeLen = tag.length;
    }
  }
  if (lastClose >= 0) {
    const after = t.slice(lastClose + closeLen).replace(/^\s+/, "");
    const before = t.slice(0, lastClose).replace(/\s+$/, "");
    if (after.trim()) {
      // Prefer peeled answer when content is empty; otherwise keep content
      if (!c.trim()) c = after;
      else if (!c.includes(after.trim())) c = `${c}\n${after}`.trim();
      t = before;
    } else {
      t = before;
    }
  }

  // 2) Re-parse only when think *markup* is present — never treat plain
  // reasoning_content as an answer (that was dumping CoT into Output).
  if (!c.trim() && t.trim() && hasThinkMarkup(t)) {
    const reparsed = splitThinkingFromText(t);
    if (reparsed.content.trim()) {
      t = reparsed.thinking;
      c = reparsed.content;
    }
  }

  // Do NOT promote remaining thinking → content. Leave output empty if the
  // model never produced an answer channel; ThinkingBlock already shows CoT.

  return { thinking: t, content: c };
}
