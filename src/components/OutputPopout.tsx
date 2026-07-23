"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { markdownToHtml, sanitizeHtml } from "@/lib/simpleMarkdown";
import styles from "./OutputPopout.module.css";

export type RenderMode = "text" | "markdown" | "html";

type Props = {
  open: boolean;
  onClose: () => void;
  text: string;
  title?: string;
  streaming?: boolean;
};

const MODES: { id: RenderMode; label: string; hint: string }[] = [
  { id: "text", label: "Text", hint: "Plain monospace" },
  { id: "markdown", label: "Markdown", hint: "Headings, lists, tables" },
  { id: "html", label: "HTML", hint: "Render as HTML (sandboxed)" },
];

export function OutputPopout({
  open,
  onClose,
  text,
  title = "Output",
  streaming = false,
}: Props) {
  const titleId = useId();
  const [mode, setMode] = useState<RenderMode>("markdown");
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  /** Debounced body text so streaming does not thrash markdown DOM every token */
  const [renderText, setRenderText] = useState("");
  const mdRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const value = typeof text === "string" ? text : String(text ?? "");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Debounce content into the preview while streaming; snap immediately when idle
  useEffect(() => {
    if (!open) return;
    if (!streaming) {
      setRenderText(value);
      return;
    }
    const t = window.setTimeout(() => setRenderText(value), 180);
    return () => window.clearTimeout(t);
  }, [open, value, streaming]);

  useEffect(() => {
    if (open) setRenderText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only snap when opening
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

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

  const mdHtml = useMemo(() => {
    if (mode !== "markdown") return "";
    try {
      return sanitizeHtml(markdownToHtml(renderText));
    } catch {
      return `<pre>${escapePlain(renderText)}</pre>`;
    }
  }, [mode, renderText]);

  const srcDoc = useMemo(() => {
    if (mode !== "html") return "";
    const body = sanitizeHtml(renderText.trim()) || "<p style='opacity:.5'>Empty</p>";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;padding:1.25rem 1.5rem;background:#0e131d;color:#eef2f8;
  font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;}
  a{color:#7aa2ff} pre,code{font-family:ui-monospace,Menlo,monospace}
  pre{background:#0a0d14;padding:0.75rem;border-radius:8px;overflow:auto}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #273044;padding:0.4rem 0.55rem}
  th{background:#131822}
  img{max-width:100%}
</style></head><body>${body}</body></html>`;
  }, [mode, renderText]);

  // Write markdown HTML outside React's reconciler (avoids removeChild races)
  useEffect(() => {
    if (!open || mode !== "markdown") return;
    const el = mdRef.current;
    if (!el) return;
    el.innerHTML = mdHtml || '<p class="empty">No output yet</p>';
  }, [open, mode, mdHtml]);

  // Update iframe via srcdoc only when HTML mode is active
  useEffect(() => {
    if (!open || mode !== "html") return;
    const frame = iframeRef.current;
    if (!frame) return;
    // Assigning srcdoc is safer than re-mount thrash during stream
    frame.srcdoc = srcDoc;
  }, [open, mode, srcDoc]);

  if (!open || !mounted || typeof document === "undefined") return null;

  const panel = (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 id={titleId}>{title}</h2>
            {streaming ? (
              <span className={styles.live}>Streaming…</span>
            ) : (
              <span className={styles.meta}>
                {value.length.toLocaleString()} chars
              </span>
            )}
          </div>

          <div className={styles.modes} role="tablist" aria-label="Render mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`${styles.modeBtn} ${
                  mode === m.id ? styles.modeBtnActive : ""
                }`}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.actionBtn} ${copied ? styles.copied : ""}`}
              onClick={() => void onCopy()}
              disabled={!value.trim()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close pop-out"
            >
              ✕
            </button>
          </div>
        </header>

        <div className={styles.body}>
          {mode === "text" ? (
            <pre className={styles.textView}>
              {renderText.trim() ? renderText : "No output yet"}
            </pre>
          ) : null}
          {mode === "markdown" ? (
            <div
              ref={mdRef}
              className={styles.mdView}
              // Children managed via ref.innerHTML — keep empty for React
            />
          ) : null}
          {mode === "html" ? (
            <iframe
              ref={iframeRef}
              className={styles.htmlFrame}
              title={`${title} HTML preview`}
              sandbox=""
              // srcdoc set in effect to avoid React iframe reconcile bugs
            />
          ) : null}
        </div>

        <footer className={styles.footer}>
          <span>
            Render: <strong>{mode}</strong>
            {mode === "html" ? " · sandboxed (scripts blocked)" : ""}
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

function escapePlain(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
