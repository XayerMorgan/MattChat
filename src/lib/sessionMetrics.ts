/** Per-session query metrics → CSV (client-side download; not uploaded to git). */

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

export function metricsToCsv(rows: QueryMetric[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

export function defaultMetricsFilename(sessionId: string): string {
  const safe = (sessionId || "session").replace(/[^\w.-]+/g, "_");
  return `mattchat-${safe}.csv`;
}

/** Browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  let name = (filename || "").trim() || defaultMetricsFilename("session");
  if (!/\.csv$/i.test(name)) name += ".csv";
  // Strip path separators the user might type
  name = name.replace(/[/\\]/g, "-");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Prompt for a filename and download metrics.
 * Returns the name used, or null if cancelled / nothing to save.
 */
export function promptAndDownloadMetrics(
  rows: QueryMetric[],
  sessionId: string
): string | null {
  if (!rows.length) return null;
  const suggested = defaultMetricsFilename(sessionId);
  const entered = window.prompt(
    `Name the session metrics CSV file (${rows.length} quer${rows.length === 1 ? "y" : "ies"}):\n\nSaved only to your downloads folder — not uploaded to git.`,
    suggested
  );
  if (entered == null) return null; // cancel
  const name = entered.trim() || suggested;
  downloadCsv(name, metricsToCsv(rows));
  return name;
}

export function promptPreview(text: string, max = 120): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
