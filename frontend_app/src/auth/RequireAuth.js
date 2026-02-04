import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * PUBLIC_INTERFACE
 * Route guard:
 * - Allows navigation when a placeholder auth signal exists:
 *   - token OR tenant/user hint (for dev/demo)
 * - Otherwise redirects to "/" (landing) and sets `?next=<path>` for future continuation.
 */
export default function RequireAuth({ children }) {
  const location = useLocation();
  const { token, tenant, user, status } = useAuth();

  // While bootstrapping, don't bounce; render nothing (or could render a loader later).
  if (status === "bootstrapping") return null;

  const isAuthed = Boolean(token || tenant?.id || user?.id);
  if (isAuthed) return children;

  const next = `${location.pathname}${location.search || ""}${location.hash || ""}`;
  const qp = new URLSearchParams();
  qp.set("next", next);

  return <Navigate to={`/?${qp.toString()}`} replace />;
}
