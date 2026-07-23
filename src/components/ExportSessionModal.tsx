"use client";

import { useEffect, useMemo, useState } from "react";
import {
  defaultChatFilename,
  defaultMetricsFilename,
} from "@/lib/sessionMetrics";
import styles from "./ExportSessionModal.module.css";

export type ExportSessionModalProps = {
  open: boolean;
  mode: "export" | "clear";
  sessionId: string;
  metricsCount: number;
  messagesCount: number;
  hasAb: boolean;
  onCancel: () => void;
  onConfirm: (opts: {
    csvFilename: string;
    chatFilename: string;
    saveMetrics: boolean;
    saveChat: boolean;
    sessionNote: string;
    abQualityNote: string;
    clearAfter: boolean;
  }) => void;
};

export function ExportSessionModal({
  open,
  mode,
  sessionId,
  metricsCount,
  messagesCount,
  hasAb,
  onCancel,
  onConfirm,
}: ExportSessionModalProps) {
  const defaults = useMemo(
    () => ({
      csv: defaultMetricsFilename(sessionId),
      chat: defaultChatFilename(sessionId),
    }),
    [sessionId]
  );

  const [csvFilename, setCsvFilename] = useState(defaults.csv);
  const [chatFilename, setChatFilename] = useState(defaults.chat);
  const [saveMetrics, setSaveMetrics] = useState(metricsCount > 0);
  const [saveChat, setSaveChat] = useState(false);
  const [sessionNote, setSessionNote] = useState("");
  const [abQualityNote, setAbQualityNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setCsvFilename(defaults.csv);
    setChatFilename(defaults.chat);
    setSaveMetrics(metricsCount > 0);
    setSaveChat(mode === "export" ? messagesCount > 0 : messagesCount > 0);
    setSessionNote("");
    setAbQualityNote("");
  }, [open, defaults, metricsCount, messagesCount, mode]);

  if (!open) return null;

  const canSave =
    (saveMetrics && metricsCount > 0) || (saveChat && messagesCount > 0);
  const clearAfter = mode === "clear";

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "clear" ? "Export and clear session" : "Export session"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>
              {mode === "clear" ? "Export before clear" : "Export session"}
            </div>
            <div className={styles.sub}>
              {metricsCount} metric row{metricsCount === 1 ? "" : "s"} ·{" "}
              {messagesCount} message{messagesCount === 1 ? "" : "s"}
              {mode === "clear"
                ? " — downloads stay on your machine (not git)"
                : " — downloads only"}
            </div>
          </div>
          <button type="button" className={styles.ghost} onClick={onCancel}>
            Cancel
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={saveMetrics}
              disabled={metricsCount === 0}
              onChange={(e) => setSaveMetrics(e.target.checked)}
            />
            <span>
              Save metrics CSV
              {metricsCount === 0 ? " (none yet)" : ` (${metricsCount} queries)`}
            </span>
          </label>
          {saveMetrics && (
            <label className={styles.field}>
              CSV filename
              <input
                value={csvFilename}
                onChange={(e) => setCsvFilename(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={saveChat}
              disabled={messagesCount === 0}
              onChange={(e) => setSaveChat(e.target.checked)}
            />
            <span>
              Save full chat transcript (.md)
              {messagesCount === 0 ? " (empty)" : ""}
            </span>
          </label>
          {saveChat && (
            <label className={styles.field}>
              Chat filename
              <input
                value={chatFilename}
                onChange={(e) => setChatFilename(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}

          <label className={styles.field}>
            Session notes (optional)
            <textarea
              rows={2}
              value={sessionNote}
              onChange={(e) => setSessionNote(e.target.value)}
              placeholder="Overall notes for this session…"
            />
          </label>

          {(hasAb || abQualityNote) && (
            <label className={styles.field}>
              A/B quality comment (optional)
              <textarea
                rows={3}
                value={abQualityNote}
                onChange={(e) => setAbQualityNote(e.target.value)}
                placeholder="e.g. Side A was more accurate; B was faster but shallow…"
              />
            </label>
          )}

          {!hasAb && (
            <p className={styles.hint}>
              Tip: run A/B mode to compare two sources — you can still add an A/B
              quality note if you tested both.
            </p>
          )}

          {mode === "clear" && (
            <p className={styles.warn}>
              After export, the on-screen conversation and metrics will be
              cleared. Cancel keeps everything.
            </p>
          )}
        </div>

        <div className={styles.foot}>
          {mode === "clear" && (
            <button
              type="button"
              className={styles.ghost}
              onClick={() =>
                onConfirm({
                  csvFilename,
                  chatFilename,
                  saveMetrics: false,
                  saveChat: false,
                  sessionNote: "",
                  abQualityNote: "",
                  clearAfter: true,
                })
              }
            >
              Clear without saving
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={mode === "export" && !canSave}
            onClick={() =>
              onConfirm({
                csvFilename,
                chatFilename,
                saveMetrics: saveMetrics && metricsCount > 0,
                saveChat: saveChat && messagesCount > 0,
                sessionNote,
                abQualityNote,
                clearAfter,
              })
            }
          >
            {mode === "clear"
              ? canSave
                ? "Export & clear"
                : "Clear chats"
              : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
