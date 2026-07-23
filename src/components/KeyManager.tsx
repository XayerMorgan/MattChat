"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./KeyManager.module.css";

type KeySlotPublic = {
  id: string;
  name: string;
  description: string;
  needsKey: boolean;
  docsUrl?: string;
  placeholder?: string;
  defaultBaseUrl?: string;
  configured: boolean;
  source: "env" | "file" | "none" | "default";
  maskedKey: string;
  baseUrl: string;
  updatedAt?: string;
  label?: string;
};

type Draft = {
  apiKey: string;
  baseUrl: string;
  label: string;
};

export function KeyManager() {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<KeySlotPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load keys");
      const list = (json.slots || []) as KeySlotPublic[];
      setSlots(list);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const s of list) {
          if (!next[s.id]) {
            next[s.id] = {
              apiKey: "",
              baseUrl: s.baseUrl || s.defaultBaseUrl || "",
              label: s.label || "",
            };
          } else {
            // Keep typed secret; refresh base from server if draft empty
            if (!next[s.id].baseUrl) {
              next[s.id].baseUrl = s.baseUrl || s.defaultBaseUrl || "";
            }
          }
        }
        return next;
      });
    } catch (err) {
      setStatus({
        _: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({
      ...d,
      [id]: { ...(d[id] || { apiKey: "", baseUrl: "", label: "" }), ...patch },
    }));
  };

  const save = async (id: string, opts?: { clearKey?: boolean }) => {
    setBusyId(id);
    setStatus((s) => ({ ...s, [id]: "Saving…" }));
    try {
      const draft = drafts[id] || { apiKey: "", baseUrl: "", label: "" };
      const res = await fetch("/api/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          apiKey: opts?.clearKey ? undefined : draft.apiKey || undefined,
          clearKey: Boolean(opts?.clearKey),
          baseUrl: draft.baseUrl,
          label: draft.label,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setDrafts((d) => ({
        ...d,
        [id]: { ...d[id], apiKey: "" }, // never keep plaintext after save
      }));
      await load();
      setStatus((s) => ({ ...s, [id]: "Saved (stored server-side only)" }));
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBusyId(null);
    }
  };

  const test = async (id: string) => {
    setBusyId(id);
    setStatus((s) => ({ ...s, [id]: "Testing…" }));
    try {
      // Save first if user typed a new key so test uses it
      const draft = drafts[id];
      if (draft?.apiKey?.trim()) {
        await save(id);
      }
      const res = await fetch("/api/keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      setStatus((s) => ({
        ...s,
        [id]: json.ok
          ? `✓ ${json.message} (${json.latencyMs}ms)`
          : `✗ ${json.message || json.error}`,
      }));
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBusyId(null);
    }
  };

  const configuredCount = slots.filter((s) => s.configured).length;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.headerBtn}
        onClick={() => setOpen((v) => !v)}
      >
        <span>API keys</span>
        <span className={styles.badge}>
          {slots.length
            ? `${configuredCount}/${slots.length}`
            : "…"}
        </span>
        <span className={styles.chev}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          <p className={styles.intro}>
            Keys are stored in <code>config/api-keys.json</code> on this machine
            (gitignored). Env vars override file. Secrets never appear in full
            after save.
          </p>

          {loading && !slots.length && (
            <p className={styles.msg}>Loading…</p>
          )}
          {status._ && <p className={styles.err}>{status._}</p>}

          {slots.map((slot) => {
            const draft = drafts[slot.id] || {
              apiKey: "",
              baseUrl: "",
              label: "",
            };
            const busy = busyId === slot.id;

            return (
              <div key={slot.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <div className={styles.name}>{slot.name}</div>
                    <div className={styles.desc}>{slot.description}</div>
                  </div>
                  <span
                    className={`${styles.pill} ${
                      slot.configured ? styles.pillOk : styles.pillBad
                    }`}
                  >
                    {slot.source === "env"
                      ? "env"
                      : slot.source === "file"
                        ? "saved"
                        : slot.source === "default"
                          ? "local"
                          : "missing"}
                  </span>
                </div>

                {slot.maskedKey && (
                  <div className={styles.masked}>
                    Active: <code>{slot.maskedKey}</code>
                  </div>
                )}

                <label className={styles.label}>
                  API key
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      slot.maskedKey
                        ? "•••• leave blank to keep current"
                        : slot.placeholder || "paste key"
                    }
                    value={draft.apiKey}
                    onChange={(e) =>
                      setDraft(slot.id, { apiKey: e.target.value })
                    }
                    disabled={busy}
                  />
                </label>

                <label className={styles.label}>
                  Base URL
                  <input
                    type="text"
                    spellCheck={false}
                    placeholder={slot.defaultBaseUrl || "https://…/v1"}
                    value={draft.baseUrl}
                    onChange={(e) =>
                      setDraft(slot.id, { baseUrl: e.target.value })
                    }
                    disabled={busy}
                  />
                </label>

                <label className={styles.label}>
                  Label (optional)
                  <input
                    type="text"
                    placeholder="e.g. work key"
                    value={draft.label}
                    onChange={(e) =>
                      setDraft(slot.id, { label: e.target.value })
                    }
                    disabled={busy}
                  />
                </label>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => void save(slot.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => void test(slot.id)}
                  >
                    Test
                  </button>
                  {(slot.source === "file" || draft.apiKey) && (
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => void save(slot.id, { clearKey: true })}
                    >
                      Clear key
                    </button>
                  )}
                  {slot.docsUrl && (
                    <a
                      className={styles.link}
                      href={slot.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Docs
                    </a>
                  )}
                </div>

                {status[slot.id] && (
                  <p
                    className={
                      status[slot.id].startsWith("✓")
                        ? styles.ok
                        : status[slot.id].startsWith("✗")
                          ? styles.err
                          : styles.msg
                    }
                  >
                    {status[slot.id]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
