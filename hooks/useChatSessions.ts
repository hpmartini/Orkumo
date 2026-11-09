import { useCallback, useEffect, useState } from 'react';
import type { AgentSession } from '../types';
import {
  fetchChats,
  startChat,
  viewAgentAsChat,
  stopChat,
  sendChatMessage,
  type ChatStartRequest,
  type ChatSummary,
} from '../services/agentsApi';
import { targetOf, useAgentTarget } from '../utils/agentTarget';

/** Chat summary → pane session (the Chat pane reads id, name, cwd) */
const toSession = (c: ChatSummary): AgentSession => ({
  id: c.id,
  sessionId: c.sessionId,
  kind: 'interactive',
  chat: true,
  viewOf: c.view ?? null,
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
  // #220: reloaded per picked instance; chats of other instances stay (their tabs are open)
  const target = useAgentTarget();

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    fetchChats()
      .then(
        (list) =>
          !cancelled &&
          setChats((prev) => [
            ...prev.filter((c) => targetOf(c.id) !== target),
            ...list.map(toSession),
          ])
      )
      .catch(() => {
        /* server without chat support: no chats */
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [target]);

  /** Starts a chat and sends `firstMessage` once the process is up; returns the pane id */
  const open = useCallback(async (body: ChatStartRequest, firstMessage?: string) => {
    const summary = await startChat(body);
    setChats((prev) => [...prev, toSession(summary)]);
    if (firstMessage) await sendChatMessage(summary.id, firstMessage);
    return summary.id;
  }, []);

  /** Opens (or reuses) the live chat view of an agent; returns the pane id */
  const openView = useCallback(async (agentId: string) => {
    const summary = await viewAgentAsChat(agentId);
    setChats((prev) =>
      prev.some((c) => c.id === summary.id) ? prev : [...prev, toSession(summary)]
    );
    return summary.id;
  }, []);

  const isChat = useCallback((id: string) => chats.some((c) => c.id === id), [chats]);

  /** Ends the chat process (pane closed, tab closed, handed to the terminal) */
  const stop = useCallback((id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    return stopChat(id).catch(() => ({ stopped: false }));
  }, []);

  return { chats, loaded, open, openView, isChat, stop };
}
