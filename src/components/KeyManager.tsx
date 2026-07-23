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
  dirty?: boolean;
};

type StorageInfo = {
  relativePath: string;
  exists: boolean;
  updatedAt?: string;
  gitignored: boolean;
  note: string;
};

export function KeyManager() {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<KeySlotPublic[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [globalMsg, setGlobalMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load config");
      const list = (json.slots || []) as KeySlotPublic[];
      setSlots(list);
      if (json.storage) setStorage(json.storage as StorageInfo);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const s of list) {
          const keepDirty = next[s.id]?.dirty && next[s.id]?.apiKey;
          if (!next[s.id] || !keepDirty) {
            next[s.id] = {
              apiKey: "",
              baseUrl: s.baseUrl || s.defaultBaseUrl || "",
              label: s.label || "",
              dirty: false,
            };
          } else if (!next[s.id].baseUrl) {
            next[s.id] = {
              ...next[s.id],
              baseUrl: s.baseUrl || s.defaultBaseUrl || "",
            };
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

  // Badge count even when collapsed
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({
      ...d,
      [id]: {
        ...(d[id] || { apiKey: "", baseUrl: "", label: "", dirty: false }),
        ...patch,
        dirty: true,
      },
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
        [id]: {
          apiKey: "",
          baseUrl: d[id]?.baseUrl || "",
          label: d[id]?.label || "",
          dirty: false,
        },
      }));
      await load();
      setStatus((s) => ({
        ...s,
        [id]: opts?.clearKey
          ? "Key cleared (file updated)"
          : "Saved on this machine (gitignored)",
      }));
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [id]: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const saveAll = async () => {
    setGlobalMsg("Saving all providers…");
    const ids = Object.keys(drafts).filter(
      (id) =>
        drafts[id]?.dirty ||
        drafts[id]?.apiKey?.trim() ||
        drafts[id]?.baseUrl?.trim()
    );
    if (!ids.length) {
      // Still persist current base URLs for all visible slots
      for (const s of slots) {
        try {
          await save(s.id);
        } catch {
          /* per-slot status set */
        }
      }
      setGlobalMsg("Saved current fields for all providers.");
      return;
    }
    let ok = 0;
    for (const id of ids.length ? ids : slots.map((s) => s.id)) {
      try {
        await save(id);
        ok += 1;
      } catch {
        /* continue */
      }
    }
    setGlobalMsg(`Saved ${ok} provider(s) to ${storage?.relativePath || "config/api-keys.json"}.`);
  };

  const test = async (id: string) => {
    setBusyId(id);
    setStatus((s) => ({ ...s, [id]: "Testing…" }));
    try {
      const draft = drafts[id];
      if (draft?.apiKey?.trim() || draft?.dirty) {
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
  const dirtyCount = Object.values(drafts).filter((d) => d.dirty).length;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.headerBtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>API &amp; config</span>
        <span className={styles.badge}>
          {slots.length ? `${configuredCount}/${slots.length}` : "…"}
          {dirtyCount > 0 ? ` · ${dirtyCount} unsaved` : ""}
        </span>
        <span className={styles.chev}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.intro}>
            <p>
              Manage provider API keys and base URLs. Values are saved on{" "}
              <strong>this machine only</strong> and are{" "}
              <strong>gitignored</strong> — they never go to GitHub.
            </p>
            <p className={styles.storeLine}>
              Store:{" "}
              <code>{storage?.relativePath || "config/api-keys.json"}</code>
              {storage?.exists
                ? storage.updatedAt
                  ? ` · updated ${new Date(storage.updatedAt).toLocaleString()}`
                  : " · present"
                : " · not created yet (save once)"}
            </p>
            <p className={styles.storeLine}>
              Priority: <code>.env.local</code> (if set) overrides the file.
              Env files are also gitignored.
            </p>
          </div>

          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.primary}
              disabled={loading || busyId !== null}
              onClick={() => void saveAll()}
            >
              Save all
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={loading || busyId !== null}
              onClick={() => void load()}
            >
              Reload
            </button>
          </div>
          {globalMsg && <p className={styles.msg}>{globalMsg}</p>}

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
              <div
                key={slot.id}
                className={`${styles.card} ${draft.dirty ? styles.cardDirty : ""}`}
              >
                <div className={styles.cardHead}>
                  <div>
                    <div className={styles.name}>
                      {slot.name}
                      {draft.dirty ? (
                        <span className={styles.unsaved}> · unsaved</span>
                      ) : null}
                    </div>
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
                    Active key: <code>{slot.maskedKey}</code>
                    {slot.source === "env" ? " (from environment)" : ""}
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
                        : status[slot.id].startsWith("✗") ||
                            status[slot.id].toLowerCase().includes("fail")
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
