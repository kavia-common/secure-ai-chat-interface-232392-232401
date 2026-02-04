import React, { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../Toast/ToastProvider";
import { useAuth } from "../../auth/AuthContext";
import { useAppActions, useAppState } from "../../state/AppStateContext";
import styles from "./ChatView.module.css";

/**
 * @typedef {"system"|"user"|"assistant"} Role
 *
 * @typedef {{
 *   id: string,
 *   fileName: string,
 *   size: number,
 *   mimeType: string,
 *   createdAt: string,
 *   url?: string
 * }} UploadedFile
 *
 * @typedef {{
 *   clientId: string,
 *   file: File,
 *   status: "queued"|"uploading"|"done"|"error"|"cancelled",
 *   progress: number,
 *   loaded: number,
 *   total: number,
 *   errorText?: string,
 *   upload?: UploadedFile,
 *   cancel?: () => void
 * }} AttachmentItem
 *
 * @typedef {{
 *   id: string,
 *   role: Role,
 *   content: string,
 *   createdAt: string,
 *   status?: "final"|"streaming"|"error"|"cancelled",
 *   errorText?: string,
 *   attachments?: UploadedFile[]
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
 * Create a stable-ish attachment id without external deps.
 * @returns {string}
 */
function makeAttachmentId() {
  return `a-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Pretty bytes helper.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const val = b / 1024 ** idx;
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
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
  const toast = useToast();
  const { api } = useAuth();
  const appState = useAppState();
  const appActions = useAppActions();

  // Ensure per-session message bucket exists + seeded baseline
  useEffect(() => {
    appActions.ensureSessionMessagesSeeded(sessionId);
    appActions.setActiveSessionId(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const messagesKey = sessionId || "__root__";
  const messageBucket = appState.messagesBySession[messagesKey] || { items: [], status: "idle", errorText: "" };
  const messages = messageBucket.items;

  const [composerText, setComposerText] = useState("");
  const [status, setStatus] = useState(/** @type {"idle"|"streaming"|"error"} */ ("idle"));
  const [errorText, setErrorText] = useState("");
  const [transport, setTransport] = useState(/** @type {"SSE"|"WS"|"STUB"} */ ("SSE"));

  const [lastUserText, setLastUserText] = useState("");

  /** Attachment composer state */
  const [attachments, setAttachments] = useState(/** @type {AttachmentItem[]} */ ([]));
  const [isDropActive, setIsDropActive] = useState(false);
  const [uploadSummaryText, setUploadSummaryText] = useState("");

  // Validation rules (frontend-only; backend still enforces its own)
  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
  const MAX_FILES = 10;
  const ALLOWED_MIME_PREFIXES = ["image/", "text/"];
  const ALLOWED_EXACT_MIMES = [
    "application/pdf",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];

  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

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

  // When session changes, reset only UI-level state; message history is maintained in global store.
  useEffect(() => {
    setErrorText("");
    setStatus("idle");
    setLastUserText("");

    // Cancel any in-flight stream when switching sessions.
    streamCancelRef.current?.();
    streamCancelRef.current = null;
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
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

  const uploadStats = useMemo(() => {
    const total = attachments.length;
    const uploading = attachments.filter((a) => a.status === "uploading" || a.status === "queued").length;
    const done = attachments.filter((a) => a.status === "done").length;
    const errored = attachments.filter((a) => a.status === "error").length;
    return { total, uploading, done, errored };
  }, [attachments]);

  const hasBlockingUploads = uploadStats.uploading > 0;
  const hasBlockingErrors = uploadStats.errored > 0;

  const canSend = composerText.trim().length > 0 && !isStreaming && !hasBlockingUploads && !hasBlockingErrors;

  const appendMessage = (msg) => {
    appActions.appendMessage(sessionId, msg);
  };

  const updateMessage = (id, patch) => {
    appActions.updateMessage(sessionId, id, patch);
  };

  /**
   * Validate a file against basic constraints.
   * @param {File} file
   * @returns {string|null} error text or null
   */
  const validateFile = (file) => {
    if (!file) return "Invalid file.";
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File is too large (${formatBytes(file.size)}). Max is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`;
    }

    const type = file.type || "";
    const okByPrefix = ALLOWED_MIME_PREFIXES.some((p) => type.startsWith(p));
    const okByExact = ALLOWED_EXACT_MIMES.includes(type);

    // If browser doesn't know the MIME type, allow but warn by name.
    if (!type) return null;

    if (!okByPrefix && !okByExact) {
      return `Unsupported file type (${type}).`;
    }
    return null;
  };

  /**
   * Start uploading a specific attachment.
   * @param {string} clientId
   * @param {File} file
   */
  const startUpload = async (clientId, file) => {
    setAttachments((cur) =>
      cur.map((a) =>
        a.clientId === clientId
          ? {
              ...a,
              status: "uploading",
              progress: 0,
              loaded: 0,
              total: file.size || 0,
              errorText: ""
            }
          : a
      )
    );

    try {
      const { upload, cancel } = await api.uploadFile(file, {
        onProgress: ({ loaded, total, percent }) => {
          if (!mountedRef.current) return;
          setAttachments((cur) =>
            cur.map((a) =>
              a.clientId === clientId
                ? {
                    ...a,
                    loaded,
                    total,
                    progress: Math.max(0, Math.min(100, Number(percent || 0)))
                  }
                : a
            )
          );
        }
      });

      if (!mountedRef.current) return;

      setAttachments((cur) =>
        cur.map((a) =>
          a.clientId === clientId
            ? {
                ...a,
                status: "done",
                upload,
                cancel,
                progress: 100,
                loaded: a.total || file.size || 0,
                total: a.total || file.size || 0
              }
            : a
        )
      );
    } catch (e) {
      if (!mountedRef.current) return;

      const msg = e?.message || "Upload failed.";
      const cancelled = String(msg).toLowerCase().includes("cancel");
      setAttachments((cur) =>
        cur.map((a) =>
          a.clientId === clientId
            ? {
                ...a,
                status: cancelled ? "cancelled" : "error",
                errorText: msg
              }
            : a
        )
      );
    }
  };

  /**
   * Add selected/dropped files to the queue (with validation).
   * @param {FileList|File[]} filesLike
   */
  const addFiles = async (filesLike) => {
    const arr = Array.from(filesLike || []);
    if (!arr.length) return;

    setUploadSummaryText("");

    // Enforce max count against existing.
    const existingCount = attachments.length;
    const allowed = Math.max(0, MAX_FILES - existingCount);
    const toConsider = arr.slice(0, allowed);

    const rejectedCount = arr.length - toConsider.length;
    if (rejectedCount > 0) {
      setUploadSummaryText(`Only ${MAX_FILES} attachments allowed. ${rejectedCount} file(s) were ignored.`);
    }

    /** @type {AttachmentItem[]} */
    const newItems = [];
    for (const f of toConsider) {
      const err = validateFile(f);
      if (err) {
        newItems.push({
          clientId: makeAttachmentId(),
          file: f,
          status: "error",
          progress: 0,
          loaded: 0,
          total: f.size || 0,
          errorText: err
        });
      } else {
        newItems.push({
          clientId: makeAttachmentId(),
          file: f,
          status: "queued",
          progress: 0,
          loaded: 0,
          total: f.size || 0
        });
      }
    }

    if (!newItems.length) return;

    // Add to state first.
    setAttachments((cur) => [...cur, ...newItems]);

    // Start uploads for valid items (queued).
    for (const item of newItems) {
      if (item.status === "queued") {
        // eslint-disable-next-line no-await-in-loop
        await startUpload(item.clientId, item.file);
      }
    }
  };

  const removeAttachment = async (clientId) => {
    const target = attachments.find((a) => a.clientId === clientId);
    if (!target) return;

    // Attempt to cancel in-flight upload.
    if (target.status === "uploading") {
      try {
        target.cancel?.();
      } catch {
        // ignore
      }
    }

    // If already uploaded, best-effort delete on backend/stub.
    if (target.status === "done" && target.upload?.id) {
      try {
        await api.deleteUpload(target.upload.id);
      } catch {
        // ignore; UI remove should still succeed
      }
    }

    setAttachments((cur) => cur.filter((a) => a.clientId !== clientId));
  };

  const cancelAttachmentUpload = (clientId) => {
    const target = attachments.find((a) => a.clientId === clientId);
    if (!target) return;
    try {
      target.cancel?.();
    } catch {
      // ignore
    }
    setAttachments((cur) =>
      cur.map((a) => (a.clientId === clientId ? { ...a, status: "cancelled", errorText: "Cancelled" } : a))
    );
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
      const cur = appState.messagesBySession[messagesKey]?.items || [];
      const last = [...cur].reverse().find((m) => m.role === "assistant" && m.status === "streaming");
      if (last) updateMessage(last.id, { status: "error", errorText: "Timeout while waiting for stream." });

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
    const cur = appState.messagesBySession[messagesKey]?.items || [];
    const last = [...cur].reverse().find((m) => m.role === "assistant" && m.status === "streaming");
    if (last) updateMessage(last.id, { status: "cancelled" });

    setStatus("idle");
    setErrorText("");
    toast.notify({ tone: "info", title: "Cancelled", message: "Generation stopped." });
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
    toast.notify({ tone: "info", title: "Stub mode", message: "Backend unreachable; showing local fallback response." });
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

    const successfulUploads = attachments
      .filter((a) => a.status === "done" && a.upload && a.upload.id)
      .map((a) => a.upload);

    const userMsg = {
      id: makeId(),
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
      status: "final",
      attachments: successfulUploads
    };
    appendMessage(userMsg);

    // Clear composer attachments once message is accepted into the timeline.
    setAttachments([]);

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
          message: userText,
          attachments: successfulUploads.map((u) => ({
            id: u.id,
            fileName: u.fileName,
            size: u.size,
            mimeType: u.mimeType
          }))
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
            const current = appState.messagesBySession[messagesKey]?.items || [];
            const target = current.find((m) => m.id === assistantId);
            const existing = target?.content || "";
            updateMessage(assistantId, { content: `${existing}${evt.text}` });
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
            const current = appState.messagesBySession[messagesKey]?.items || [];
            const target = current.find((m) => m.id === assistantId);
            const existing = target?.content || "";
            updateMessage(assistantId, { content: `${existing}${evt.text}` });
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
          message: userText,
          attachments: successfulUploads.map((u) => ({
            id: u.id,
            fileName: u.fileName,
            size: u.size,
            mimeType: u.mimeType
          }))
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
            role="status"
            aria-live="polite"
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

        <div
          className={styles.messages}
          role="log"
          aria-label="Message list"
          aria-live={isStreaming ? "polite" : "off"}
          aria-relevant="additions text"
          ref={listRef}
        >
          {messages.length === 0 ? (
            <div className={styles.sessionHint} role="status" aria-live="polite">
              No messages yet. Type below to begin.
            </div>
          ) : null}

          {messages.map((m) => {
            const isUser = m.role === "user";
            const isAssistant = m.role === "assistant";
            const isSystem = m.role === "system";

            return (
              <article
                key={m.id}
                className={`${styles.msg} ${isUser ? styles.msgUser : ""} ${isSystem ? styles.msgSystem : ""}`}
                aria-label={`${m.role} message at ${formatTime(m.createdAt)}`}
              >
                <div className={styles.msgMeta} aria-hidden="true">
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
                      <span className={styles.typingDot} aria-hidden="true" />
                      <span className={styles.typingDot} aria-hidden="true" />
                      <span className={styles.typingDot} aria-hidden="true" />
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
              </article>
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
        <div
          className={`${styles.dropZone} ${isDropActive ? styles.dropZoneActive : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Attach files: drag and drop files here, or press Enter to choose files"
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropActive(false);
            const files = e.dataTransfer?.files;
            if (files && files.length) addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className={styles.dropZoneTitle}>Drag & drop files to attach</div>
          <div className={styles.dropZoneSub}>
            or <span className={styles.dropZoneLink}>choose files</span> (up to {MAX_FILES}, max{" "}
            {formatBytes(MAX_FILE_SIZE_BYTES)} each)
          </div>

          <input
            ref={fileInputRef}
            className={styles.fileInput}
            type="file"
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length) addFiles(files);
              // Allow selecting the same file again.
              e.target.value = "";
            }}
            aria-label="Choose files to upload"
          />
        </div>

        {uploadSummaryText ? (
          <div className={styles.uploadSummary} role="status" aria-live="polite">
            {uploadSummaryText}
          </div>
        ) : null}

        {attachments.length ? (
          <div className={styles.attachments} aria-label="Attachments">
            <div className={styles.attachmentsHeader}>
              <div className={styles.attachmentsTitle}>
                Attachments
                {uploadStats.uploading > 0 ? (
                  <span className={styles.attachmentsMeta}> • Uploading…</span>
                ) : uploadStats.errored > 0 ? (
                  <span className={styles.attachmentsMeta}> • Fix errors to send</span>
                ) : (
                  <span className={styles.attachmentsMeta}> • Ready</span>
                )}
              </div>

              <button
                type="button"
                className="kv-btn"
                onClick={() => setAttachments([])}
                aria-label="Clear all attachments"
                title="Clear all attachments"
                disabled={attachments.some((a) => a.status === "uploading")}
              >
                Clear
              </button>
            </div>

            <ul className={styles.attachmentList}>
              {attachments.map((a) => (
                <li key={a.clientId} className={styles.attachmentItem}>
                  <div className={styles.attachmentMain}>
                    <div className={styles.attachmentName} title={a.file.name}>
                      {a.file.name}
                    </div>
                    <div className={styles.attachmentMeta}>
                      {formatBytes(a.file.size)} • {a.file.type || "unknown type"}
                    </div>

                    {a.status === "uploading" || a.status === "queued" ? (
                      <div className={styles.progressRow} aria-label={`Upload progress for ${a.file.name}`}>
                        <div className={styles.progressTrack} aria-hidden="true">
                          <div className={styles.progressFill} style={{ width: `${a.progress || 0}%` }} />
                        </div>
                        <div className={styles.progressPct}>{a.progress || 0}%</div>
                      </div>
                    ) : null}

                    {a.status === "done" && a.upload?.id ? (
                      <div className={styles.attachmentOk} role="status">
                        Uploaded • ID: <span className={styles.mono}>{a.upload.id}</span>
                      </div>
                    ) : null}

                    {a.status === "cancelled" ? (
                      <div className={styles.attachmentWarn} role="status">
                        Cancelled
                      </div>
                    ) : null}

                    {a.status === "error" && a.errorText ? (
                      <div className={styles.attachmentError} role="status">
                        {a.errorText}
                      </div>
                    ) : null}
                  </div>

                  <div className={styles.attachmentActions}>
                    {a.status === "uploading" ? (
                      <button
                        type="button"
                        className="kv-btn"
                        onClick={() => cancelAttachmentUpload(a.clientId)}
                        aria-label={`Cancel upload for ${a.file.name}`}
                      >
                        Cancel
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="kv-btn"
                      onClick={() => removeAttachment(a.clientId)}
                      aria-label={`Remove attachment ${a.file.name}`}
                      title="Remove attachment"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.composerTop}>
          <textarea
            className={styles.input}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder={isStreaming ? "Streaming response… (Cancel available)" : "Type a message…"}
            rows={1}
            disabled={false}
            aria-label="Message text"
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
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add attachments"
                  title="Add attachments"
                  disabled={attachments.length >= MAX_FILES}
                >
                  Attach
                </button>
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
                  title={
                    canSend
                      ? "Send"
                      : hasBlockingUploads
                        ? "Wait for uploads to finish"
                        : hasBlockingErrors
                          ? "Remove or fix attachment errors"
                          : "Type a message to send"
                  }
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
            {uploadStats.total ? (
              <span className={styles.queuePill} title="Attachment queue status">
                {uploadStats.done}/{uploadStats.total} uploaded
              </span>
            ) : null}
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
