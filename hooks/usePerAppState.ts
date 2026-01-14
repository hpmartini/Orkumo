import { useState, useCallback } from 'react';
import { PerAppViewState, DEFAULT_PER_APP_STATE, EditorType, DevToolsTab, ConsoleFilter } from '../types';
import type { TerminalTab } from './useSharedTerminals';

/**
 * Manages per-app terminal state (including XTerm instances).
 * This is separate from PerAppViewState because terminal tabs contain
 * non-serializable objects (XTerm instances, WebSockets).
 */
export interface PerAppTerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  showLogsTab: boolean;
}

const DEFAULT_TERMINAL_STATE: PerAppTerminalState = {
  tabs: [],
  activeTabId: null,
  showLogsTab: true,
};

/**
 * Hook to manage per-app view state.
 * Stores view preferences (editor type, devtools visibility, etc.) per app ID.
 */
export function usePerAppState() {
  // Map of app ID -> view state
  const [stateMap, setStateMap] = useState<Map<string, PerAppViewState>>(new Map());

  // Map of app ID -> terminal state (separate due to non-serializable XTerm instances)
  const [terminalStateMap, setTerminalStateMap] = useState<Map<string, PerAppTerminalState>>(new Map());

  /**
   * Get the view state for a specific app (returns defaults if not set)
   */
  const getAppState = useCallback((appId: string): PerAppViewState => {
    return stateMap.get(appId) ?? DEFAULT_PER_APP_STATE;
  }, [stateMap]);

  /**
   * Get the terminal state for a specific app
   */
  const getTerminalState = useCallback((appId: string): PerAppTerminalState => {
    return terminalStateMap.get(appId) ?? DEFAULT_TERMINAL_STATE;
  }, [terminalStateMap]);

  /**
   * Update the view state for a specific app
   */
  const updateAppState = useCallback((appId: string, updates: Partial<PerAppViewState>) => {
    setStateMap(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(appId) ?? DEFAULT_PER_APP_STATE;
      newMap.set(appId, { ...current, ...updates });
      return newMap;
    });
  }, []);

  /**
   * Update the terminal state for a specific app
   */
  const updateTerminalState = useCallback((appId: string, updates: Partial<PerAppTerminalState>) => {
    setTerminalStateMap(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(appId) ?? DEFAULT_TERMINAL_STATE;
      newMap.set(appId, { ...current, ...updates });
      return newMap;
    });
  }, []);

  /**
   * Create helpers for a specific app to pass down as props
   */
  const createAppStateHelpers = useCallback((appId: string) => {
    const state = stateMap.get(appId) ?? DEFAULT_PER_APP_STATE;
    const terminalState = terminalStateMap.get(appId) ?? DEFAULT_TERMINAL_STATE;

    return {
      // View state
      editorType: state.editorType,
      showDevTools: state.showDevTools,
      devToolsTab: state.devToolsTab,
      consoleFilter: state.consoleFilter,
      isBrowserHidden: state.isBrowserHidden,

      // View state setters
      setEditorType: (value: EditorType) => updateAppState(appId, { editorType: value }),
      setShowDevTools: (value: boolean) => updateAppState(appId, { showDevTools: value }),
      setDevToolsTab: (value: DevToolsTab) => updateAppState(appId, { devToolsTab: value }),
      setConsoleFilter: (value: ConsoleFilter) => updateAppState(appId, { consoleFilter: value }),
      setIsBrowserHidden: (value: boolean) => updateAppState(appId, { isBrowserHidden: value }),

      // Terminal state
      terminalTabs: terminalState.tabs,
      activeTerminalTabId: terminalState.activeTabId,
      showLogsTab: terminalState.showLogsTab,

      // Terminal state setters
      setTerminalTabs: (tabs: TerminalTab[] | ((prev: TerminalTab[]) => TerminalTab[])) => {
        setTerminalStateMap(prev => {
          const newMap = new Map(prev);
          const current = newMap.get(appId) ?? DEFAULT_TERMINAL_STATE;
          const newTabs = typeof tabs === 'function' ? tabs(current.tabs) : tabs;
          newMap.set(appId, { ...current, tabs: newTabs });
          return newMap;
        });
      },
      setActiveTerminalTabId: (id: string | null) => updateTerminalState(appId, { activeTabId: id }),
      setShowLogsTab: (show: boolean) => updateTerminalState(appId, { showLogsTab: show }),
    };
  }, [stateMap, terminalStateMap, updateAppState, updateTerminalState]);

  return {
    getAppState,
    getTerminalState,
    updateAppState,
    updateTerminalState,
    createAppStateHelpers,
  };
}

export type PerAppStateHelpers = ReturnType<ReturnType<typeof usePerAppState>['createAppStateHelpers']>;
