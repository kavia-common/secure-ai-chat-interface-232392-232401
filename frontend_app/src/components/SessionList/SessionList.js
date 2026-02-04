import React, { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../Toast/ToastProvider";
import { useAppActions, useAppState } from "../../state/AppStateContext";
import styles from "./SessionList.module.css";

/**
 * PUBLIC_INTERFACE
 */
export default function SessionList({ activeSessionId, onSelectSession }) {
  const toast = useToast();
  const state = useAppState();
  const actions = useAppActions();

  const { items: sessions, status, errorText, busyIds } = state.sessions;

  const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
  const [editingTitle, setEditingTitle] = useState("");

  // Roving focus for session "main" buttons (arrow-key navigation).
  const itemButtonRefs = useRef(/** @type {Record<string, HTMLButtonElement|null>} */ ({}));
  const lastFocusedSessionIdRef = useRef(/** @type {string|null} */ (null));

  const sortedSessions = useMemo(() => {
    // Keep stable ordering; server/stub already returns newest-first, but ensure deterministic behavior.
    return [...sessions].sort((a, b) => {
      const au = a.updatedAt || "";
      const bu = b.updatedAt || "";
      return bu.localeCompare(au);
    });
  }, [sessions]);

  useEffect(() => {
    actions.loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRename = (s) => {
    // Remember current focus so we can restore it if rename is cancelled/committed.
    lastFocusedSessionIdRef.current = s.id;
    setEditingId(s.id);
    setEditingTitle(s.title || "");
  };

  const restoreFocus = (id) => {
    const btn = itemButtonRefs.current?.[id];
    btn?.focus?.();
  };

  const cancelRename = () => {
    const id = editingId;
    setEditingId(null);
    setEditingTitle("");
    if (id) restoreFocus(id);
  };

  const commitRename = async (id) => {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;

    setEditingId(null);
    setEditingTitle("");

    try {
      await actions.renameSession(id, { title: newTitle });
      toast.notify({ tone: "success", title: "Session updated", message: "Renamed successfully." });
      restoreFocus(id);
    } catch (e) {
      toast.notify({ tone: "error", title: "Rename failed", message: e?.message || "Unable to rename this session." });
      restoreFocus(id);
    }
  };

  const onCreate = async () => {
    try {
      const created = await actions.createSession({ title: "New chat" });
      toast.notify({ tone: "success", title: "Session created", message: "A new chat session is ready." });
      onSelectSession?.(created.id);
    } catch (e) {
      toast.notify({
        tone: "error",
        title: "Create failed",
        message: e?.message || "Unable to create a session right now."
      });
    }
  };

  const onDelete = async (id) => {
    const nextActiveFallback = sortedSessions.find((s) => s.id !== id)?.id || null;

    if (activeSessionId === id && nextActiveFallback) {
      onSelectSession?.(nextActiveFallback);
    }

    try {
      await actions.deleteSession(id);
      toast.notify({ tone: "info", title: "Session deleted", message: "Removed from your list." });
    } catch (e) {
      toast.notify({ tone: "error", title: "Delete failed", message: e?.message || "Unable to delete this session." });
    }
  };

  const isBusy = (id) => Boolean(busyIds?.[id]);
  const isEmpty = status === "ready" && sortedSessions.length === 0;

  return (
    <div className={styles.wrapper}>
      <div className={styles.titleRow}>
        <div className={styles.title}>Sessions</div>
        <button
          className={`kv-btn ${styles.newBtn}`}
          onClick={onCreate}
          aria-label="Create new session"
          disabled={status === "loading"}
        >
          + New
        </button>
      </div>

      {/* Consistent states */}
      {status === "loading" ? (
        <div className={styles.state} role="status" aria-live="polite">
          <div className={styles.stateTitle}>Loading sessions…</div>
          <div className={styles.stateSub}>Connecting to API (stub fallback enabled)</div>
        </div>
      ) : null}

      {status === "error" && errorText ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Something went wrong</div>
          <div className={styles.errorSub}>{errorText}</div>
          <div className={styles.errorActions}>
            <button className="kv-btn" onClick={actions.loadSessions}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div className={styles.state} role="status" aria-live="polite">
          <div className={styles.stateTitle}>No sessions yet</div>
          <div className={styles.stateSub}>Create your first chat session to get started.</div>
          <div className={styles.stateActions}>
            <button className="kv-btn kv-btn-primary" onClick={onCreate}>
              Create session
            </button>
          </div>
        </div>
      ) : status === "ready" ? (
        <div className={styles.list} role="list" aria-label="Session list">
          {sortedSessions.map((s) => {
            const active = activeSessionId === s.id;
            const busy = isBusy(s.id);
            const editing = editingId === s.id;

            return (
              <div
                key={s.id}
                role="listitem"
                className={`${styles.item} ${active ? styles.itemActive : ""} ${busy ? styles.itemBusy : ""}`}
              >
                <button
                  ref={(el) => {
                    itemButtonRefs.current[s.id] = el;
                  }}
                  type="button"
                  className={styles.itemMain}
                  onClick={() => onSelectSession?.(s.id)}
                  aria-current={active ? "page" : undefined}
                  aria-label={`Open session ${s.title}`}
                  disabled={editing}
                  title={s.title}
                  onFocus={() => {
                    lastFocusedSessionIdRef.current = s.id;
                  }}
                  onKeyDown={(e) => {
                    // Arrow navigation between sessions for keyboard users.
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
                    e.preventDefault();

                    const ids = sortedSessions.map((x) => x.id);
                    const currentIndex = Math.max(0, ids.indexOf(s.id));
                    let nextIndex = currentIndex;

                    if (e.key === "ArrowDown") nextIndex = Math.min(ids.length - 1, currentIndex + 1);
                    if (e.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
                    if (e.key === "Home") nextIndex = 0;
                    if (e.key === "End") nextIndex = ids.length - 1;

                    const nextId = ids[nextIndex];
                    itemButtonRefs.current?.[nextId]?.focus?.();
                  }}
                >
                  {editing ? (
                    <span className={styles.srOnly}>Editing session title</span>
                  ) : (
                    <>
                      <div className={styles.itemTitleRow}>
                        <div className={styles.itemTitle}>{s.title}</div>
                        {s._optimistic ? <span className={styles.pill}>Saving…</span> : null}
                      </div>
                      <div className={styles.itemMeta}>{s.meta}</div>
                    </>
                  )}
                </button>

                <div className={styles.itemActions} aria-label={`Actions for ${s.title}`}>
                  {editing ? (
                    <>
                      <input
                        className={styles.renameInput}
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(s.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                        autoFocus
                        aria-label="Session title"
                      />
                      <button
                        className={`kv-btn ${styles.iconBtn}`}
                        onClick={() => commitRename(s.id)}
                        aria-label="Save rename"
                        disabled={!editingTitle.trim()}
                      >
                        ✓
                      </button>
                      <button className={`kv-btn ${styles.iconBtn}`} onClick={cancelRename} aria-label="Cancel rename">
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={`kv-btn ${styles.iconBtn}`}
                        onClick={() => startRename(s)}
                        aria-label={`Rename session ${s.title}`}
                        disabled={busy}
                      >
                        Rename
                      </button>
                      <button
                        className={`kv-btn ${styles.iconBtn} ${styles.dangerBtn}`}
                        onClick={() => onDelete(s.id)}
                        aria-label={`Delete session ${s.title}`}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className={styles.footer}>Tip: On mobile, open sessions from the ☰ button in the header.</div>
    </div>
  );
}

