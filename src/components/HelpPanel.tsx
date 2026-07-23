"use client";

import {
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import {
  APP_BRAND,
  appBuiltByLabel,
  appVersionLabel,
} from "@/lib/appMeta";
import styles from "./HelpPanel.module.css";

export type HelpSectionId =
  | "start"
  | "modes"
  | "sources"
  | "speed"
  | "files"
  | "output"
  | "export"
  | "name"
  | "tips";

type Section = {
  id: HelpSectionId;
  icon: string;
  title: string;
  teaser: string;
  accent: "blue" | "purple" | "green" | "amber" | "cyan" | "rose";
  body: ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "start",
    icon: "🚀",
    title: "Getting started",
    teaser: "Keys → Scan → Send",
    accent: "blue",
    body: (
      <ol className={styles.steps}>
        <li>
          <strong>API keys</strong> — open the top bar{" "}
          <em>API keys</em> panel. Paste Grok / OpenAI / Gemini keys, or set
          your LM Studio base URL (e.g.{" "}
          <code>http://host:1234/v1</code>).
        </li>
        <li>
          <strong>Source A</strong> — pick a provider and model in the left
          sidebar. For LM Studio, leave model empty to use whatever is already
          loaded, then click <em>Scan</em>.
        </li>
        <li>
          <strong>Send</strong> — type a prompt and hit Send. Green{" "}
          <em>Ready / Connected</em> means you are good to go.
        </li>
      </ol>
    ),
  },
  {
    id: "modes",
    icon: "⚖️",
    title: "Single vs A/B",
    teaser: "One chat or side-by-side compare",
    accent: "purple",
    body: (
      <>
        <p>
          <strong>Single</strong> — one conversation with Source A. One large
          output box with Copy.
        </p>
        <p>
          <strong>A/B Test</strong> — Source A and Source B run the same prompt
          in parallel. Two columns: each side has its own output box, timings,
          and Winner / Tie buttons.
        </p>
        <ul>
          <li>Left column = Side A · right column = Side B</li>
          <li>Pick a winner to log quality feedback</li>
          <li>Export can include an A/B quality comment</li>
        </ul>
      </>
    ),
  },
  {
    id: "sources",
    icon: "🔌",
    title: "Sources & models",
    teaser: "LM Studio + cloud APIs",
    accent: "cyan",
    body: (
      <>
        <p>
          Each source has a <strong>provider</strong>, optional{" "}
          <strong>base URL</strong>, <strong>model</strong>, and{" "}
          <strong>personality</strong>.
        </p>
        <ul>
          <li>
            <strong>Scan models</strong> refreshes the live catalog (safe to
            retry after errors).
          </li>
          <li>
            LM Studio prefers the <em>already loaded</em> model so chat does
            not force a second load.
          </li>
          <li>
            Personalities rewrite the system prompt (concise, helpful, random,
            etc.).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "speed",
    icon: "⚡",
    title: "Fast vs Thinking",
    teaser: "Seconds vs deep CoT",
    accent: "amber",
    body: (
      <>
        <p>
          <strong>Fast</strong> — no chain-of-thought, shorter max tokens.
          Best for chat and A/B smoke tests on Metal.
        </p>
        <p>
          <strong>Thinking</strong> — full reasoning when the model supports
          it. Can take minutes on long problems.
        </p>
        <p className={styles.tip}>
          Tip: for local LM Studio chat, keep context at 8k–32k, not 200k.
        </p>
      </>
    ),
  },
  {
    id: "files",
    icon: "📎",
    title: "Attachments",
    teaser: "PDF, DOCX, images, audio, video",
    accent: "green",
    body: (
      <>
        <p>
          Use the paperclip in the composer to attach files. Previews show as
          thumbnails in the prompt bubble.
        </p>
        <ul>
          <li>
            <strong>Images</strong> — VLMs (Qwen VLM, Grok vision, OpenAI,
            Gemini)
          </li>
          <li>
            <strong>Audio / video</strong> — best on Gemini (and some OpenAI
            paths); local LM Studio often needs a separate ASR pipeline
          </li>
          <li>
            Text PDFs / DOCX are extracted server-side into prompt context
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "output",
    icon: "📋",
    title: "Output & copy",
    teaser: "One box per reply side",
    accent: "blue",
    body: (
      <>
        <p>
          Model answers appear in an <strong>Output</strong> box with a{" "}
          <em>Copy</em> button. Streaming shows live text as tokens arrive.
        </p>
        <ul>
          <li>
            <strong>Single</strong> — one large full-width output box
          </li>
          <li>
            <strong>A/B</strong> — Side A output under A, Side B under B
          </li>
        </ul>
        <p>
          Clinical timing (start / finish / TTFT) sits with each reply for
          lab-style comparisons.
        </p>
      </>
    ),
  },
  {
    id: "export",
    icon: "📊",
    title: "Export & clear",
    teaser: "CSV metrics + chat transcript",
    accent: "rose",
    body: (
      <>
        <p>
          <strong>Export</strong> saves session metrics (CSV) and/or the full
          chat as Markdown, with optional session notes and A/B quality
          comments.
        </p>
        <p>
          <strong>Clear all chats</strong> can export first, then wipe the
          conversation, winner history, and in-memory metrics for a fresh run.
        </p>
      </>
    ),
  },
  {
    id: "name",
    icon: "✏️",
    title: "Client name",
    teaser: "Rename this install",
    accent: "purple",
    body: (
      <>
        <p>
          The app title defaults to <strong>MattChat</strong>. Click the name
          in the left sidebar (or use the field below when Help is open from
          settings) to rename this client — useful when several lab machines
          share a host.
        </p>
        <p className={styles.tip}>
          Your name is stored only in this browser&apos;s local storage.
        </p>
      </>
    ),
  },
  {
    id: "tips",
    icon: "💡",
    title: "Lab tips",
    teaser: "Shared host & multi-client",
    accent: "cyan",
    body: (
      <>
        <ul>
          <li>
            Each person can run their own client on{" "}
            <code>localhost:3010</code> pointing at a shared LM Studio URL.
          </li>
          <li>
            Or run one shared MattChat server (
            <code>MATTCHAT_HOST_MODE=server</code>) — see{" "}
            <code>docs/SERVER.md</code> in the repo.
          </li>
          <li>
            Keys live in gitignored <code>config/api-keys.json</code> or env —
            never commit secrets.
          </li>
          <li>
            Hard refresh (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) after
            updates if the UI looks stale.
          </li>
        </ul>
      </>
    ),
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  clientName: string;
  onClientNameChange: (name: string) => void;
};

export function HelpPanel({
  open,
  onClose,
  clientName,
  onClientNameChange,
}: Props) {
  const titleId = useId();
  const [active, setActive] = useState<HelpSectionId>("start");
  const [draftName, setDraftName] = useState(clientName);

  useEffect(() => {
    if (open) {
      setDraftName(clientName);
      setActive("start");
    }
  }, [open, clientName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const section = SECTIONS.find((s) => s.id === active) || SECTIONS[0];

  const applyName = () => {
    const next = draftName.trim() || "MattChat";
    onClientNameChange(next);
    setDraftName(next);
  };

  return (
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
          <div className={styles.headerBrand}>
            <span className={styles.headerGlyph} aria-hidden>
              ?
            </span>
            <div>
              <h2 id={titleId}>Help &amp; features</h2>
              <p>
                {clientName || APP_BRAND} · {APP_BRAND} {appVersionLabel()} ·{" "}
                {appBuiltByLabel()}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close help"
          >
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <nav className={styles.nav} aria-label="Help topics">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`${styles.navItem} ${styles[`accent_${s.accent}`]} ${
                  active === s.id ? styles.navItemActive : ""
                }`}
                onClick={() => setActive(s.id)}
              >
                <span className={styles.navIcon} aria-hidden>
                  {s.icon}
                </span>
                <span className={styles.navText}>
                  <span className={styles.navTitle}>{s.title}</span>
                  <span className={styles.navTeaser}>{s.teaser}</span>
                </span>
              </button>
            ))}
          </nav>

          <article
            className={`${styles.content} ${styles[`content_${section.accent}`]}`}
          >
            <div className={styles.contentHero}>
              <span className={styles.contentIcon} aria-hidden>
                {section.icon}
              </span>
              <div>
                <h3>{section.title}</h3>
                <p className={styles.contentTeaser}>{section.teaser}</p>
              </div>
            </div>
            <div className={styles.contentBody}>{section.body}</div>

            {section.id === "name" && (
              <div className={styles.nameEditor}>
                <label htmlFor="help-client-name">Client display name</label>
                <div className={styles.nameRow}>
                  <input
                    id="help-client-name"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyName();
                    }}
                    placeholder="MattChat"
                    maxLength={48}
                    spellCheck={false}
                  />
                  <button type="button" onClick={applyName}>
                    Save name
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.resetName}
                  onClick={() => {
                    setDraftName("MattChat");
                    onClientNameChange("MattChat");
                  }}
                >
                  Reset to MattChat
                </button>
              </div>
            )}
          </article>
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerHints}>
            <span>
              <kbd>?</kbd> open help
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
            <span className={styles.footerBrand}>
              {APP_BRAND} {appVersionLabel()} · {appBuiltByLabel()}
            </span>
          </div>
          <button type="button" className={styles.doneBtn} onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}

/** High-visibility Help control for the top-right actions. */
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.helpBtn}
      onClick={onClick}
      title="Help & features"
      aria-label="Open help and features"
    >
      <span className={styles.helpBtnGlow} aria-hidden />
      <span className={styles.helpBtnIcon} aria-hidden>
        ?
      </span>
      <span className={styles.helpBtnLabel}>Help</span>
    </button>
  );
}
