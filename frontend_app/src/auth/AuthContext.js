import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../lib/api/client";

/**
 * @typedef {{
 *   id: string,
 *   email?: string,
 *   name?: string
 * }} AuthUser
 *
 * @typedef {{
 *   id: string,
 *   name?: string
 * }} AuthTenant
 *
 * @typedef {{
 *   token: string | null,
 *   user: AuthUser | null,
 *   tenant: AuthTenant | null,
 *   status: "idle" | "bootstrapping" | "ready",
 *   isOffline: boolean,
 *   errorText: string,
 *   api: ReturnType<typeof createApiClient>,
 *   setToken: (token: string | null) => void,
 *   setTenantHint: (tenantId: string | null) => void,
 *   setUserHint: (userId: string | null) => void,
 *   bootstrap: () => Promise<void>,
 *   signOut: () => void
 * }} AuthContextValue
 */

const STORAGE_KEYS = Object.freeze({
  token: "sai.auth.token",
  tenantId: "sai.auth.tenantId",
  userId: "sai.auth.userId"
});

const AuthContext = createContext(/** @type {AuthContextValue | null} */ (null));

/**
 * Read from localStorage safely (supports SSR/tests).
 * @param {string} key
 * @returns {string | null}
 */
function safeGet(key) {
  try {
    return window?.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Write to localStorage safely.
 * @param {string} key
 * @param {string | null} value
 */
function safeSet(key, value) {
  try {
    if (!window?.localStorage) return;
    if (value === null || value === undefined || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

/**
 * Create lightweight "hint" objects even when backend isn't available.
 * @param {string | null} userId
 * @param {string | null} tenantId
 * @returns {{ user: AuthUser | null, tenant: AuthTenant | null }}
 */
function buildHintEntities(userId, tenantId) {
  const user = userId ? { id: userId } : null;
  const tenant = tenantId ? { id: tenantId } : null;
  return { user, tenant };
}

/**
 * PUBLIC_INTERFACE
 * Provider for auth/session bootstrap and auth-aware ApiClient.
 *
 * Placeholder auth model:
 * - Reads a token from localStorage (sai.auth.token)
 * - Reads tenant/user "hint" IDs from localStorage (sai.auth.tenantId, sai.auth.userId)
 * - Bootstraps against backend if available (best-effort):
 *   - GET /me -> returns current user + tenant (if implemented)
 * - Graceful fallback:
 *   - If backend offline/unavailable, uses hint objects and keeps the UI functional (stub API fallback)
 */
export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => safeGet(STORAGE_KEYS.token));
  const [tenantHintId, setTenantHintIdState] = useState(() => safeGet(STORAGE_KEYS.tenantId));
  const [userHintId, setUserHintIdState] = useState(() => safeGet(STORAGE_KEYS.userId));

  const [user, setUser] = useState(/** @type {AuthUser | null} */ (null));
  const [tenant, setTenant] = useState(/** @type {AuthTenant | null} */ (null));
  const [status, setStatus] = useState(/** @type {"idle"|"bootstrapping"|"ready"} */ ("idle"));
  const [isOffline, setIsOffline] = useState(false);
  const [errorText, setErrorText] = useState("");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setToken = useCallback((nextToken) => {
    const v = nextToken ? String(nextToken) : null;
    setTokenState(v);
    safeSet(STORAGE_KEYS.token, v);
  }, []);

  const setTenantHint = useCallback((tenantId) => {
    const v = tenantId ? String(tenantId) : null;
    setTenantHintIdState(v);
    safeSet(STORAGE_KEYS.tenantId, v);
  }, []);

  const setUserHint = useCallback((userId) => {
    const v = userId ? String(userId) : null;
    setUserHintIdState(v);
    safeSet(STORAGE_KEYS.userId, v);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setTenantHint(null);
    setUserHint(null);
    setUser(null);
    setTenant(null);
    setErrorText("");
    setIsOffline(false);
    setStatus("ready");
  }, [setToken, setTenantHint, setUserHint]);

  const api = useMemo(() => {
    // NOTE: ApiClient is already built with "stub fallback" for many endpoints, so this is safe even offline.
    return createApiClient({
      getAuthToken: () => token,
      extraHeaders: () => {
        /** @type {Record<string,string>} */
        const headers = {};
        if (tenantHintId) headers["X-Tenant-Id"] = tenantHintId;
        if (userHintId) headers["X-User-Id"] = userHintId;
        return headers;
      }
    });
  }, [token, tenantHintId, userHintId]);

  const bootstrap = useCallback(async () => {
    setStatus("bootstrapping");
    setErrorText("");

    // Seed with hints immediately so the UI can show a "logged-in-ish" state even if backend is offline.
    const hints = buildHintEntities(userHintId, tenantHintId);
    setUser(hints.user);
    setTenant(hints.tenant);

    // If browser reports offline, skip fetch attempts.
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
      setIsOffline(true);
      setStatus("ready");
      return;
    }

    // Best-effort: try calling a conventional /me endpoint (may not exist yet).
    // If it fails, mark offline and keep hint entities.
    try {
      const data = await api.requestJson("/me", { method: "GET", timeoutMs: 7_500 });
      if (!mountedRef.current) return;

      if (data && typeof data === "object") {
        const backendUser = data.user ?? data.me ?? data.currentUser ?? null;
        const backendTenant = data.tenant ?? data.currentTenant ?? null;

        if (backendUser && typeof backendUser === "object") {
          const id = backendUser.id ?? backendUser.userId ?? backendUser.sub;
          setUser(id ? { id: String(id), email: backendUser.email, name: backendUser.name } : hints.user);
          if (id) setUserHint(String(id));
        }

        if (backendTenant && typeof backendTenant === "object") {
          const id = backendTenant.id ?? backendTenant.tenantId;
          setTenant(id ? { id: String(id), name: backendTenant.name } : hints.tenant);
          if (id) setTenantHint(String(id));
        }
      }

      setIsOffline(false);
      setStatus("ready");
    } catch (e) {
      if (!mountedRef.current) return;
      setIsOffline(true);
      setStatus("ready");
      setErrorText(""); // keep quiet; offline is expected during development
    }
  }, [api, tenantHintId, userHintId, setTenantHint, setUserHint]);

  // App-load bootstrap.
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // React to online/offline changes.
  useEffect(() => {
    const onOnline = () => {
      if (!mountedRef.current) return;
      setIsOffline(false);
      // Re-bootstrap when connection returns to refresh /me if available.
      bootstrap();
    };
    const onOffline = () => {
      if (!mountedRef.current) return;
      setIsOffline(true);
    };

    window?.addEventListener?.("online", onOnline);
    window?.addEventListener?.("offline", onOffline);
    return () => {
      window?.removeEventListener?.("online", onOnline);
      window?.removeEventListener?.("offline", onOffline);
    };
  }, [bootstrap]);

  const value = useMemo(
    () => ({
      token,
      user,
      tenant,
      status,
      isOffline,
      errorText,
      api,
      setToken,
      setTenantHint,
      setUserHint,
      bootstrap,
      signOut
    }),
    [token, user, tenant, status, isOffline, errorText, api, setToken, setTenantHint, setUserHint, bootstrap, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * PUBLIC_INTERFACE
 * Hook to access auth state and the configured ApiClient.
 * @returns {AuthContextValue}
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider />");
  }
  return ctx;
}
