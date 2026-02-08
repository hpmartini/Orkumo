import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Plus, X, RefreshCw, Bot } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ClaudeTerminalModal } from './ClaudeTerminalModal';
import { parseAnsiToReact } from '../utils/ansiParser';
import { getWsUrl as getApiWsUrl, API_BASE_URL } from '../utils/apiConfig';
import type { ClaudeTerminalOptions, ClaudeCLIInfo, TerminalType } from '../types';

interface TerminalTab {
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

// Export TerminalTab type for shared state
export type { TerminalTab };

interface XTerminalProps {
  /** Working directory for new terminals */
  cwd?: string;
  /** App logs to display in the first tab (output-only mode) */
  logs?: string[];
  /** Whether the app is currently running */
  isRunning?: boolean;
  /** Optional shared terminal state (for persistence across views) */
  sharedState?: {
    tabs: TerminalTab[];
    activeTabId: string | null;
    showLogsTab: boolean;
  };
  /** Optional shared actions (for persistence across views) */
  sharedActions?: {
    setTabs: React.Dispatch<React.SetStateAction<TerminalTab[]>>;
    setActiveTabId: (id: string | null) => void;
    setShowLogsTab: (show: boolean) => void;
    // These are optional - if not provided, internal implementations are used
    createTab?: (type?: TerminalType, name?: string) => string;
    createClaudeTerminal?: (options: ClaudeTerminalOptions) => string;
    closeTab?: (tabId: string) => void;
    switchToLogs?: () => void;
  };
}

// WebSocket URL - use centralized config
const getWsUrl = () => getApiWsUrl('/api/pty');

/**
 * Build WebSocket URL with terminal configuration parameters
 * @param sessionId - Unique session identifier
 * @param cwd - Working directory
 * @param cols - Terminal columns
 * @param rows - Terminal rows
 * @param tab - Optional terminal tab for Claude-specific options
 * @returns Formatted WebSocket URL with all parameters
 */
const buildWebSocketUrl = (
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
  tab?: Pick<TerminalTab, 'type' | 'claudeOptions'>
): string => {
  let wsUrl = `${getWsUrl()}?sessionId=${sessionId}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;

  // Add Claude-specific parameters if this is a Claude terminal
  if (tab?.type === 'claude' && tab.claudeOptions) {
    const args: string[] = [];

    if (tab.claudeOptions.continueSession) {
      args.push('-c');
    }

    if (tab.claudeOptions.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    try {
      wsUrl += `&command=claude&args=${encodeURIComponent(JSON.stringify(args))}`;
    } catch (error) {
      console.error('Failed to serialize Claude options:', error);
      throw new Error('Failed to create Claude terminal session');
    }
  }

  return wsUrl;
};

export const XTerminal: React.FC<XTerminalProps> = ({
  cwd = '~',
  logs = [],
  isRunning = false,
  sharedState,
  sharedActions,
}) => {
  // Use shared state if provided, otherwise use local state
  const [localTabs, setLocalTabs] = useState<TerminalTab[]>([]);
  const [localActiveTabId, setLocalActiveTabId] = useState<string | null>(null);
  const [localShowLogsTab, setLocalShowLogsTab] = useState(true);

  // Determine which state to use
  const tabs = sharedState?.tabs ?? localTabs;
  const activeTabId = sharedState?.activeTabId ?? localActiveTabId;
  const showLogsTab = sharedState?.showLogsTab ?? localShowLogsTab;
  const setTabs = sharedActions?.setTabs ?? setLocalTabs;
  const setActiveTabId = sharedActions?.setActiveTabId ?? setLocalActiveTabId;
  const setShowLogsTab = sharedActions?.setShowLogsTab ?? setLocalShowLogsTab;

  const [claudeModalOpen, setClaudeModalOpen] = useState(false);
  const [claudeInfo, setClaudeInfo] = useState<ClaudeCLIInfo>({
    installed: false,
  });
  const terminalAreaRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);

  // Keep refs in sync for ResizeObserver and cleanup
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Note: Terminal state is now managed per-app at the parent level via sharedState/sharedActions.
  // When switching apps, the parent provides different state, preserving each app's terminals.

  // Check Claude CLI status on mount
  useEffect(() => {
    let mounted = true;

    fetch(`${API_BASE_URL}/claude-cli/status`)
      .then((res) => res.json())
      .then((data) => {
        if (mounted) {
          setClaudeInfo(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setClaudeInfo({ installed: false, error: 'Failed to check CLI status' });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (showLogsTab && !activeTabId && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogsTab, activeTabId]);

  // Create a new terminal tab
  const createTab = useCallback(
    (type: TerminalType = 'shell', name?: string) => {
      // Use shared action if available
      if (sharedActions?.createTab) {
        sharedActions.createTab(type, name);
        return;
      }

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
    },
    [tabs.length, sharedActions, setTabs, setActiveTabId, setShowLogsTab]
  );

  // Create a Claude Code terminal
  const createClaudeTerminal = useCallback(
    (options: ClaudeTerminalOptions) => {
      // Use shared action if available
      if (sharedActions?.createClaudeTerminal) {
        sharedActions.createClaudeTerminal(options);
        setClaudeModalOpen(false);
        return;
      }

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
      setClaudeModalOpen(false);
    },
    [sharedActions, setTabs, setActiveTabId, setShowLogsTab]
  );

  /**
   * Check if a terminal instance is still valid and attached to DOM
   */
  const isTerminalValid = useCallback((terminal: XTerm | null): boolean => {
    if (!terminal) return false;
    try {
      // Check if terminal's element is still in DOM
      // A disposed terminal or one from a previous mount will fail this check
      const element = terminal.element;
      return element !== null && element !== undefined && document.body.contains(element);
    } catch {
      // If accessing element throws, terminal is not valid
      return false;
    }
  }, []);

  // Initialize terminal for a tab
  const initializeTerminal = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // Check if terminal is valid (not just truthy - it might be a stale reference)
      if (isTerminalValid(tab.terminal)) return;

      // If tab has stale terminal reference, dispose it first
      if (tab.terminal) {
        try {
          tab.terminal.dispose();
        } catch {
          // Ignore dispose errors on stale terminals
        }
        // Clear the stale reference
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, terminal: null, fitAddon: null, ws: null } : t))
        );
      }

      // Find the container for this specific tab
      const container = document.querySelector(`[data-terminal-id="${tabId}"]`) as HTMLElement;
      if (!container) return;

      // Create xterm instance with proper configuration for reflow support
      const terminal = new XTerm({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
        scrollback: 5000, // Enable scrollback buffer for reflow to work properly
        theme: {
          background: '#0a0a0f',
          foreground: '#e4e4e7',
          cursor: '#60a5fa',
          cursorAccent: '#0a0a0f',
          selectionBackground: '#3b82f680',
          black: '#18181b',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#e4e4e7',
          brightBlack: '#52525b',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#fafafa',
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      // Mount terminal to the tab-specific container
      terminal.open(container);
      fitAddon.fit();

      // Build WebSocket URL using helper function
      let wsUrl: string;
      try {
        wsUrl = buildWebSocketUrl(tab.sessionId, cwd, terminal.cols, terminal.rows, tab);
      } catch (error) {
        console.error('Failed to build WebSocket URL:', error);
        terminal.write('\x1b[1;31mError: Failed to create terminal session\x1b[0m\r\n');
        return;
      }

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, connected: true } : t)));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'output':
              terminal.write(data.data);
              break;
            case 'connected':
              terminal.write(`\x1b[2m# Connected to ${data.shell} (PID: ${data.pid})\x1b[0m\r\n`);
              break;
            case 'exit':
              terminal.write(`\r\n\x1b[2m# Process exited (code: ${data.exitCode})\x1b[0m\r\n`);
              setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, connected: false } : t)));
              break;
            case 'error':
              terminal.write(`\x1b[31mError: ${data.message}\x1b[0m\r\n`);
              break;
          }
        } catch {
          // Raw output
          terminal.write(event.data);
        }
      };

      ws.onclose = () => {
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, connected: false } : t)));
      };

      ws.onerror = () => {
        terminal.write('\x1b[31mWebSocket connection error\x1b[0m\r\n');
      };

      // Send terminal input to WebSocket
      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Handle Shift+Enter to insert newline (needed for Claude Code CLI)
      // Uses CSI u encoding: \x1b[13;2u = Shift+Enter
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: '\x1b[13;2u' }));
          }
          return false; // Prevent default handling
        }
        return true; // Allow all other keys
      });

      // Handle terminal resize events - this fires when terminal dimensions actually change
      // This is the proper way to sync PTY dimensions with xterm
      terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols,
              rows,
            })
          );
        }
      });

      // Update tab with terminal instance
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, terminal, fitAddon, ws } : t)));
    },
    [tabs, cwd, isTerminalValid, setTabs]
  );

  // Initialize terminal when tab becomes active
  useEffect(() => {
    if (activeTabId) {
      const tab = tabs.find((t) => t.id === activeTabId);
      // Use isTerminalValid to check for stale terminal references from previous mounts
      if (tab && !isTerminalValid(tab.terminal)) {
        // Use requestAnimationFrame to ensure DOM is ready after layout
        // The container div is rendered based on tabs array, so we need to wait
        const rafId = requestAnimationFrame(() => {
          initializeTerminal(activeTabId);
        });
        return () => cancelAnimationFrame(rafId);
      }
    }
  }, [activeTabId, tabs, initializeTerminal, isTerminalValid]);

  // Handle resize - uses refs to always get current values in ResizeObserver callback
  // The terminal.onResize handler (set during initialization) handles syncing with PTY
  useEffect(() => {
    if (!terminalAreaRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const triggerFit = () => {
      // Debounce resize events to prevent overwhelming the system
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = setTimeout(() => {
        // Use refs to get current values (avoids stale closure issues)
        const currentActiveTabId = activeTabIdRef.current;
        const currentTabs = tabsRef.current;
        const activeTab = currentTabs.find((t) => t.id === currentActiveTabId);

        if (activeTab?.fitAddon && activeTab?.terminal) {
          try {
            // Call fit() which will trigger terminal.onResize event
            // The onResize handler will sync dimensions with PTY
            activeTab.fitAddon.fit();
          } catch {
            // Ignore resize errors
          }
        }
      }, 50); // 50ms debounce for smoother resizing
    };

    resizeObserverRef.current = new ResizeObserver(triggerFit);
    resizeObserverRef.current.observe(terminalAreaRef.current);

    // Also listen for window resize events (triggered by CodingView panel show/hide)
    window.addEventListener('resize', triggerFit);

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserverRef.current?.disconnect();
      window.removeEventListener('resize', triggerFit);
    };
  }, []); // Empty deps - observer created once on mount, uses refs for current values

  // Cleanup on unmount - dispose terminals when component is truly unmounted
  // (e.g., when switching to a different app, not when switching views)
  useEffect(() => {
    return () => {
      // Use ref to get current tabs without dependency issues
      const currentTabs = tabsRef.current;
      currentTabs.forEach((tab) => {
        tab.ws?.close();
        tab.terminal?.dispose();
      });
    };
  }, []); // Empty deps - only runs on actual unmount

  // Close a tab
  const closeTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();

      // Clean up terminal resources
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        tab.ws?.close();
        tab.terminal?.dispose();
      }

      // Use shared action if available
      if (sharedActions?.closeTab) {
        sharedActions.closeTab(tabId);
        return;
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
    },
    [tabs, activeTabId, sharedActions, setTabs, setActiveTabId, setShowLogsTab]
  );

  // Switch to logs tab
  const switchToLogs = useCallback(() => {
    if (sharedActions?.switchToLogs) {
      sharedActions.switchToLogs();
      return;
    }
    setActiveTabId(null);
    setShowLogsTab(true);
  }, [sharedActions, setActiveTabId, setShowLogsTab]);

  // Reconnect a tab
  const reconnectTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || !tab.terminal) return;

      // Close existing connection
      tab.ws?.close();

      // Create new session
      const newSessionId = `session-${Date.now()}`;

      // Build WebSocket URL using helper function
      let wsUrl: string;
      try {
        wsUrl = buildWebSocketUrl(newSessionId, cwd, tab.terminal.cols, tab.terminal.rows, tab);
      } catch (error) {
        console.error('Failed to build WebSocket URL on reconnect:', error);
        tab.terminal.write('\x1b[1;31mError: Failed to reconnect terminal\x1b[0m\r\n');
        return;
      }

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, sessionId: newSessionId, ws, connected: true } : t
          )
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
            tab.terminal?.write(data.data);
          } else if (data.type === 'connected') {
            tab.terminal?.write(`\x1b[2m# Reconnected to ${data.shell}\x1b[0m\r\n`);
          }
        } catch {
          tab.terminal?.write(event.data);
        }
      };

      ws.onclose = () => {
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, connected: false } : t)));
      };

      // Rebind terminal input
      tab.terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Rebind resize handler
      tab.terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols,
              rows,
            })
          );
        }
      });

      // Rebind Shift+Enter handler
      tab.terminal.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: '\x1b[13;2u' }));
          }
          return false;
        }
        return true;
      });
    },
    [tabs, cwd]
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 shadow-inner overflow-hidden flex flex-col h-full">
      {/* Tab bar */}
      <div className="bg-gray-900 px-2 py-1 border-b border-gray-800 flex items-center gap-1 shrink-0 overflow-x-auto">
        {/* Logs tab */}
        <button
          onClick={switchToLogs}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono transition-colors shrink-0 ${
            showLogsTab && !activeTabId
              ? 'bg-gray-800 text-white'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
          }`}
        >
          <TerminalIcon size={12} />
          <span>Output</span>
          {isRunning && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />}
        </button>

        {/* Terminal tabs */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActiveTabId(tab.id);
              setShowLogsTab(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setActiveTabId(tab.id);
                setShowLogsTab(false);
              }
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono transition-colors group shrink-0 cursor-pointer ${
              activeTabId === tab.id
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            {tab.type === 'claude' ? (
              <Bot size={12} className="text-blue-400" />
            ) : (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  tab.connected ? 'bg-emerald-500' : 'bg-gray-600'
                }`}
              />
            )}
            <span>{tab.name}</span>
            <button
              onClick={(e) => closeTab(tab.id, e)}
              className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* Add tab button */}
        <button
          onClick={() => createTab()}
          className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 rounded-md transition-colors shrink-0"
          title="New terminal"
        >
          <Plus size={14} />
        </button>

        {/* Claude Code button */}
        <button
          onClick={() => setClaudeModalOpen(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-blue-600/20 hover:border-blue-500/50 border border-transparent rounded transition-colors shrink-0"
          title={claudeInfo.installed ? 'Open Claude Code terminal' : 'Claude CLI not installed'}
        >
          <Bot size={12} />
          <span>Claude</span>
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Reconnect button for active tab */}
        {activeTab && !activeTab.connected && (
          <button
            onClick={() => reconnectTab(activeTab.id)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
          >
            <RefreshCw size={12} />
            Reconnect
          </button>
        )}

        {/* Line count for logs tab */}
        {showLogsTab && !activeTabId && logs.length > 0 && (
          <span className="text-xs text-gray-600 font-mono px-2">{logs.length} lines</span>
        )}
      </div>

      {/* Terminal content area */}
      <div ref={terminalAreaRef} className="flex-1 relative overflow-hidden">
        {/* Logs view (output only) */}
        <div
          ref={logsContainerRef}
          className={`absolute inset-0 overflow-y-auto scrollbar-hide font-mono text-xs md:text-sm p-2 ${
            showLogsTab && !activeTabId ? 'block' : 'hidden'
          }`}
          style={{ backgroundColor: '#0a0a0f' }}
        >
          {logs.length === 0 ? (
            <div className="p-2 text-gray-600 italic">
              No output yet... start the application to see logs.
            </div>
          ) : (
            <>
              {logs.map((log, idx) => {
                // Check for special log types (these override ANSI colors for consistency)
                const lowerLog = log.toLowerCase();
                const isError =
                  lowerLog.includes('[error]') ||
                  lowerLog.includes('error:') ||
                  (lowerLog.includes('failed') && !lowerLog.includes('✗'));
                const isWarning = lowerLog.includes('[warn]') || lowerLog.includes('warning:');

                // Base container class
                const containerClass = isError
                  ? 'bg-red-950/20'
                  : isWarning
                    ? 'bg-yellow-950/10'
                    : '';

                return (
                  <div
                    key={idx}
                    className={`px-2 py-0.5 break-all text-gray-300 ${containerClass}`}
                  >
                    {parseAnsiToReact(log, idx)}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        {/* XTerm containers - one per tab for isolation */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-terminal-id={tab.id}
            className={`absolute inset-0 p-1 ${activeTabId === tab.id ? 'block' : 'hidden'}`}
            style={{ backgroundColor: '#0a0a0f' }}
          />
        ))}
      </div>

      {/* Claude Terminal Modal */}
      <ClaudeTerminalModal
        isOpen={claudeModalOpen}
        onClose={() => setClaudeModalOpen(false)}
        onConfirm={createClaudeTerminal}
        claudeInfo={claudeInfo}
      />
    </div>
  );
};
