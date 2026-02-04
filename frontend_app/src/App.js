import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell/AppShell";
import ChatPage from "./pages/ChatPage/ChatPage";
import SessionPage from "./pages/SessionPage/SessionPage";

/**
 * PUBLIC_INTERFACE
 */
export default function App() {
  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}
