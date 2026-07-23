"use client";

import { useCallback, useEffect, useState } from "react";
import type { HostPublicStatus } from "@/lib/hostConfig";
import styles from "./HostStatusBar.module.css";

type Status = HostPublicStatus & { allowClientBaseUrl?: boolean };

export function HostStatusBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const json = (await res.json()) as Status;
      if (!res.ok) throw new Error("status failed");
      setStatus(json);
      setErr("");
    } catch {
      setErr("host status unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (err && !status) {
    return (
      <div className={`${styles.bar} ${styles.barMuted}`} title={err}>
        Host: unknown
      </div>
    );
  }

  if (!status) {
    return (
      <div className={`${styles.bar} ${styles.barMuted}`}>Host: …</div>
    );
  }

  const modeLabel = status.isServerMode ? "Server" : "Local";
  const cap = `${status.activeConnections}/${status.maxConnections}`;
  const title = [
    status.serverName,
    `mode=${status.mode}`,
    `connections=${cap}`,
    status.atCapacity ? "AT CAPACITY" : "slots available",
    `uptime=${status.uptimeSec}s`,
  ].join(" · ");

  return (
    <div
      className={`${styles.bar} ${
        status.isServerMode ? styles.barServer : styles.barLocal
      } ${status.atCapacity ? styles.barHot : ""}`}
      title={title}
    >
      <span className={styles.dot} />
      <span className={styles.mode}>{modeLabel}</span>
      <span className={styles.name}>{status.serverName}</span>
      <span className={styles.cap}>
        {status.atCapacity ? "full " : ""}
        {cap} active
      </span>
    </div>
  );
}
