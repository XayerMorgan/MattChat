"use client";

import { useCallback, useState } from "react";
import styles from "./CopyBox.module.css";

type Props = {
  text: string;
  /** Optional label above the box */
  label?: string;
  /** Hide box when empty */
  hideIfEmpty?: boolean;
  className?: string;
};

export function CopyBox({
  text,
  label = "Output",
  hideIfEmpty = true,
  className,
}: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const value = text || "";
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for older browsers / insecure contexts
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        ta.remove();
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  if (hideIfEmpty && !text?.trim()) return null;

  return (
    <div className={`${styles.wrap} ${className || ""}`}>
      <div className={styles.bar}>
        <span className={styles.label}>{label}</span>
        <button
          type="button"
          className={`${styles.copyBtn} ${copied ? styles.copied : ""}`}
          onClick={() => void onCopy()}
          disabled={!text?.trim()}
          title="Copy output text to clipboard"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={styles.box} tabIndex={0}>
        {text}
      </pre>
    </div>
  );
}
