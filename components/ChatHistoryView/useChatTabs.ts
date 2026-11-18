import { useEffect, useMemo, useState } from 'react';
import type { AgentSession } from '@hpmartini/agents-ui/types';
import {
  activateTab,
  browserUrl,
  closeSession,
  closeTab,
  detachSession,
  focusSession,
  moveTab,
  openBrowser,
  openSession,
  setTabLayout,
  splitInto,
  type DropZone,
  type PaneLayout,
  type Workspace,
} from '@hpmartini/agents-ui/utils/agentWorkspace';

/** Open chats, their tabs and splits; separate from the Agents workspace */
export const CHAT_TABS_KEY = 'orkumoChatTabs.v1';
const PREFIX = 'history:';

export const historyPaneId = (chatId: string) => `${PREFIX}${chatId}`;
/** Conversation id of a chat pane, null for other panes (browser) */
export const historyChatId = (paneId: string) =>
  paneId.startsWith(PREFIX) ? paneId.slice(PREFIX.length) : null;

interface Stored {
  workspace: Workspace;
  /** Tab titles of open chats */
  titles: Record<string, string>;
}

const EMPTY: Stored = { workspace: { tabs: [], activeTabId: null }, titles: {} };

function load(): Stored {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_TABS_KEY) ?? 'null');
    return Array.isArray(stored?.workspace?.tabs) ? stored : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Stand-in session for a chat pane: tab strip, titles and drag treat it like an agent pane */
const chatSession = (paneId: string, title: string): AgentSession => ({
  id: paneId,
  sessionId: null,
  kind: 'interactive',
  cwd: title,
  startedAt: 0,
  name: title,
  state: null,
  pinned: false,
  order: null,
  links: [],
  displayState: 'idle',
});

/**
 * Chats mode tabs: every chat in a tab of its own, tiled like agent sessions by the same
 * reducers; a provider page opens as a browser pane next to its chat.
 */
export function useChatTabs() {
  const [{ workspace, titles }, setState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_TABS_KEY, JSON.stringify({ workspace, titles }));
    } catch {
      // storage unavailable: tabs just do not survive a reload
    }
  }, [workspace, titles]);

  const actions = useMemo(() => {
    const apply = (fn: (ws: Workspace) => Workspace) =>
      setState((s) => ({ ...s, workspace: fn(s.workspace) }));
    return {
      open: (chatId: string, title: string) =>
        setState((s) => ({
          workspace: openSession(s.workspace, historyPaneId(chatId)),
          titles: { ...s.titles, [chatId]: title },
        })),
      retitle: (chatId: string, title: string) =>
        setState((s) => ({ ...s, titles: { ...s.titles, [chatId]: title } })),
      /** Shows `url` in the browser pane of `fromId`'s tab; an open page is only focused */
      openSite: (fromId: string, url: string) =>
        apply((ws) => {
          const open = ws.tabs.flatMap((t) => t.panes).find((p) => browserUrl(p) === url);
          return open ? focusSession(ws, open) : openBrowser(ws, fromId, url);
        }),
      focus: (id: string) => apply((ws) => focusSession(ws, id)),
      activateTab: (tabId: string) => apply((ws) => activateTab(ws, tabId)),
      close: (id: string) => apply((ws) => closeSession(ws, id)),
      closeTab: (tabId: string) => apply((ws) => closeTab(ws, tabId)),
      split: (id: string, targetId: string, zone: DropZone) =>
        apply((ws) => splitInto(ws, id, targetId, zone)),
      detach: (id: string) => apply((ws) => detachSession(ws, id)),
      moveTab: (tabId: string, targetId: string, position: 'before' | 'after') =>
        apply((ws) => moveTab(ws, tabId, targetId, position)),
      setLayout: (tabId: string, layout: PaneLayout) =>
        apply((ws) => setTabLayout(ws, tabId, layout)),
    };
  }, []);

  const sessions = useMemo(
    () =>
      workspace.tabs
        .flatMap((t) => t.panes)
        .flatMap((id) => {
          const chatId = historyChatId(id);
          return chatId === null ? [] : [chatSession(id, titles[chatId] ?? 'Chat')];
        }),
    [workspace.tabs, titles]
  );
  const activeTab = workspace.tabs.find((t) => t.id === workspace.activeTabId);
  /** Conversation of the focused pane: the list marks it */
  const current = activeTab ? historyChatId(activeTab.activeSessionId) : null;

  return { workspace, sessions, current, ...actions };
}
