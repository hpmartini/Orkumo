import { useCallback, useEffect, useState } from 'react';
import type { AgentSession } from '../types';
import {
  fetchChats,
  startChat,
  stopChat,
  sendChatMessage,
  type ChatStartRequest,
  type ChatSummary,
} from '../services/agentsApi';

/** Chat summary → pane session (the Chat pane reads id, name, cwd) */
const toSession = (c: ChatSummary): AgentSession => ({
  id: c.id,
  sessionId: c.sessionId,
  kind: 'interactive',
  chat: true,
  cwd: c.cwd,
  startedAt: c.startedAt,
  name: c.name,
  state: null,
  pinned: false,
  order: null,
  links: [],
  displayState: 'idle',
});

/**
 * Chat sessions (#189) run on the server; the list is loaded once so tabs restored from
 * localStorage reconnect after a reload. `loaded` gates tab pruning until then.
 */
export function useChatSessions() {
  const [chats, setChats] = useState<AgentSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchChats()
      .then((list) => !cancelled && setChats(list.map(toSession)))
      .catch(() => {
        /* server without chat support: no chats */
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Starts a chat and sends `firstMessage` once the process is up; returns the pane id */
  const open = useCallback(async (body: ChatStartRequest, firstMessage?: string) => {
    const summary = await startChat(body);
    setChats((prev) => [...prev, toSession(summary)]);
    if (firstMessage) await sendChatMessage(summary.id, firstMessage);
    return summary.id;
  }, []);

  const isChat = useCallback((id: string) => chats.some((c) => c.id === id), [chats]);

  /** Ends the chat process (pane closed, tab closed, handed to the terminal) */
  const stop = useCallback((id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    return stopChat(id).catch(() => ({ stopped: false }));
  }, []);

  return { chats, loaded, open, isChat, stop };
}
