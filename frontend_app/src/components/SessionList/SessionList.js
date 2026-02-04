import React, { useMemo } from "react";
import styles from "./SessionList.module.css";

/**
 * PUBLIC_INTERFACE
 */
export default function SessionList({ activeSessionId, onSelectSession }) {
  // Placeholder sessions until backend integration in later steps.
  const sessions = useMemo(
    () => [
      { id: "demo-1", title: "Product brainstorm", meta: "2 messages • Today" },
      { id: "demo-2", title: "Incident analysis", meta: "12 messages • Yesterday" },
      { id: "demo-3", title: "Customer email rewrite", meta: "5 messages • 2d ago" }
    ],
    []
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.titleRow}>
        <div className={styles.title}>Sessions</div>
      </div>

      <div className={styles.list} role="list">
        {sessions.map((s) => {
          const isActive = activeSessionId === s.id;
          return (
            <div
              key={s.id}
              role="listitem"
              className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
              onClick={() => onSelectSession?.(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelectSession?.(s.id);
              }}
              tabIndex={0}
              aria-current={isActive ? "page" : undefined}
            >
              <div className={styles.itemTitle}>{s.title}</div>
              <div className={styles.itemMeta}>{s.meta}</div>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        Tip: On mobile, open sessions from the ☰ button in the header.
      </div>
    </div>
  );
}
