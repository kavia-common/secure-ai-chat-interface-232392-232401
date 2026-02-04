import React, { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import SessionList from "../SessionList/SessionList";
import styles from "./AppShell.module.css";

/**
 * PUBLIC_INTERFACE
 */
export default function AppShell({ children }) {
  /** Ocean Professional: keep layout state local and simple (no backend assumptions). */
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const activeSessionId = useMemo(() => {
    // Route supports /sessions/:id; root (/) means no specific session.
    return params.id || null;
  }, [params.id]);

  const onSelectSession = (id) => {
    navigate(`/sessions/${id}`);
    setIsMobileSidebarOpen(false);
  };

  const onNewChat = () => {
    // In later steps this may create a new session. For now route to root.
    navigate(`/`);
    setIsMobileSidebarOpen(false);
  };

  const isInSessionRoute = location.pathname.startsWith("/sessions/");

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <button
          className={`kv-btn ${styles.mobileOnly}`}
          onClick={() => setIsMobileSidebarOpen(true)}
          aria-label="Open sessions sidebar"
        >
          ☰
        </button>

        <div className={styles.brand} role="banner" aria-label="Application header">
          <div className={styles.logoMark} aria-hidden="true" />
          <div className={styles.brandText}>
            <div className={styles.brandTitle}>Secure AI Chat</div>
            <div className={styles.brandSubtitle}>Ocean Professional</div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <span className="kv-badge" title="Current route">
            <span aria-hidden="true">•</span>
            <span className="kv-muted">{isInSessionRoute ? "Session" : "Chat"}</span>
          </span>

          <button className="kv-btn kv-btn-primary" onClick={onNewChat}>
            New chat
          </button>
        </div>
      </header>

      <div className={styles.content}>
        {/* Desktop sidebar */}
        <aside className={styles.sidebar} aria-label="Sessions sidebar">
          <SessionList activeSessionId={activeSessionId} onSelectSession={onSelectSession} />
        </aside>

        {/* Main */}
        <main className={styles.main} aria-label="Chat panel">
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      {isMobileSidebarOpen ? (
        <>
          <div
            className={styles.mobileOverlay}
            role="presentation"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <aside className={styles.mobileDrawer} aria-label="Sessions drawer (mobile)">
            <div className={styles.mobileCloseRow}>
              <button
                className="kv-btn"
                onClick={() => setIsMobileSidebarOpen(false)}
                aria-label="Close sessions sidebar"
              >
                Close
              </button>
            </div>
            <SessionList activeSessionId={activeSessionId} onSelectSession={onSelectSession} />
          </aside>
        </>
      ) : null}
    </div>
  );
}
