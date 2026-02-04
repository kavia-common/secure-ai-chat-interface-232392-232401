import React, { useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../../lib/api/client";
import styles from "./ChatView.module.css";

const api = createApiClient();

/**
 * @typedef {"system"|"user"|"assistant"} Role
 * @typedef {{
 *   id: string,
 *   role: Role,
 *   content: string,
 *   createdAt: string,
 *   status?: "final"|"streaming"|"error"|"cancelled",
 *   errorText?: string
 * }} ChatMessage
 */

/**
 * Create a stable-ish message id without external deps.
 * @returns {string}
 */
function makeId() {
  return `m-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Format a time label (local, short).
 * @param {string} iso
 */
function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Best-effort: interpret streaming chunks into text.
 * - If JSON with common fields -> pull them out
 * - If "[DONE]" -> signals end
 * - Else treat as raw text delta
 * @param {string} dataText
 * @returns {{ kind: "done" } | { kind: "delta", text: string }}
 */
function parseStreamEvent(dataText) {
  const trimmed = (dataText ?? "").trim();
  if (!trimmed) return { kind: "delta", text: "" };
  if (trimmed === "[DONE]") return { kind: "done" };

  // Try JSON.
  try {
    const obj = JSON.parse(trimmed);

    // Many backends emit { delta: "..." } or { text: "..." } or { content: "..." }
    const maybe =
      obj?.delta ??
      obj?.text ??
      obj?.content ??
      obj?.message?.delta ??
      obj?.message?.content ??
      obj?.choices?.[0]?.delta?.content ??
      obj?.choices?.[0]?.text;

    if (typeof maybe === "string") return { kind: "delta", text: maybe };

    // Sometimes it's a full message.
    const full = obj?.message?.content ?? obj?.message;
    if (typeof full === "string") return { kind: "delta", text: full };

    // If nothing recognized, show compact string form.
    return { kind: "delta", text: trimmed };
  } catch {
    return { kind: "delta", text: dataText };
  }
}

/**
 * PUBLIC_INTERFACE
 */
export default function ChatView({ sessionId }) {
  const [messages, setMessages] = useState(/** @type {ChatMessage[]} */ ([]));
  const [composerText, setComposerText] = useState("");
  const [status, setStatus] = useState(
    /** @type {"idle"|"streaming"|"error"} */ ("idle")
  );
  const [errorText, setErrorText] = useState("");
  const [transport, setTransport] = useState(/** @type {"SSE"|"WS"|"STUB"} */ ("SSE"));

  const [lastUserText, setLastUserText] = useState("");
  const [lastSessionId, setLastSessionId] = useState(sessionId);

  const streamCancelRef = useRef(/** @type {null | (() => void)} */ (null));
  const streamTimeoutRef = useRef(/** @type {any} */ (null));
  const mountedRef = useRef(true);

  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Ensure streaming cleaned up on unmount.
      streamCancelRef.current?.();
      streamCancelRef.current = null;
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    };
  }, []);

  // Load/seed messages when session changes. (No backend assumptions; use lightweight stub state.)
  useEffect(() => {
    setErrorText("");
    setStatus("idle");

    // Cancel any in-flight stream when switching sessions.
    streamCancelRef.current?.();
    streamCancelRef.current = null;
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);

    setLastSessionId(sessionId);

    const now = new Date().toISOString();
    if (!sessionId) {
      setMessages([
        {
          id: makeId(),
          role: "system",
          content: "Start a new chat. Your messages will stream in real time when the backend is available.",
          createdAt: now,
          status: "final"
        }
      ]);
      return;
    }

    // In lieu of a dedicated "get messages" endpoint (not yet abstracted in ApiClient),
    // show a small session banner message and keep the rest in-memory for this view.
    setMessages([
      {
        id: makeId(),
        role: "system",
        content: `Viewing session: ${sessionId}`,
        createdAt: now,
        status: "final"
      }
    ]);
  }, [sessionId]);

  // Auto-scroll to bottom on message updates (only when near bottom already).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const isStreaming = status === "streaming";

  const headerBadge = useMemo(() => {
    if (transport === "STUB") return { label: "Stub", tone: "warn" };
    if (isStreaming) return { label: `Streaming (${transport})`, tone: "ok" };
    return { label: `Ready (${transport})`, tone: "neutral" };
  }, [isStreaming, transport]);

  const canSend = composerText.trim().length > 0 && !isStreaming;

  const appendMessage = (msg) => {
    setMessages((cur) => [...cur, msg]);
  };

  const updateMessage = (id, patch) => {
    setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const startStreamTimeout = () => {
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);

    // Timeout handling: if backend doesn't send anything, fail gracefully.
    streamTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      if (status !== "streaming") return;

      setStatus("error");
      setErrorText("Streaming timed out. You can Retry, or continue in stub mode.");
      // Mark streaming assistant message as errored (if present)
      setMessages((cur) => {
        const last = [...cur].reverse().find((m) => m.role === "assistant" && m.status === "streaming");
        if (!last) return cur;
        return cur.map((m) =>
          m.id === last.id ? { ...m, status: "error", errorText: "Timeout while waiting for stream." } : m
        );
      });

      streamCancelRef.current?.();
      streamCancelRef.current = null;
      setTransport((t) => (t === "STUB" ? t : t)); // keep transport indicator
    }, 45_000);
  };

  const cancelStreaming = () => {
    streamCancelRef.current?.();
    streamCancelRef.current = null;
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);

    // Mark last streaming assistant message cancelled.
    setMessages((cur) => {
      const last = [...cur].reverse().find((m) => m.role === "assistant" && m.status === "streaming");
      if (!last) return cur;
      return cur.map((m) => (m.id === last.id ? { ...m, status: "cancelled" } : m));
    });

    setStatus("idle");
    setErrorText("");
  };

  /**
   * Local fallback "assistant" response that simulates streaming.
   * @param {string} userText
   */
  const runStubStream = async (userText) => {
    setTransport("STUB");
    setStatus("streaming");
    setErrorText("");

    const assistantId = makeId();
    appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming"
    });

    let cancelled = false;
    streamCancelRef.current = () => {
      cancelled = true;
    };

    startStreamTimeout();

    const canned =
      `I can't reach the backend right now, so I'm running in local stub mode.\n\n` +
      `You said: “${userText}”.\n\n` +
      `When the backend becomes available, I’ll stream the real model output via SSE/WebSocket.`;

    // Stream char-by-char in small chunks.
    for (let i = 0; i < canned.length; i += 3) {
      if (!mountedRef.current || cancelled) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 18));
      updateMessage(assistantId, { content: canned.slice(0, i + 3) });
    }

    if (!mountedRef.current) return;

    if (cancelled) {
      updateMessage(assistantId, { status: "cancelled" });
      setStatus("idle");
      return;
    }

    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    updateMessage(assistantId, { status: "final" });
    setStatus("idle");
  };

  /**
   * Attempt SSE streaming first, then WS, then stub.
   * We do NOT assume backend endpoints beyond being "abstracted": for now we use conservative placeholders,
   * and fall back quickly if unreachable.
   *
   * Note: Once backend endpoints are finalized, replace paths with the ApiClient's dedicated helpers.
   *
   * @param {string} userText
   */
  const sendWithStreaming = async (userText) => {
    // Cancel any previous stream just in case.
    cancelStreaming();

    setLastUserText(userText);
    setErrorText("");

    const userMsg = {
      id: makeId(),
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
      status: "final"
    };
    appendMessage(userMsg);

    const assistantId = makeId();
    appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming"
    });

    setStatus("streaming");
    startStreamTimeout();

    // Small helper to complete stream cleanly.
    const finalize = (finalStatus) => {
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      updateMessage(assistantId, { status: finalStatus });
      streamCancelRef.current = null;
      setStatus("idle");
    };

    // Preferred: SSE.
    try {
      setTransport("SSE");

      const handle = api.connectSse("/chat/stream", {
        method: "POST",
        body: {
          sessionId: sessionId || null,
          message: userText
        },
        onOpen: () => {
          // no-op
        },
        onMessage: (dataText) => {
          startStreamTimeout();

          const evt = parseStreamEvent(dataText);
          if (evt.kind === "done") {
            finalize("final");
            return;
          }
          if (evt.text) {
            setMessages((cur) =>
              cur.map((m) => (m.id === assistantId ? { ...m, content: (m.content || "") + evt.text } : m))
            );
          }
        },
        onError: () => {
          // We'll abort and fall through to WS/stub.
        },
        shouldReconnect: () => false,
        maxRetries: 0
      });

      streamCancelRef.current = () => {
        handle.cancel();
        updateMessage(assistantId, { status: "cancelled" });
        setStatus("idle");
      };

      return; // SSE started successfully (even if it later errors, onError handles update via fallback elsewhere)
    } catch (e) {
      // Fall through to WS
    }

    // Secondary: WebSocket (message-oriented, best effort).
    try {
      setTransport("WS");

      const ws = api.connectWebSocket("/ws", {
        onMessage: (ev) => {
          startStreamTimeout();
          const raw = typeof ev.data === "string" ? ev.data : "";
          const evt = parseStreamEvent(raw);
          if (evt.kind === "done") {
            ws.close();
            finalize("final");
            return;
          }
          if (evt.text) {
            setMessages((cur) =>
              cur.map((m) => (m.id === assistantId ? { ...m, content: (m.content || "") + evt.text } : m))
            );
          }
        },
        shouldReconnect: () => false,
        maxRetries: 0
      });

      // Send a conservative payload.
      ws.send(
        JSON.stringify({
          type: "chat",
          sessionId: sessionId || null,
          message: userText
        })
      );

      streamCancelRef.current = () => {
        ws.close();
        updateMessage(assistantId, { status: "cancelled" });
        setStatus("idle");
      };

      return;
    } catch (e) {
      // Fall back to stub
    }

    // Fallback: stub simulated streaming and mark the streaming assistant message accordingly.
    updateMessage(assistantId, { status: "error", errorText: "Backend unavailable; switched to stub." });
    setStatus("idle");
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);

    await runStubStream(userText);
  };

  const onSend = async () => {
    const text = composerText.trim();
    if (!text || isStreaming) return;
    setComposerText("");
    await sendWithStreaming(text);
  };

  const onRetry = async () => {
    if (!lastUserText || isStreaming) return;

    // Retry: append a system note and re-run the send logic.
    appendMessage({
      id: makeId(),
      role: "system",
      content: "Retrying last message…",
      createdAt: new Date().toISOString(),
      status: "final"
    });

    await sendWithStreaming(lastUserText);
  };

  const showSessionHint = !sessionId;

  return (
    <div className={styles.wrapper}>
      <div className={`${styles.panel} kv-surface`}>
        <div className={styles.titleRow}>
          <div>
            <div className={styles.title}>{sessionId ? "Chat Session" : "New Chat"}</div>
            <div className={styles.subTitle}>
              {sessionId
                ? `Session ID: ${sessionId}`
                : "Create or select a session from the sidebar, then start chatting."}
            </div>
          </div>

          <span
            className={`${styles.badge} kv-badge`}
            title={
              transport === "STUB"
                ? "Backend unreachable; running in local stub mode"
                : "Streaming attempts: SSE first, then WebSocket fallback"
            }
          >
            <span aria-hidden="true">{isStreaming ? "◉" : "•"}</span>
            <span className="kv-muted">{headerBadge.label}</span>
          </span>
        </div>

        {errorText ? (
          <div className={styles.error} role="alert">
            <div className={styles.errorTitle}>Delivery issue</div>
            <div className={styles.errorSub}>{errorText}</div>
            <div className={styles.errorActions}>
              <button className="kv-btn" onClick={onRetry} disabled={isStreaming || !lastUserText}>
                Retry
              </button>
              <button className="kv-btn" onClick={() => setErrorText("")} disabled={isStreaming}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <div className={styles.messages} aria-label="Message list" ref={listRef}>
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isAssistant = m.role === "assistant";
            const isSystem = m.role === "system";

            return (
              <div
                key={m.id}
                className={`${styles.msg} ${isUser ? styles.msgUser : ""} ${isSystem ? styles.msgSystem : ""}`}
              >
                <div className={styles.msgMeta}>
                  <div className={styles.role}>{m.role}</div>
                  <div className={styles.time}>{formatTime(m.createdAt)}</div>
                </div>

                <div
                  className={`${styles.bubble} ${isUser ? styles.bubbleUser : ""} ${
                    isAssistant ? styles.bubbleAssistant : ""
                  } ${m.status === "error" ? styles.bubbleError : ""}`}
                >
                  <div className={styles.content}>{m.content}</div>

                  {m.status === "streaming" ? (
                    <div className={styles.typingRow} aria-live="polite" aria-label="Assistant is typing">
                      <span className={styles.typingDot} />
                      <span className={styles.typingDot} />
                      <span className={styles.typingDot} />
                      <span className={styles.typingLabel}>Typing…</span>
                    </div>
                  ) : null}

                  {m.status === "cancelled" ? (
                    <div className={styles.note} role="status">
                      Cancelled
                    </div>
                  ) : null}

                  {m.status === "error" && m.errorText ? (
                    <div className={styles.note} role="status">
                      {m.errorText}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {showSessionHint ? (
            <div className={styles.sessionHint} role="note">
              Tip: create a session from the sidebar to keep conversations organized. You can still chat here without one.
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${styles.composer} kv-surface`} aria-label="Message composer">
        <div className={styles.composerTop}>
          <textarea
            className={styles.input}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder={isStreaming ? "Streaming response… (Cancel available)" : "Type a message…"}
            rows={1}
            disabled={false}
            onKeyDown={(e) => {
              // Enter to send, Shift+Enter for newline
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />

          <div className={styles.actions}>
            {isStreaming ? (
              <button className="kv-btn" onClick={cancelStreaming} aria-label="Cancel generation">
                Cancel
              </button>
            ) : (
              <>
                <button
                  className="kv-btn"
                  onClick={onRetry}
                  disabled={!lastUserText}
                  aria-label="Retry last message"
                  title={lastUserText ? "Retry last message" : "No message to retry yet"}
                >
                  Retry
                </button>
                <button
                  className="kv-btn kv-btn-primary"
                  onClick={onSend}
                  disabled={!canSend}
                  aria-label="Send message"
                  title={canSend ? "Send" : "Type a message to send"}
                >
                  Send
                </button>
              </>
            )}
          </div>
        </div>

        <div className={styles.composerFooter}>
          <span className={styles.footerLeft}>
            <span className={styles.kbd}>Enter</span> to send • <span className={styles.kbd}>Shift</span>+
            <span className={styles.kbd}>Enter</span> for newline
          </span>
          <span className={styles.footerRight}>
            {transport === "STUB" ? (
              <span className={styles.offlinePill}>Offline mode</span>
            ) : (
              <span className={styles.onlinePill}>Realtime ready</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
