import React, { useMemo, useState } from "react";
import ChatView from "../../components/ChatView/ChatView";
import { useAuth } from "../../auth/AuthContext";

/**
 * PUBLIC_INTERFACE
 */
export default function ChatPage() {
  const { status, isOffline, token, tenant, user, setToken, setTenantHint, setUserHint, signOut } = useAuth();

  // Small local inputs for demo/dev hints.
  const [tenantIdDraft, setTenantIdDraft] = useState("");
  const [userIdDraft, setUserIdDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");

  const effective = useMemo(() => {
    return {
      tenantId: tenant?.id || "",
      userId: user?.id || "",
      hasAuthSignal: Boolean(token || tenant?.id || user?.id)
    };
  }, [tenant?.id, user?.id, token]);

  return (
    <>
      <div style={{ padding: "14px 18px 0" }}>
        <div
          className="kv-surface"
          style={{
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12
          }}
          aria-label="Auth bootstrap status"
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 12 }}>
              {status === "bootstrapping" ? "Bootstrapping session…" : effective.hasAuthSignal ? "Auth hints loaded" : "Landing"}
              {isOffline ? " (offline)" : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 4, lineHeight: 1.35 }}>
              Tenant: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{effective.tenantId || "—"}</span>
              {" • "}
              User: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{effective.userId || "—"}</span>
              {" • "}
              Token: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{token ? "set" : "—"}</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <input
              value={tenantIdDraft}
              onChange={(e) => setTenantIdDraft(e.target.value)}
              placeholder="tenantId hint"
              aria-label="Tenant ID hint"
              style={{
                height: 32,
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                padding: "0 10px",
                width: 140
              }}
            />
            <input
              value={userIdDraft}
              onChange={(e) => setUserIdDraft(e.target.value)}
              placeholder="userId hint"
              aria-label="User ID hint"
              style={{
                height: 32,
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                padding: "0 10px",
                width: 140
              }}
            />
            <input
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="token (optional)"
              aria-label="Auth token"
              style={{
                height: 32,
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                padding: "0 10px",
                width: 160
              }}
            />
            <button
              className="kv-btn kv-btn-primary"
              type="button"
              onClick={() => {
                // Apply drafts only if provided; allows setting hints without token.
                setTenantHint(tenantIdDraft.trim() || null);
                setUserHint(userIdDraft.trim() || null);
                setToken(tokenDraft.trim() || null);
              }}
              aria-label="Save auth hints"
              disabled={status === "bootstrapping"}
              title="Saves hints into localStorage"
            >
              Save hints
            </button>
            <button className="kv-btn" type="button" onClick={signOut} aria-label="Clear auth hints" title="Clears localStorage hints">
              Clear
            </button>
          </div>
        </div>
      </div>

      <ChatView sessionId={null} />
    </>
  );
}
