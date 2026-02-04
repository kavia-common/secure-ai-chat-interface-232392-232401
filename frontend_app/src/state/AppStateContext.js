import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { useAuth } from "../auth/AuthContext";

/**
 * @typedef {{ id: string, title: string, updatedAt?: string, messageCount?: number, meta?: string, _optimistic?: boolean }} ChatSession
 *
 * @typedef {"system"|"user"|"assistant"} Role
 *
 * @typedef {{ id: string, fileName: string, size: number, mimeType: string, createdAt: string, url?: string }} UploadedFile
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
 *
 * @typedef {{
 *   sessions: {
 *     items: ChatSession[],
 *     status: "idle"|"loading"|"ready"|"error",
 *     errorText: string,
 *     busyIds: Record<string, boolean>,
 *     lastLoadedAt?: number
 *   },
 *   messagesBySession: Record<string, { items: ChatMessage[], status: "idle"|"loading"|"ready"|"error", errorText: string }>,
 *   ui: {
 *     activeSessionId: string | null
 *   }
 * }} AppState
 */

const AppStateContext = createContext(/** @type {AppState | null} */ (null));
const AppActionsContext = createContext(/** @type {any} */ (null));

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function formatSessionMeta(s) {
  const count = Number.isFinite(s?.messageCount) ? s.messageCount : 0;
  const d = s?.updatedAt ? new Date(s.updatedAt) : new Date();
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));

  let when = "Just now";
  if (diffMin >= 60 * 48) when = `${Math.round(diffMin / (60 * 24))}d ago`;
  else if (diffMin >= 60) when = `${Math.round(diffMin / 60)}h ago`;
  else if (diffMin >= 1) when = `${diffMin}m ago`;

  return `${count} message${count === 1 ? "" : "s"} • ${when}`;
}

function getSessionKey(sessionId) {
  return sessionId || "__root__";
}

/** @type {AppState} */
const initialState = {
  sessions: {
    items: [],
    status: "idle",
    errorText: "",
    busyIds: {},
    lastLoadedAt: undefined
  },
  messagesBySession: {},
  ui: {
    activeSessionId: null
  }
};

function reducer(state, action) {
  switch (action.type) {
    case "sessions/loading":
      return {
        ...state,
        sessions: { ...state.sessions, status: "loading", errorText: "" }
      };
    case "sessions/ready":
      return {
        ...state,
        sessions: {
          ...state.sessions,
          status: "ready",
          errorText: "",
          items: action.items,
          lastLoadedAt: Date.now()
        }
      };
    case "sessions/error":
      return {
        ...state,
        sessions: { ...state.sessions, status: "error", errorText: action.errorText || "Failed to load sessions" }
      };
    case "sessions/setBusy": {
      const { id, isBusy } = action;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          busyIds: { ...state.sessions.busyIds, [id]: Boolean(isBusy) }
        }
      };
    }
    case "sessions/replaceOne": {
      const { id, session } = action;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          items: state.sessions.items.map((s) => (s.id === id ? session : s))
        }
      };
    }
    case "sessions/patchOne": {
      const { id, patch } = action;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          items: state.sessions.items.map((s) => (s.id === id ? { ...s, ...patch } : s))
        }
      };
    }
    case "sessions/prepend":
      return { ...state, sessions: { ...state.sessions, items: [action.session, ...state.sessions.items] } };
    case "sessions/remove": {
      const { id } = action;
      const nextItems = state.sessions.items.filter((s) => s.id !== id);
      // Remove busy flag too
      const nextBusy = { ...state.sessions.busyIds };
      delete nextBusy[id];
      return { ...state, sessions: { ...state.sessions, items: nextItems, busyIds: nextBusy } };
    }
    case "ui/setActiveSession":
      return { ...state, ui: { ...state.ui, activeSessionId: action.sessionId ?? null } };

    case "messages/init": {
      const key = getSessionKey(action.sessionId);
      if (state.messagesBySession[key]) return state;
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [key]: { items: [], status: "idle", errorText: "" }
        }
      };
    }
    case "messages/loading": {
      const key = getSessionKey(action.sessionId);
      const cur = state.messagesBySession[key] || { items: [], status: "idle", errorText: "" };
      return {
        ...state,
        messagesBySession: { ...state.messagesBySession, [key]: { ...cur, status: "loading", errorText: "" } }
      };
    }
    case "messages/ready": {
      const key = getSessionKey(action.sessionId);
      return {
        ...state,
        messagesBySession: { ...state.messagesBySession, [key]: { items: action.items, status: "ready", errorText: "" } }
      };
    }
    case "messages/error": {
      const key = getSessionKey(action.sessionId);
      const cur = state.messagesBySession[key] || { items: [], status: "idle", errorText: "" };
      return {
        ...state,
        messagesBySession: { ...state.messagesBySession, [key]: { ...cur, status: "error", errorText: action.errorText || "Failed to load messages" } }
      };
    }
    case "messages/append": {
      const key = getSessionKey(action.sessionId);
      const cur = state.messagesBySession[key] || { items: [], status: "idle", errorText: "" };
      return {
        ...state,
        messagesBySession: { ...state.messagesBySession, [key]: { ...cur, items: [...cur.items, action.message], status: cur.status === "idle" ? "ready" : cur.status } }
      };
    }
    case "messages/replaceAll": {
      const key = getSessionKey(action.sessionId);
      const cur = state.messagesBySession[key] || { items: [], status: "idle", errorText: "" };
      return {
        ...state,
        messagesBySession: { ...state.messagesBySession, [key]: { ...cur, items: action.items } }
      };
    }
    case "messages/updateOne": {
      const key = getSessionKey(action.sessionId);
      const cur = state.messagesBySession[key] || { items: [], status: "idle", errorText: "" };
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [key]: { ...cur, items: cur.items.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)) }
        }
      };
    }

    default:
      return state;
  }
}

