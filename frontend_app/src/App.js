import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell/AppShell";
import ChatPage from "./pages/ChatPage/ChatPage";
import SessionPage from "./pages/SessionPage/SessionPage";

/**
 * PUBLIC_INTERFACE
 */
export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
