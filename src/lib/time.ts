/** Clinical-style timing helpers (local timezone, high precision). */

export function nowIso(): string {
  return new Date().toISOString();
}

/** Wall clock with milliseconds, in the browser's local timezone. */
export function formatClinicalTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const tz =
    Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value || "";

  return `${date} ${time}.${ms} ${tz}`.trim();
}

export function formatDurationMs(ms?: number | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(3)} s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(3);
  return `${m}m ${s}s`;
}

export function durationBetween(startIso?: string, endIso?: string): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, b - a);
}

export type TimingStamp = {
  startIso: string;
  endIso?: string;
  durationMs?: number;
  ttftMs?: number | null;
  answerTtftMs?: number | null;
};
