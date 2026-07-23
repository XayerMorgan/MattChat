/** Per-session query metrics → CSV + optional chat transcript (client downloads only). */

export type QueryMetric = {
  sessionId: string;
  queryId: string;
  timestampIso: string;
  mode: "single" | "ab";
  pane: "a" | "b" | "";
  provider: string;
  model: string;
  label: string;
  personality: string;
  promptPreview: string;
  promptChars: number;
  responseChars: number;
  thinkingChars: number;
  latencyMs: number | null;
  ttftMs: number | null;
  answerTtftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  error: string;
};

/** Minimal chat shapes used for transcript export (avoid coupling to page types). */
export type TranscriptMessage =
  | {
      kind: "user";
      content: string;
      startIso?: string;
      attachmentNames?: string[];
    }
  | {
      kind: "assistant";
      content: string;
      sourceLabel?: string;
      thinking?: string;
      timing?: {
        startIso?: string;
        endIso?: string;
        durationMs?: number;
        ttftMs?: number | null;
      };
    }
  | {
      kind: "ab";
      prompt: string;
      startIso?: string;
      winner?: "a" | "b" | "tie";
      a: {
        label: string;
        model?: string;
        text: string;
        thinking?: string;
        latencyMs?: number;
        ttftMs?: number | null;
        error?: string;
      };
      b: {
        label: string;
        model?: string;
        text: string;
        thinking?: string;
        latencyMs?: number;
        ttftMs?: number | null;
        error?: string;
      };
    };

const CSV_HEADERS: (keyof QueryMetric)[] = [
  "sessionId",
  "queryId",
  "timestampIso",
  "mode",
  "pane",
  "provider",
  "model",
  "label",
  "personality",
  "promptPreview",
  "promptChars",
  "responseChars",
  "thinkingChars",
  "latencyMs",
  "ttftMs",
  "answerTtftMs",
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "reasoningTokens",
  "error",
];

