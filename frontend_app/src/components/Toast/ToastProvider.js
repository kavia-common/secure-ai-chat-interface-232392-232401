import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import styles from "./ToastProvider.module.css";

/**
 * @typedef {"info"|"success"|"error"} ToastTone
 * @typedef {{ id: string, tone: ToastTone, title?: string, message: string, createdAt: number, timeoutMs: number }} ToastItem
 */

const ToastContext = createContext(/** @type {null | { notify: (t: { tone?: ToastTone, title?: string, message: string, timeoutMs?: number }) => void }} */ (null));

function makeId() {
  return `t-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * PUBLIC_INTERFACE
 * ToastProvider:
 * - lightweight toasts with auto-dismiss
 * - keyboard accessible (dismiss buttons)
 */
export function ToastProvider({ children }) {
  const [items, setItems] = useState(/** @type {ToastItem[]} */ ([]));
  const timersRef = useRef(new Map());

  const remove = useCallback((id) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    ({ tone = "info", title, message, timeoutMs = 3200 }) => {
      const id = makeId();
      const toast = { id, tone, title, message, createdAt: Date.now(), timeoutMs };
      setItems((cur) => [...cur, toast]);

      const tm = setTimeout(() => remove(id), timeoutMs);
      timersRef.current.set(id, tm);
    },
    [remove]
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-relevant="additions removals" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[`tone_${t.tone}`]}`} role="status">
            <div className={styles.toastBody}>
              {t.title ? <div className={styles.toastTitle}>{t.title}</div> : null}
              <div className={styles.toastMsg}>{t.message}</div>
            </div>
            <button className={styles.toastClose} onClick={() => remove(t.id)} aria-label="Dismiss notification">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * PUBLIC_INTERFACE
 * Hook to show a toast.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider />");
  return ctx;
}
