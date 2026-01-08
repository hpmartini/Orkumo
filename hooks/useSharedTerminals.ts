import { useState, useCallback, useRef, useEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClaudeTerminalOptions, TerminalType } from '../types';

export interface TerminalTab {
  id: string;
  name: string;
  sessionId: string;
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  ws: WebSocket | null;
  connected: boolean;
  type: TerminalType;
  claudeOptions?: ClaudeTerminalOptions;
}

export interface SharedTerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  showLogsTab: boolean;
}

export interface SharedTerminalActions {
  setTabs: React.Dispatch<React.SetStateAction<TerminalTab[]>>;
  setActiveTabId: (id: string | null) => void;
  setShowLogsTab: (show: boolean) => void;
  createTab: (type?: TerminalType, name?: string) => string;
  createClaudeTerminal: (options: ClaudeTerminalOptions) => string;
  closeTab: (tabId: string) => void;
  switchToLogs: () => void;
}

/**
 * Hook to manage shared terminal state between Details and Coding views.
 * This ensures terminal sessions persist when switching views.
 */
export function useSharedTerminals(appId: string): [SharedTerminalState, SharedTerminalActions] {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showLogsTab, setShowLogsTab] = useState(true);

  // Track the app ID to reset state when switching apps
  const prevAppIdRef = useRef<string>(appId);

  // Reset state when app changes
  useEffect(() => {
    if (prevAppIdRef.current !== appId) {
      // Clean up old terminals
      tabs.forEach((tab) => {
        tab.ws?.close();
        tab.terminal?.dispose();
      });

      // Reset state
      setTabs([]);
      setActiveTabId(null);
      setShowLogsTab(true);
      prevAppIdRef.current = appId;
    }
  }, [appId, tabs]);

  const createTab = useCallback((type: TerminalType = 'shell', name?: string): string => {
    const tabId = `tab-${Date.now()}`;
    const sessionId = `session-${Date.now()}`;

    const newTab: TerminalTab = {
      id: tabId,
      name: name || `${type === 'claude' ? 'Claude' : 'Shell'} ${tabs.length + 1}`,
      sessionId,
      terminal: null,
      fitAddon: null,
      ws: null,
      connected: false,
      type,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setShowLogsTab(false);

    return tabId;
  }, [tabs.length]);

  const createClaudeTerminal = useCallback((options: ClaudeTerminalOptions): string => {
    const tabId = `tab-${Date.now()}`;
    const sessionId = `session-${Date.now()}`;
    const tabName = `Claude${options.continueSession ? ' (c)' : ''}`;

    const newTab: TerminalTab = {
      id: tabId,
      name: tabName,
      sessionId,
      terminal: null,
      fitAddon: null,
      ws: null,
      connected: false,
      type: 'claude',
      claudeOptions: options,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setShowLogsTab(false);

    return tabId;
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.ws?.close();
      tab.terminal?.dispose();
    }

    setTabs((prev) => prev.filter((t) => t.id !== tabId));

    if (activeTabId === tabId) {
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (remaining.length > 0) {
        setActiveTabId(remaining[remaining.length - 1].id);
      } else {
        setActiveTabId(null);
        setShowLogsTab(true);
      }
    }
  }, [tabs, activeTabId]);

  const switchToLogs = useCallback(() => {
    setActiveTabId(null);
    setShowLogsTab(true);
  }, []);

  const state: SharedTerminalState = {
    tabs,
    activeTabId,
    showLogsTab,
  };

  const actions: SharedTerminalActions = {
    setTabs,
    setActiveTabId,
    setShowLogsTab,
    createTab,
    createClaudeTerminal,
    closeTab,
    switchToLogs,
  };

  return [state, actions];
}
