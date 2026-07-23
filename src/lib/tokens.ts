/**
 * Token helpers for live generation UI and estimates when the provider
 * has not yet returned usage.
 */

/** Rough token estimate from text (good enough for “alive” counters). */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  const s = text.trim();
  if (!s) return 0;
  // ~4 chars/token for English; floor at word-based estimate for short strings
  const byChars = Math.ceil(s.length / 4);
  const words = s.split(/\s+/).filter(Boolean).length;
  const byWords = Math.ceil(words * 1.3);
  return Math.max(1, byChars, byWords > 0 ? byWords : 0);
}

export function formatTokenCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(2)}M`;
}

export function formatTokPerSec(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return "—";
  if (tps < 10) return `${tps.toFixed(1)} tok/s`;
  if (tps < 100) return `${tps.toFixed(0)} tok/s`;
  return `${Math.round(tps)} tok/s`;
}

export function tokensPerSecond(
  tokenCount: number,
  elapsedMs: number
): number {
  if (tokenCount <= 0 || elapsedMs <= 0) return 0;
  return (tokenCount / elapsedMs) * 1000;
}
