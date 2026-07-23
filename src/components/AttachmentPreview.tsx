"use client";

import type { AttachmentKind, PreparedAttachment } from "@/lib/attachments";
import { formatBytes } from "@/lib/attachments";
import styles from "./AttachmentPreview.module.css";

/** Lightweight snapshot kept on user messages after send */
export type AttachmentPreviewItem = {
  id: string;
  name: string;
  kind: AttachmentKind;
  size?: number;
  pages?: number;
  /** Image/video thumbnail data URL */
  dataUrl?: string;
  /** Short text excerpt for docs */
  textExcerpt?: string;
  error?: string;
};

export function preparedToPreview(
  a: PreparedAttachment
): AttachmentPreviewItem {
  const excerpt =
    a.text && a.kind !== "image" && a.kind !== "audio" && a.kind !== "video"
      ? a.text.replace(/\s+/g, " ").trim().slice(0, 160)
      : undefined;
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    size: a.size,
    pages: a.pages,
    dataUrl:
      a.kind === "image" || a.kind === "video" ? a.dataUrl : undefined,
    textExcerpt: excerpt,
    error: a.error,
  };
}

function kindIcon(kind: AttachmentKind): string {
  switch (kind) {
    case "image":
      return "🖼";
    case "pdf":
      return "📄";
    case "docx":
      return "📝";
    case "text":
      return "📃";
    case "audio":
      return "🎵";
    case "video":
      return "🎬";
    default:
      return "📎";
  }
}

type Props = {
  items: AttachmentPreviewItem[];
  /** Show remove buttons (composer) */
  onRemove?: (id: string) => void;
  compact?: boolean;
};

export function AttachmentPreviewList({ items, onRemove, compact }: Props) {
  if (!items.length) return null;

  return (
    <div className={`${styles.list} ${compact ? styles.listCompact : ""}`}>
      {items.map((a) => (
        <div
          key={a.id}
          className={`${styles.card} ${a.error ? styles.cardBad : ""}`}
          title={a.error || a.name}
        >
          <div className={styles.thumb}>
            {a.kind === "image" && a.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.dataUrl} alt={a.name} className={styles.thumbImg} />
            ) : a.kind === "video" && a.dataUrl ? (
              <video
                src={a.dataUrl}
                className={styles.thumbImg}
                muted
                playsInline
                preload="metadata"
              />
            ) : a.textExcerpt ? (
              <div className={styles.thumbDoc}>
                <span className={styles.thumbIcon}>{kindIcon(a.kind)}</span>
                <span className={styles.thumbExcerpt}>{a.textExcerpt}</span>
              </div>
            ) : (
              <div className={styles.thumbIconOnly}>{kindIcon(a.kind)}</div>
            )}
          </div>
          <div className={styles.meta}>
            <div className={styles.name}>{a.name}</div>
            <div className={styles.sub}>
              {a.kind}
              {a.pages ? ` · ${a.pages}p` : ""}
              {a.size != null ? ` · ${formatBytes(a.size)}` : ""}
              {a.error ? ` · ${a.error}` : ""}
            </div>
          </div>
          {onRemove && (
            <button
              type="button"
              className={styles.remove}
              onClick={() => onRemove(a.id)}
              aria-label={`Remove ${a.name}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
