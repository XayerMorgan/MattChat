/** Client-safe host / deployment mode types (no secrets). */

export type HostMode = "local" | "server";

export type HostPublicStatus = {
  ok: true;
  mode: HostMode;
  /** Friendly label for this host (e.g. "VPIT Mac Studio") */
  serverName: string;
  /** Max concurrent chat streams (and heavy work) */
  maxConnections: number;
  /** Currently held connection slots */
  activeConnections: number;
  /** How many free slots remain */
  availableConnections: number;
  /** True when this process is intended for multi-user LAN hosting */
  isServerMode: boolean;
  /** True when capacity is exhausted */
  atCapacity: boolean;
  /** Process uptime seconds */
  uptimeSec: number;
  version: string;
};

export type ConnectionKind = "chat" | "models" | "extract" | "other";

export type ConnectionSnapshot = {
  id: string;
  kind: ConnectionKind;
  startedAt: number;
  ageMs: number;
  clientId?: string;
  remote?: string;
  provider?: string;
  model?: string;
};

export type HostAdminStatus = HostPublicStatus & {
  connections: ConnectionSnapshot[];
  peakConnections: number;
  totalAccepted: number;
  totalRejected: number;
  totalReleased: number;
};
