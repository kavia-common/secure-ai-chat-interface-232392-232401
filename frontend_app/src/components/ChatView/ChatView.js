import React, { useMemo } from "react";
import styles from "./ChatView.module.css";

/**
 * PUBLIC_INTERFACE
 */
export default function ChatView({ sessionId }) {
  const messages = useMemo(() => {
    // Placeholder messages. Later steps will replace with real session messages + streaming.
    if (sessionId) {
      return [
        { id: 1, role: "system", content: `Viewing session: ${sessionId}` },
        { id: 2, role: "user", content: "Give me a concise project status update." },
        {
          id: 3,
          role: "assistant",
          content:
            "UI scaffold is in place: routing, Ocean Professional theme tokens, and responsive two-pane layout."
        }
      ];
    }

    return [
      { id: 1, role: "system", content: "Start a new chat (no session selected)." },
      { id: 2, role: "assistant", content: "Ask a question to begin. (Backend not wired yet.)" }
    ];
  }, [sessionId]);

  return (
    <div className={styles.wrapper}>
      <div className={`${styles.panel} kv-surface`}>
        <div className={styles.titleRow}>
          <div>
            <div className={styles.title}>{sessionId ? "Chat Session" : "New Chat"}</div>
            <div className={styles.subTitle}>
              {sessionId ? `Session ID: ${sessionId}` : "Create or select a session from the sidebar"}
            </div>
          </div>
          <span className="kv-badge">
            <span aria-hidden="true">◉</span>
            <span className="kv-muted">Placeholder</span>
          </span>
        </div>

        <div className={styles.messages} aria-label="Message list">
          {messages.map((m) => (
            <div key={m.id} className={styles.msg}>
              <div className={styles.role}>{m.role}</div>
              <div className={`${styles.bubble} ${m.role === "user" ? styles.bubbleUser : ""}`}>
                {m.content}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${styles.composer} kv-surface`} aria-label="Message composer">
        <input
          className={styles.input}
          type="text"
          placeholder="Type a message… (wired in later steps)"
          disabled
          aria-disabled="true"
        />
        <button className="kv-btn kv-btn-primary" disabled aria-disabled="true">
          Send
        </button>
      </div>
    </div>
  );
}
