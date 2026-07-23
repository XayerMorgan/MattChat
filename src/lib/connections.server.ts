import "server-only";

import { getHostConfig } from "@/lib/host.server";
import type {
  ConnectionKind,
  ConnectionSnapshot,
  HostAdminStatus,
  HostPublicStatus,
} from "@/lib/hostConfig";

export type AcquireInfo = {
  kind: ConnectionKind;
  clientId?: string;
  remote?: string;
  provider?: string;
  model?: string;
};

type Slot = {
  id: string;
  kind: ConnectionKind;
  startedAt: number;
  clientId?: string;
  remote?: string;
  provider?: string;
  model?: string;
};

/**
 * In-process concurrent connection registry.
 * Suitable for a single Node process on a Mac Studio (npm start / next start).
 * Not shared across multiple Node workers/instances — use one process for now.
 */
class ConnectionManager {
  private active = new Map<string, Slot>();
  private peak = 0;
  private totalAccepted = 0;
  private totalRejected = 0;
  private totalReleased = 0;
  private readonly startedAt = Date.now();
  private seq = 0;

  private max(): number {
    return getHostConfig().maxConnections;
  }

  stats(): {
    active: number;
    max: number;
    available: number;
    peak: number;
  } {
    const max = this.max();
    const active = this.active.size;
    return {
      active,
      max,
      available: Math.max(0, max - active),
      peak: this.peak,
    };
  }

  tryAcquire(
    info: AcquireInfo
  ):
    | { ok: true; id: string; active: number; max: number }
    | {
        ok: false;
        reason: string;
        active: number;
        max: number;
        retryAfterSec: number;
      } {
    const max = this.max();
    // Light ops (models list) use a soft limit: allow up to max even if chat is busy,
    // but still refuse if way over (2x) to protect the host.
    const softCeiling =
      info.kind === "models" || info.kind === "other"
        ? Math.max(max, Math.floor(max * 1.25))
        : max;

    if (this.active.size >= softCeiling) {
      this.totalRejected += 1;
      return {
        ok: false,
        reason: `Server at capacity (${this.active.size}/${max} connections). Try again in a moment.`,
        active: this.active.size,
        max,
        retryAfterSec: 5,
      };
    }

    this.seq += 1;
    const id = `c${Date.now().toString(36)}-${this.seq.toString(36)}`;
    this.active.set(id, {
      id,
      kind: info.kind,
      startedAt: Date.now(),
      clientId: info.clientId?.slice(0, 64),
      remote: info.remote?.slice(0, 128),
      provider: info.provider?.slice(0, 32),
      model: info.model?.slice(0, 128),
    });
    this.totalAccepted += 1;
    if (this.active.size > this.peak) this.peak = this.active.size;

    return { ok: true, id, active: this.active.size, max };
  }

  release(id: string | undefined | null): void {
    if (!id) return;
    if (this.active.delete(id)) {
      this.totalReleased += 1;
    }
  }

  /** Drop slots older than maxAgeMs (stuck streams). */
  reap(maxAgeMs = 10 * 60 * 1000): number {
    const now = Date.now();
    let n = 0;
    for (const [id, slot] of this.active) {
      if (now - slot.startedAt > maxAgeMs) {
        this.active.delete(id);
        this.totalReleased += 1;
        n += 1;
      }
    }
    return n;
  }

  list(): ConnectionSnapshot[] {
    const now = Date.now();
    return [...this.active.values()]
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        startedAt: s.startedAt,
        ageMs: now - s.startedAt,
        clientId: s.clientId,
        remote: s.remote,
        provider: s.provider,
        model: s.model,
      }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  publicStatus(): HostPublicStatus {
    this.reap();
    const cfg = getHostConfig();
    const { active, max, available } = this.stats();
    return {
      ok: true,
      mode: cfg.mode,
      serverName: cfg.serverName,
      maxConnections: max,
      activeConnections: active,
      availableConnections: available,
      isServerMode: cfg.mode === "server",
      atCapacity: available <= 0,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      version: "0.1.0",
    };
  }

  adminStatus(): HostAdminStatus {
    const pub = this.publicStatus();
    return {
      ...pub,
      connections: this.list(),
      peakConnections: this.peak,
      totalAccepted: this.totalAccepted,
      totalRejected: this.totalRejected,
      totalReleased: this.totalReleased,
    };
  }
}

/** Singleton per Node process */
const globalForConnections = globalThis as unknown as {
  __mattchatConnections?: ConnectionManager;
};

export const connectionManager: ConnectionManager =
  globalForConnections.__mattchatConnections ||
  (globalForConnections.__mattchatConnections = new ConnectionManager());

export function clientMetaFromRequest(request: Request): {
  clientId?: string;
  remote?: string;
} {
  const clientId =
    request.headers.get("x-mattchat-client-id") ||
    request.headers.get("x-client-id") ||
    undefined;
  const remote =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined;
  return { clientId: clientId || undefined, remote };
}

export function capacityResponse(opts: {
  active: number;
  max: number;
  reason: string;
  retryAfterSec?: number;
}): Response {
  const retry = opts.retryAfterSec ?? 5;
  return new Response(
    JSON.stringify({
      ok: false,
      error: opts.reason,
      code: "CAPACITY",
      activeConnections: opts.active,
      maxConnections: opts.max,
      retryAfterSec: retry,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retry),
        "X-MattChat-Active": String(opts.active),
        "X-MattChat-Max": String(opts.max),
      },
    }
  );
}
