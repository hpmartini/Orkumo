import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Plus, X, RefreshCw } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalTab {
  id: string;
  name: string;
  sessionId: string;
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  ws: WebSocket | null;
  connected: boolean;
}

interface XTerminalProps {
  /** Working directory for new terminals */
  cwd?: string;
  /** App logs to display in the first tab (output-only mode) */
  logs?: string[];
  /** Whether the app is currently running */
  isRunning?: boolean;
}

// WebSocket URL - use current host to leverage Vite proxy
const getWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/pty`;
};

export const XTerminal: React.FC<XTerminalProps> = ({
  cwd = '~',
  logs = [],
  isRunning = false,
}) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showLogsTab, setShowLogsTab] = useState(true);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (showLogsTab && !activeTabId && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogsTab, activeTabId]);

  // Create a new terminal tab
  const createTab = useCallback(() => {
    const tabId = `tab-${Date.now()}`;
    const sessionId = `session-${Date.now()}`;

    const newTab: TerminalTab = {
      id: tabId,
      name: `Shell ${tabs.length + 1}`,
      sessionId,
      terminal: null,
      fitAddon: null,
      ws: null,
      connected: false,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setShowLogsTab(false);
  }, [tabs.length]);

  // Initialize terminal for a tab
  const initializeTerminal = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || tab.terminal || !terminalContainerRef.current) return;

      // Create xterm instance
      const terminal = new XTerm({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
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

      // Mount terminal
      terminal.open(terminalContainerRef.current);
      fitAddon.fit();

      // Connect WebSocket
      const wsUrl = `${getWsUrl()}?sessionId=${tab.sessionId}&cwd=${encodeURIComponent(cwd)}&cols=${terminal.cols}&rows=${terminal.rows}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, connected: true } : t
          )
        );
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
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === tabId ? { ...t, connected: false } : t
                )
              );
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
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, connected: false } : t
          )
        );
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

      // Update tab with terminal instance
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, terminal, fitAddon, ws }
            : t
        )
      );
    },
    [tabs, cwd]
  );

  // Initialize terminal when tab becomes active
  useEffect(() => {
    if (activeTabId && terminalContainerRef.current) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab && !tab.terminal) {
        // Use requestAnimationFrame to ensure DOM is ready after layout
        const rafId = requestAnimationFrame(() => {
          initializeTerminal(activeTabId);
        });
        return () => cancelAnimationFrame(rafId);
      }
    }
  }, [activeTabId, tabs, initializeTerminal]);

  // Handle resize
  useEffect(() => {
    if (!terminalContainerRef.current) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (activeTab?.fitAddon && activeTab?.terminal) {
        try {
          activeTab.fitAddon.fit();
          // Send resize to server
          if (activeTab.ws?.readyState === WebSocket.OPEN) {
            activeTab.ws.send(
              JSON.stringify({
                type: 'resize',
                cols: activeTab.terminal.cols,
                rows: activeTab.terminal.rows,
              })
            );
          }
        } catch {
          // Ignore resize errors
        }
      }
    });

    resizeObserverRef.current.observe(terminalContainerRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [tabs, activeTabId]);

  // Cleanup on unmount - properly capture current tabs in closure
  useEffect(() => {
    return () => {
      // Capture current tabs in closure to properly cleanup all tabs
      const currentTabs = tabs;
      currentTabs.forEach((tab) => {
        tab.ws?.close();
        tab.terminal?.dispose();
      });
    };
  }, [tabs]);

  // Close a tab
  const closeTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
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
    },
    [tabs, activeTabId]
  );

  // Switch to logs tab
  const switchToLogs = useCallback(() => {
    setActiveTabId(null);
    setShowLogsTab(true);
  }, []);

  // Reconnect a tab
  const reconnectTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || !tab.terminal) return;

      // Close existing connection
      tab.ws?.close();

      // Create new session
      const newSessionId = `session-${Date.now()}`;
      const wsUrl = `${getWsUrl()}?sessionId=${newSessionId}&cwd=${encodeURIComponent(cwd)}&cols=${tab.terminal.cols}&rows=${tab.terminal.rows}`;
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
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, connected: false } : t
          )
        );
      };

      // Rebind terminal input
      tab.terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });
    },
    [tabs, cwd]
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 shadow-inner overflow-hidden flex flex-col h-[400px]">
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
          {isRunning && (
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          )}
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
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                tab.connected ? 'bg-emerald-500' : 'bg-gray-600'
              }`}
            />
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
          onClick={createTab}
          className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 rounded-md transition-colors shrink-0"
          title="New terminal"
        >
          <Plus size={14} />
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
          <span className="text-xs text-gray-600 font-mono px-2">
            {logs.length} lines
          </span>
        )}
      </div>

      {/* Terminal content area */}
      <div className="flex-1 relative overflow-hidden">
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
                const isError =
                  log.toLowerCase().includes('[error]') ||
                  log.toLowerCase().includes('error:') ||
                  log.toLowerCase().includes('failed');
                const isWarning =
                  log.toLowerCase().includes('[warn]') ||
                  log.toLowerCase().includes('warning:');
                const isSystem = log.startsWith('[SYSTEM]');

                return (
                  <div
                    key={idx}
                    className={`px-2 py-0.5 break-all ${
                      isError
                        ? 'text-red-400 bg-red-950/20'
                        : isWarning
                        ? 'text-yellow-400'
                        : isSystem
                        ? 'text-blue-400'
                        : 'text-gray-300'
                    }`}
                  >
                    <span className="text-gray-600 mr-2 select-none">$</span>
                    {log}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        {/* XTerm container */}
        <div
          ref={terminalContainerRef}
          className={`absolute inset-0 p-1 ${
            activeTabId ? 'block' : 'hidden'
          }`}
          style={{ backgroundColor: '#0a0a0f' }}
        />
      </div>
    </div>
  );
};
