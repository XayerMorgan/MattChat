/**
 * Omnimodal attachments for MattChat.
 * Text-like files are extracted server-side; images/audio go as multimodal parts.
 */

export type AttachmentKind =
  | "text"
  | "pdf"
  | "docx"
  | "image"
  | "audio"
  | "video"
  | "unknown";

export type PreparedAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Extracted plain text (docs / pdf / text) */
  text?: string;
  /** data:...;base64,... for vision / audio / video parts */
  dataUrl?: string;
  /** Raw base64 (no data: prefix) for input_audio */
  base64?: string;
  /** Audio format for OpenAI-style input_audio: wav | mp3 */
  audioFormat?: string;
  pages?: number;
  truncated?: boolean;
  error?: string;
};

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|log|rtf|tex|yml|yaml|ini|cfg|env)$/i;
const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.docx$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi|mkv)$/i;

export function classifyFile(file: File): AttachmentKind {
  const name = file.name || "";
  const mime = (file.type || "").toLowerCase();
  if (mime === "application/pdf" || PDF_EXT.test(name)) return "pdf";
  if (
    mime.includes("wordprocessingml") ||
    mime === "application/msword" ||
    DOCX_EXT.test(name)
  )
    return "docx";
  if (mime.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (mime.startsWith("audio/") || AUDIO_EXT.test(name)) return "audio";
  if (mime.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  if (
    mime.startsWith("text/") ||
    TEXT_EXT.test(name) ||
    mime === "application/json"
  )
    return "text";
  return "unknown";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_TEXT_CHARS = 120_000;
/** Keep media payloads bounded for local Metal + API limits */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export function truncateText(
  text: string,
  max = MAX_TEXT_CHARS
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return {
    text:
      text.slice(0, max) +
      `\n\n[… truncated for context window; ${text.length - max} characters omitted]`,
    truncated: true,
  };
}

export function audioFormatFromFile(file: File): string {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.includes("wav") || name.endsWith(".wav")) return "wav";
  if (mime.includes("mp3") || name.endsWith(".mp3")) return "mp3";
  if (mime.includes("m4a") || name.endsWith(".m4a")) return "wav"; // best-effort
  if (name.endsWith(".flac")) return "wav";
  return "mp3";
}

export function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/**
 * Which modalities MattChat can usefully send for each provider family.
 * "partial" = attach works but model/server support varies.
 */
export const MODALITY_SUPPORT: Record<
  string,
  { text: boolean; image: boolean; audio: string; video: string; note: string }
> = {
  lmstudio: {
    text: true,
    image: true,
    audio: "partial",
    video: "no",
    note: "Local VLMs (e.g. Qwen VLM) handle text + images. Native audio/video usually needs a cloud omni model or separate ASR.",
  },
  xai: {
    text: true,
    image: true,
    audio: "partial",
    video: "partial",
    note: "Grok vision is solid for images. Audio/video depend on the specific Grok multimodal SKU / API surface.",
  },
  openai: {
    text: true,
    image: true,
    audio: "yes",
    video: "partial",
    note: "GPT-4o-class models: images + input_audio. Video is not a first-class chat input on standard Completions.",
  },
  gemini: {
    text: true,
    image: true,
    audio: "yes",
    video: "yes",
    note: "Gemini is the strongest omni option here (text, image, audio, video) via Google’s multimodal stack.",
  },
  custom: {
    text: true,
    image: true,
    audio: "partial",
    video: "partial",
    note: "Depends entirely on the upstream server and model.",
  },
};

/** Build the user-visible + model-facing prompt body for attachments. */
export function buildAttachmentContext(
  attachments: PreparedAttachment[]
): string {
  if (!attachments.length) return "";
  const blocks: string[] = [];
  for (const a of attachments) {
    if (a.error) {
      blocks.push(`### Attachment: ${a.name}\n[Failed to load: ${a.error}]`);
      continue;
    }
    if (a.kind === "image") {
      blocks.push(
        `### Image attachment: ${a.name} (${formatBytes(a.size)}, ${a.mime})\n[Image attached for vision analysis]`
      );
      continue;
    }
    if (a.kind === "audio") {
      blocks.push(
        `### Audio attachment: ${a.name} (${formatBytes(a.size)}, ${a.mime})\n[Audio attached for multimodal analysis — use a model that supports audio input]`
      );
      continue;
    }
    if (a.kind === "video") {
      blocks.push(
        `### Video attachment: ${a.name} (${formatBytes(a.size)}, ${a.mime})\n[Video attached — best with Gemini / native omni models; local VLMs may ignore video bytes]`
      );
      continue;
    }
    if (a.text) {
      const pageNote = a.pages ? ` · ${a.pages} page(s)` : "";
      const trunc = a.truncated ? " · truncated" : "";
      blocks.push(
        `### Document: ${a.name} (${a.kind}${pageNote}${trunc} · ${formatBytes(a.size)})\n\n${a.text}`
      );
    }
  }
  return blocks.join("\n\n---\n\n");
}
