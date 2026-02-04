import React from "react";
import { useParams } from "react-router-dom";
import ChatView from "../../components/ChatView/ChatView";

/**
 * PUBLIC_INTERFACE
 */
export default function SessionPage() {
  const { id } = useParams();

  return <ChatView sessionId={id || null} />;
}
