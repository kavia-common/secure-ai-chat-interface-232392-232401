import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell/AppShell";
import { ToastProvider } from "./components/Toast/ToastProvider";
import { AppStateProvider } from "./state/AppStateContext";
import ChatPage from "./pages/ChatPage/ChatPage";
import SessionPage from "./pages/SessionPage/SessionPage";

/**
 * PUBLIC_INTERFACE
 */
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppStateProvider>
          <AppShell>
            <Routes>
              {/* Public landing */}
              <Route path="/" element={<ChatPage />} />

              {/* Protected session route */}
              <Route
                path="/sessions/:id"
                element={
                  <RequireAuth>
                    <SessionPage />
                  </RequireAuth>
                }
              />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </AppStateProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