export function newSessionId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `sess-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function metricsToCsv(
  rows: QueryMetric[],
  opts?: { sessionNote?: string; abQualityNote?: string }
): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(row[h])).join(","));
  }

  const note = (opts?.sessionNote || "").trim();
  const ab = (opts?.abQualityNote || "").trim();
  if (note || ab) {
    lines.push("");
    // Trailing “notes” section as a tiny key/value CSV so tools still parse it
    lines.push("note_type,text");
    if (note) lines.push(`session_comment,${csvEscape(note)}`);
    if (ab) lines.push(`ab_quality,${csvEscape(ab)}`);
  }

  return lines.join("\n") + "\n";
}

export function defaultMetricsFilename(sessionId: string): string {
  const safe = (sessionId || "session").replace(/[^\w.-]+/g, "_");
  return `mattchat-${safe}.csv`;
}

export function defaultChatFilename(sessionId: string): string {
  const safe = (sessionId || "session").replace(/[^\w.-]+/g, "_");
  return `mattchat-chat-${safe}.md`;
}

function sanitizeFilename(filename: string, ext: string): string {
  let name = (filename || "").trim() || `download${ext}`;
  if (!name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
  return name.replace(/[/\\]/g, "-");
}

export function downloadTextFile(
  filename: string,
  body: string,
  mime: string
): void {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, csv: string): void {
  downloadTextFile(
    sanitizeFilename(filename, ".csv"),
    csv,
    "text/csv;charset=utf-8"
  );
}

export function downloadChatMarkdown(filename: string, markdown: string): void {
  downloadTextFile(
    sanitizeFilename(filename, ".md"),
    markdown,
    "text/markdown;charset=utf-8"
  );
}

export function messagesToMarkdown(
  messages: TranscriptMessage[],
  opts?: {
    sessionId?: string;
    sessionNote?: string;
    abQualityNote?: string;
  }
): string {
  const out: string[] = [];
  out.push("# MattChat transcript");
  out.push("");
  out.push(`- Exported: ${new Date().toISOString()}`);
  if (opts?.sessionId) out.push(`- Session: \`${opts.sessionId}\``);
  out.push("");

  if (opts?.sessionNote?.trim()) {
    out.push("## Session notes");
    out.push("");
    out.push(opts.sessionNote.trim());
    out.push("");
  }
  if (opts?.abQualityNote?.trim()) {
    out.push("## A/B quality notes");
    out.push("");
    out.push(opts.abQualityNote.trim());
    out.push("");
  }

  out.push("## Conversation");
  out.push("");

  for (const m of messages) {
    if (m.kind === "user") {
      out.push("### User");
      if (m.startIso) out.push(`*${m.startIso}*`);
      if (m.attachmentNames?.length) {
        out.push(`Attachments: ${m.attachmentNames.join(", ")}`);
      }
      out.push("");
      out.push(m.content || "");
      out.push("");
    } else if (m.kind === "assistant") {
      out.push(`### Assistant${m.sourceLabel ? ` — ${m.sourceLabel}` : ""}`);
      if (m.timing?.durationMs != null) {
        out.push(
          `*Duration ${m.timing.durationMs}ms` +
            (m.timing.ttftMs != null ? ` · TTFT ${m.timing.ttftMs}ms` : "") +
            "*"
        );
      }
      out.push("");
      if (m.thinking?.trim()) {
        out.push("<details><summary>Thinking</summary>");
        out.push("");
        out.push(m.thinking.trim());
        out.push("");
        out.push("</details>");
        out.push("");
      }
      out.push(m.content || "");
      out.push("");
    } else if (m.kind === "ab") {
      out.push("### A/B comparison");
      if (m.startIso) out.push(`*${m.startIso}*`);
      out.push("");
      out.push("**Prompt**");
      out.push("");
      out.push(m.prompt || "");
      out.push("");
      for (const side of ["a", "b"] as const) {
        const pane = m[side];
        out.push(`#### Side ${side.toUpperCase()} — ${pane.label}`);
        if (pane.model) out.push(`Model: \`${pane.model}\``);
        if (pane.latencyMs != null) {
          out.push(
            `Latency: ${pane.latencyMs}ms` +
              (pane.ttftMs != null ? ` · TTFT ${pane.ttftMs}ms` : "")
          );
        }
        if (pane.error) out.push(`**Error:** ${pane.error}`);
        out.push("");
        if (pane.thinking?.trim()) {
          out.push("<details><summary>Thinking</summary>");
          out.push("");
          out.push(pane.thinking.trim());
          out.push("");
          out.push("</details>");
          out.push("");
        }
        out.push(pane.text || "");
        out.push("");
      }
      if (m.winner) {
        out.push(
          `**Winner:** ${
            m.winner === "tie" ? "Tie" : `Side ${m.winner.toUpperCase()}`
          }`
        );
        out.push("");
      }
    }
  }

  return out.join("\n");
}

export function promptPreview(text: string, max = 120): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export type ExportSessionOptions = {
  csvFilename: string;
  chatFilename: string;
  saveMetrics: boolean;
  saveChat: boolean;
  sessionNote: string;
  abQualityNote: string;
};

export function runSessionExport(opts: {
  metrics: QueryMetric[];
  messages: TranscriptMessage[];
  sessionId: string;
  exportOpts: ExportSessionOptions;
}): { csvName?: string; chatName?: string } {
  const result: { csvName?: string; chatName?: string } = {};
  const { exportOpts } = opts;

  if (exportOpts.saveMetrics && opts.metrics.length) {
    const csv = metricsToCsv(opts.metrics, {
      sessionNote: exportOpts.sessionNote,
      abQualityNote: exportOpts.abQualityNote,
    });
    const name = sanitizeFilename(
      exportOpts.csvFilename || defaultMetricsFilename(opts.sessionId),
      ".csv"
    );
    downloadCsv(name, csv);
    result.csvName = name;
  }

  if (exportOpts.saveChat && opts.messages.length) {
    const md = messagesToMarkdown(opts.messages, {
      sessionId: opts.sessionId,
      sessionNote: exportOpts.sessionNote,
      abQualityNote: exportOpts.abQualityNote,
    });
    const name = sanitizeFilename(
      exportOpts.chatFilename || defaultChatFilename(opts.sessionId),
      ".md"
    );
    downloadChatMarkdown(name, md);
    result.chatName = name;
  }

  return result;
}
