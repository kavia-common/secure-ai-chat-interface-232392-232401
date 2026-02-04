import React, { useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../../lib/api/client";
import styles from "./SessionList.module.css";

const api = createApiClient();

/**
 * PUBLIC_INTERFACE
 */
export default function SessionList({ activeSessionId, onSelectSession }) {
  const [sessions, setSessions] = useState(/** @type {Array<any>} */ ([]));
  const [status, setStatus] = useState(/** @type {"idle"|"loading"|"ready"|"error"} */ ("idle"));
  const [errorText, setErrorText] = useState("");
  const [busyIds, setBusyIds] = useState(() => new Set());

  const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
  const [editingTitle, setEditingTitle] = useState("");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sortedSessions = useMemo(() => {
    // Keep stable ordering; server/stub already returns newest-first, but ensure deterministic behavior.
    return [...sessions].sort((a, b) => {
      const au = a.updatedAt || "";
      const bu = b.updatedAt || "";
      return bu.localeCompare(au);
    });
  }, [sessions]);

  const setBusy = (id, isBusy) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const loadSessions = async () => {
    setStatus("loading");
    setErrorText("");
    try {
      const data = await api.listSessions();
      if (!mountedRef.current) return;
      setSessions(Array.isArray(data) ? data : []);
      setStatus("ready");
    } catch (e) {
      if (!mountedRef.current) return;
      setStatus("error");
      setErrorText(e?.message || "Failed to load sessions");
    }
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRename = (s) => {
    setEditingId(s.id);
    setEditingTitle(s.title || "");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const commitRename = async (id) => {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;

    const prev = sessions;
    // optimistic
    setSessions((cur) => cur.map((s) => (s.id === id ? { ...s, title: newTitle } : s)));
    cancelRename();
    setBusy(id, true);

    try {
      await api.renameSession(id, { title: newTitle });
    } catch (e) {
      // rollback
      if (mountedRef.current) {
        setSessions(prev);
        setErrorText(e?.message || "Rename failed");
        setStatus("error");
      }
    } finally {
      if (mountedRef.current) setBusy(id, false);
    }
  };

  const onCreate = async () => {
    const tempId = `tmp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    const tempSession = {
      id: tempId,
      title: "New chat",
      meta: "0 messages • Just now",
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      _optimistic: true
    };

    setSessions((cur) => [tempSession, ...cur]);
    setBusy(tempId, true);
    setErrorText("");
    setStatus("ready");

    try {
      const created = await api.createSession({ title: "New chat" });
      if (!mountedRef.current) return;

      setSessions((cur) => cur.map((s) => (s.id === tempId ? created : s)));
      setBusy(tempId, false);

      // Navigate to created session
      onSelectSession?.(created.id);
    } catch (e) {
      if (!mountedRef.current) return;
      // remove temp
      setSessions((cur) => cur.filter((s) => s.id !== tempId));
      setBusy(tempId, false);
      setStatus("error");
      setErrorText(e?.message || "Failed to create session");
    }
  };

  const onDelete = async (id) => {
    const prev = sessions;
    const nextActiveFallback = prev.find((s) => s.id !== id)?.id || null;

    // optimistic remove
    setSessions((cur) => cur.filter((s) => s.id !== id));
    setBusy(id, true);
    setErrorText("");
    setStatus("ready");

    // If the active session was deleted, navigate away (or to another session if available).
    if (activeSessionId === id) {
      if (nextActiveFallback) onSelectSession?.(nextActiveFallback);
      // else: AppShell's "New chat" is "/", but SessionList only gets onSelectSession
      // and routing fallback is handled elsewhere. Keeping user on main panel is OK.
    }

    try {
      await api.deleteSession(id);
    } catch (e) {
      if (!mountedRef.current) return;
      // rollback
      setSessions(prev);
      setStatus("error");
      setErrorText(e?.message || "Delete failed");
    } finally {
      if (mountedRef.current) setBusy(id, false);
    }
  };

  const isEmpty = status === "ready" && sortedSessions.length === 0;

  return (
    <div className={styles.wrapper}>
      <div className={styles.titleRow}>
        <div className={styles.title}>Sessions</div>
        <button className={`kv-btn ${styles.newBtn}`} onClick={onCreate} aria-label="Create new session">
          + New
        </button>
      </div>

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
            <button className="kv-btn" onClick={loadSessions}>
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
      ) : (
        <div className={styles.list} role="list" aria-label="Session list">
          {sortedSessions.map((s) => {
            const isActive = activeSessionId === s.id;
            const isBusy = busyIds.has(s.id);
            const isEditing = editingId === s.id;

            return (
              <div
                key={s.id}
                role="listitem"
                className={`${styles.item} ${isActive ? styles.itemActive : ""} ${
                  isBusy ? styles.itemBusy : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.itemMain}
                  onClick={() => onSelectSession?.(s.id)}
                  aria-current={isActive ? "page" : undefined}
                  disabled={isEditing}
                  title={s.title}
                >
                  {isEditing ? (
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

                <div className={styles.itemActions}>
                  {isEditing ? (
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
                      <button
                        className={`kv-btn ${styles.iconBtn}`}
                        onClick={cancelRename}
                        aria-label="Cancel rename"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={`kv-btn ${styles.iconBtn}`}
                        onClick={() => startRename(s)}
                        aria-label={`Rename session ${s.title}`}
                        disabled={isBusy}
                      >
                        Rename
                      </button>
                      <button
                        className={`kv-btn ${styles.iconBtn} ${styles.dangerBtn}`}
                        onClick={() => onDelete(s.id)}
                        aria-label={`Delete session ${s.title}`}
                        disabled={isBusy}
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
      )}

      <div className={styles.footer}>Tip: On mobile, open sessions from the ☰ button in the header.</div>
    </div>
  );
}
