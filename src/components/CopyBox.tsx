"use client";

import { useCallback, useState } from "react";
import { OutputPopout } from "@/components/OutputPopout";
import styles from "./CopyBox.module.css";

type Props = {
  text: string;
  /** Optional label above the box */
  label?: string;
  /** Hide box when empty (default false for A/B live panels) */
  hideIfEmpty?: boolean;
  /** Larger single-column output */
  large?: boolean;
  /** Still generating */
  streaming?: boolean;
  className?: string;
  placeholder?: string;
};

export function CopyBox({
  text,
  label = "Output",
  hideIfEmpty = false,
  large = false,
  streaming = false,
  className,
  placeholder = "Waiting for model output…",
}: Props) {
  const [copied, setCopied] = useState(false);
  const [popout, setPopout] = useState(false);
  const value = typeof text === "string" ? text : String(text ?? "");

  const onCopy = useCallback(async () => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        if (ta.parentNode) ta.parentNode.removeChild(ta);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [value]);

  if (hideIfEmpty && !value.trim() && !streaming) return null;

  return (
    <div
      className={`${styles.wrap} ${large ? styles.large : ""} ${className || ""}`}
    >
      <div className={styles.bar}>
        <span className={styles.label}>
          {label}
          {streaming ? (
            <span className={styles.live}> · streaming</span>
          ) : null}
        </span>
        <div className={styles.barActions}>
          <button
            type="button"
            className={styles.copyBtn}
            onClick={() => setPopout(true)}
            disabled={!value.trim() && !streaming}
            title="Pop out full-screen (text / markdown / HTML)"
          >
            Pop out
          </button>
          <button
            type="button"
            className={`${styles.copyBtn} ${copied ? styles.copied : ""}`}
            onClick={() => void onCopy()}
            disabled={!value.trim()}
            title="Copy this side’s output to clipboard"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        className={`${styles.box} ${!value.trim() ? styles.boxEmpty : ""}`}
        tabIndex={0}
      >
        {value.trim() ? value : placeholder}
      </pre>
      <OutputPopout
        open={popout}
        onClose={() => setPopout(false)}
        text={value}
        title={label}
        streaming={streaming}
      />
    </div>
  );
}
