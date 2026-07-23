import "server-only";

import type { HostMode } from "@/lib/hostConfig";

export type HostServerConfig = {
  mode: HostMode;
  serverName: string;
  maxConnections: number;
  /** Optional bearer token for /api/admin/* */
  adminToken: string;
  /** When true, clients may override Base URL; when false in server mode, prefer env LM URL */
  allowClientBaseUrl: boolean;
};

function parseMode(raw: string | undefined): HostMode {
  const v = (raw || "local").trim().toLowerCase();
  if (v === "server" || v === "shared" || v === "host") return "server";
  return "local";
}

/**
 * Deployment mode for this Node process.
 * - local  — single-user laptop default
 * - server — multi-user Mac Studio / LAN host
 */
export function getHostConfig(): HostServerConfig {
  const mode = parseMode(process.env.MATTCHAT_HOST_MODE);
  const maxRaw = Number(process.env.MATTCHAT_MAX_CONNECTIONS || "");
  // Local: generous default (personal use). Server: 100 concurrent by default.
  const maxConnections =
    Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.floor(maxRaw)
      : mode === "server"
        ? 100
        : 32;

  const allowOverride = process.env.MATTCHAT_ALLOW_CLIENT_BASE_URL;
  const allowClientBaseUrl =
    allowOverride === undefined
      ? true
      : !/^(0|false|no|off)$/i.test(allowOverride);

  return {
    mode,
    serverName:
      (process.env.MATTCHAT_SERVER_NAME || "").trim() ||
      (mode === "server" ? "MattChat Server" : "MattChat Local"),
    maxConnections: Math.min(Math.max(maxConnections, 1), 500),
    adminToken: (process.env.MATTCHAT_ADMIN_TOKEN || "").trim(),
    allowClientBaseUrl,
  };
}

export function isServerHostMode(): boolean {
  return getHostConfig().mode === "server";
}