/**
 * PUBLIC_INTERFACE
 * Provider for global app state:
 * - sessions list + create/rename/delete wrappers over ApiClient
 * - message history per session (frontend-managed for now; no backend assumptions)
 * - small UI state (activeSessionId)
 */
export function AppStateProvider({ children }) {
  const { api } = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSessions = useCallback(async () => {
    dispatch({ type: "sessions/loading" });
    try {
      const data = await api.listSessions();
      if (!mountedRef.current) return;
      dispatch({ type: "sessions/ready", items: Array.isArray(data) ? data : [] });
    } catch (e) {
      if (!mountedRef.current) return;
      dispatch({ type: "sessions/error", errorText: e?.message || "Failed to load sessions" });
    }
  }, [api]);

  const createSession = useCallback(
    async (opts = {}) => {
      const tempId = `tmp-${makeId("s")}`;
      const tempSession = {
        id: tempId,
        title: (opts.title || "New chat").trim() || "New chat",
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        meta: "0 messages • Just now",
        _optimistic: true
      };
      dispatch({ type: "sessions/prepend", session: tempSession });
      dispatch({ type: "sessions/setBusy", id: tempId, isBusy: true });

      try {
        const created = await api.createSession({ title: tempSession.title });
        if (!mountedRef.current) return created;
        dispatch({
          type: "sessions/replaceOne",
          id: tempId,
          session: { ...created, meta: created.meta ?? formatSessionMeta(created) }
        });
        dispatch({ type: "sessions/setBusy", id: tempId, isBusy: false });
        return created;
      } catch (e) {
        if (!mountedRef.current) throw e;
        dispatch({ type: "sessions/remove", id: tempId });
        dispatch({ type: "sessions/setBusy", id: tempId, isBusy: false });
        throw e;
      }
    },
    [api]
  );

  const renameSession = useCallback(
    async (id, payload) => {
      const title = (payload?.title || "").trim();
      if (!title) throw new Error("Title is required");

      const prev = state.sessions.items;
      dispatch({ type: "sessions/patchOne", id, patch: { title } });
      dispatch({ type: "sessions/setBusy", id, isBusy: true });

      try {
        await api.renameSession(id, { title });
        if (!mountedRef.current) return;
        dispatch({ type: "sessions/setBusy", id, isBusy: false });
      } catch (e) {
        if (!mountedRef.current) return;
        // rollback
        dispatch({ type: "sessions/ready", items: prev });
        dispatch({ type: "sessions/setBusy", id, isBusy: false });
        throw e;
      }
    },
    [api, state.sessions.items]
  );

  const deleteSession = useCallback(
    async (id) => {
      const prev = state.sessions.items;
      dispatch({ type: "sessions/remove", id });
      dispatch({ type: "sessions/setBusy", id, isBusy: true });

      try {
        await api.deleteSession(id);
        if (!mountedRef.current) return;
        dispatch({ type: "sessions/setBusy", id, isBusy: false });
      } catch (e) {
        if (!mountedRef.current) return;
        // rollback
        dispatch({ type: "sessions/ready", items: prev });
        dispatch({ type: "sessions/setBusy", id, isBusy: false });
        throw e;
      }
    },
    [api, state.sessions.items]
  );

  const ensureSessionMessagesSeeded = useCallback(
    (sessionId) => {
      const key = getSessionKey(sessionId);
      if (state.messagesBySession[key]) return;

      dispatch({ type: "messages/init", sessionId });

      const now = new Date().toISOString();
      if (!sessionId) {
        dispatch({
          type: "messages/ready",
          sessionId,
          items: [
            {
              id: makeId("m"),
              role: "system",
              content: "Start a new chat. Your messages will stream in real time when the backend is available.",
              createdAt: now,
              status: "final"
            }
          ]
        });
      } else {
        dispatch({
          type: "messages/ready",
          sessionId,
          items: [
            {
              id: makeId("m"),
              role: "system",
              content: `Viewing session: ${sessionId}`,
              createdAt: now,
              status: "final"
            }
          ]
        });
      }
    },
    [state.messagesBySession]
  );

  const actions = useMemo(() => {
    return {
      loadSessions,
      createSession,
      renameSession,
      deleteSession,
      setActiveSessionId: (sessionId) => dispatch({ type: "ui/setActiveSession", sessionId }),
      ensureSessionMessagesSeeded,
      appendMessage: (sessionId, message) => dispatch({ type: "messages/append", sessionId, message }),
      replaceMessages: (sessionId, items) => dispatch({ type: "messages/replaceAll", sessionId, items }),
      updateMessage: (sessionId, id, patch) => dispatch({ type: "messages/updateOne", sessionId, id, patch })
    };
  }, [createSession, deleteSession, ensureSessionMessagesSeeded, loadSessions, renameSession]);

  return (
    <AppStateContext.Provider value={state}>
      <AppActionsContext.Provider value={actions}>{children}</AppActionsContext.Provider>
    </AppStateContext.Provider>
  );
}

/**
 * PUBLIC_INTERFACE
 * Hook to read global state.
 * @returns {AppState}
 */
export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within <AppStateProvider />");
  return ctx;
}

/**
 * PUBLIC_INTERFACE
 * Hook to access global actions.
 */
export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used within <AppStateProvider />");
  return ctx;
}
