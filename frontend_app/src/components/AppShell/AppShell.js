import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import SessionList from "../SessionList/SessionList";
import { useFocusTrap } from "../../hooks/useFocusTrap";
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

  const mainRef = useRef(/** @type {HTMLElement|null} */ (null));
  const drawerRef = useRef(/** @type {HTMLElement|null} */ (null));
  const drawerCloseBtnRef = useRef(/** @type {HTMLButtonElement|null} */ (null));

  const activeSessionId = useMemo(() => {
    // Route supports /sessions/:id; root (/) means no specific session.
    return params.id || null;
  }, [params.id]);

  const closeMobileSidebar = () => setIsMobileSidebarOpen(false);

  const onSelectSession = (id) => {
    navigate(`/sessions/${id}`);
    closeMobileSidebar();
  };

  const onNewChat = () => {
    // In later steps this may create a new session. For now route to root.
    navigate(`/`);
    closeMobileSidebar();
  };

  const isInSessionRoute = location.pathname.startsWith("/sessions/");

  // Focus management on route change: move focus to main region (helps SR + keyboard).
  useEffect(() => {
    // Don't steal focus while drawer is open.
    if (isMobileSidebarOpen) return;
    mainRef.current?.focus?.();
  }, [location.pathname, isMobileSidebarOpen]);

  // Trap focus inside the mobile drawer when open; allow Esc to close.
  useFocusTrap({
    enabled: isMobileSidebarOpen,
    containerRef: drawerRef,
    initialFocusRef: drawerCloseBtnRef,
    onEscape: closeMobileSidebar
  });

  return (
    <div className={styles.shell}>
      {/* Skip link for keyboard users */}
      <a href="#main" className={styles.skipLink}>
        Skip to chat
      </a>

      <header className={styles.header}>
        <button
          className={`kv-btn ${styles.mobileOnly}`}
          onClick={() => setIsMobileSidebarOpen(true)}
          aria-label="Open sessions sidebar"
          aria-haspopup="dialog"
          aria-expanded={isMobileSidebarOpen ? "true" : "false"}
          aria-controls="mobile-sessions-drawer"
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
        <main id="main" ref={mainRef} className={styles.main} aria-label="Chat panel" tabIndex={-1}>
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      {isMobileSidebarOpen ? (
        <>
          <div className={styles.mobileOverlay} role="presentation" onClick={closeMobileSidebar} />
          <aside
            id="mobile-sessions-drawer"
            ref={drawerRef}
            className={styles.mobileDrawer}
            role="dialog"
            aria-modal="true"
            aria-label="Sessions drawer (mobile)"
          >
            <div className={styles.mobileCloseRow}>
              <button
                ref={drawerCloseBtnRef}
                className="kv-btn"
                onClick={closeMobileSidebar}
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

