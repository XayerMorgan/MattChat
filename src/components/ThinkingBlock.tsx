"use client";

import { useEffect, useState } from "react";
import styles from "./ThinkingBlock.module.css";

type Props = {
  thinking: string;
  /** While the model is still streaming thinking tokens */
  active?: boolean;
  /** Default open when true (e.g. while streaming) */
  defaultOpen?: boolean;
};

export function ThinkingBlock({ thinking, active, defaultOpen }: Props) {
  const [open, setOpen] = useState(Boolean(defaultOpen || active));

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  if (!thinking && !active) return null;

  return (
    <div className={`${styles.wrap} ${active ? styles.active : ""}`}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.icon}>{active ? "◉" : "◎"}</span>
        <span className={styles.title}>
          {active ? "Thinking…" : "Thinking"}
        </span>
        <span className={styles.meta}>
          {thinking ? `${thinking.length.toLocaleString()} chars` : "—"}
        </span>
        <span className={styles.chev}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className={styles.body}>{thinking || (active ? "…" : "")}</pre>
      )}
    </div>
  );
}
