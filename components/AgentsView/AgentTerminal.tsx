import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  RefreshCw,
  LogOut,
  Eye,
  X,
  Maximize2,
  SquareTerminal,
  MoreHorizontal,
  Keyboard,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL, getWsUrl } from '../../utils/apiConfig';
import {
  DEFAULT_TERMINAL_OPTIONS,
  useGhosttyTheme,
  withGhostty,
} from '../../hooks/useGhosttyTheme';
import type { AgentSession } from '../../types';
import { stateGlyph } from '../../utils/agentSessions';

/** Below this pane width the header actions fold into an overflow menu */
const NARROW_PX = 360;
const paneBtnFocus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';

interface AgentTerminalProps {
  session: AgentSession;
  /** Whether the pane is currently visible (tabs layout hides inactive panes) */
  visible: boolean;
  /** Highlight as the active pane in tiled layouts */
  active: boolean;
  /** Keyboard focus is inside this pane's terminal (true for at most one pane) */
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onPeek: () => void;
  /** Present in multi-pane tabs: pulls this pane out into its own tab */
  onMaximize?: () => void;
  /** Spread on the header, which doubles as the pane's drag handle */
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Only pane of its tab: the tab already shows name and state, so the header is actions only */
  solo?: boolean;
}

/**
 * Build the PTY WebSocket URL for `claude attach <id>`.
 */
export function buildAttachUrl(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
  cliArgs: string[] = ['attach', sessionId]
): string {
  const ptySession = `agent-${sessionId}-${Date.now()}`;
  const args = encodeURIComponent(JSON.stringify(cliArgs));
  return `${getWsUrl('/api/pty')}?sessionId=${ptySession}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}&command=claude&args=${args}`;
}

/**
 * A terminal pane attached to a background Claude Code session (`claude attach <id>`).
 * The xterm instance lives for the whole lifetime of the pane; the WebSocket/PTY can be
 * re-established with "Reattach" after the CLI detached (Ctrl+Z / ← / session end).
 */
export const AgentTerminal: React.FC<AgentTerminalProps> = ({
  session,
  visible,
  active,
  focused,
  onFocus,
  onClose,
  onPeek,
  onMaximize,
  headerProps,
  solo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const ghostty = useGhosttyTheme();
  const options = withGhostty(DEFAULT_TERMINAL_OPTIONS, ghostty);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  // Fit, then tell the PTY the real size even if xterm saw no change: the pty is opened
  // with the size from before layout, and a TUI only redraws after a resize.
  const syncSize = useCallback(() => {
    const terminal = terminalRef.current;
    try {
      fitRef.current?.fit();
    } catch {
      return;
    }
    const ws = wsRef.current;
    if (terminal && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  }, []);

  // Create the xterm instance once
  useEffect(() => {
    const container = containerRef.current;
    if (!container || terminalRef.current) return;
    const terminal = new XTerm({
      ...optionsRef.current,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    try {
      fitAddon.fit();
    } catch {
      // container not laid out yet
    }
    terminal.onData((data) => sendInput(data));
    terminal.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
        sendInput('\x1b[13;2u');
        return false;
      }
      // F6 moves focus back to the rail (handled at document level)
      return event.key !== 'F6';
    });
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [sendInput]);

  // The Ghostty config may arrive after the terminal was created
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !ghostty) return;
    Object.assign(terminal.options, optionsRef.current);
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
  }, [ghostty]);

  const openInGhostty = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/terminal/ghostty/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: session.cwd, command: 'claude', args: ['attach', session.id] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || res.statusText);
    } catch (err) {
      toast.error(`Open in Ghostty failed: ${err instanceof Error ? err.message : err}`);
    }
  }, [session.cwd, session.id]);

  // (Re)connect the PTY whenever generation changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    wsRef.current?.close();
    setExited(false);
    setConnected(false);
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
    const url = buildAttachUrl(
      session.id,
      session.cwd,
      terminal.cols,
      terminal.rows,
      session.ptyArgs
    );
    const ws = new WebSocket(url);
    wsRef.current = ws;
    if (generation > 0) terminal.reset();

    ws.onopen = () => {
      setConnected(true);
      syncSize();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'output':
            terminal.write(data.data);
            break;
          case 'connected':
            terminal.write(
              `\x1b[2m# claude ${(session.ptyArgs ?? ['attach', session.id]).join(' ')} (PID ${data.pid})\x1b[0m\r\n`
            );
            break;
          case 'exit':
            terminal.write(`\r\n\x1b[2m# detached (exit code ${data.exitCode})\x1b[0m\r\n`);
            setExited(true);
            setConnected(false);
            break;
          case 'error':
            terminal.write(`\x1b[31m${data.message}\x1b[0m\r\n`);
            setExited(true);
            break;
        }
      } catch {
        terminal.write(event.data);
      }
    };
    ws.onclose = () => {
      // a superseded socket (StrictMode remount, Reattach) must not flag the live one as detached
      if (wsRef.current !== ws) return;
      setConnected(false);
      setExited(true);
    };
    ws.onerror = () => terminal.write('\x1b[31mWebSocket connection error\x1b[0m\r\n');

    return () => {
      ws.close();
    };
    // session.id / cwd are stable for the pane lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, session.id]);

  // Fit on resize / visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fit = () => {
      setNarrow(container.clientWidth < NARROW_PX);
      if (timer) clearTimeout(timer);
      timer = setTimeout(syncSize, 50);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener('resize', fit);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [syncSize]);

  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => {
        syncSize();
        if (active && !document.querySelector('[aria-modal="true"]')) terminalRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [visible, active, syncSize]);

  const glyph = stateGlyph(session.displayState);
  const actions = [
    { label: 'Peek', title: 'Peek (recent output)', icon: <Eye size={12} />, run: onPeek },
    connected
      ? {
          label: 'Detach',
          title: 'Detach (Ctrl+Z) - the session keeps running',
          icon: <LogOut size={12} />,
          run: () => sendInput('\x1a'),
        }
      : {
          label: 'Reattach',
          title: 'Reattach',
          icon: <RefreshCw size={12} />,
          run: () => setGeneration((g) => g + 1),
          showLabel: true,
        },
    {
      label: 'Open in Ghostty',
      title: 'Open in Ghostty',
      icon: <SquareTerminal size={12} />,
      run: openInGhostty,
    },
    ...(onMaximize
      ? [
          {
            label: 'Move to own tab',
            title: 'Move to its own tab',
            icon: <Maximize2 size={12} />,
            run: onMaximize,
          },
        ]
      : []),
  ] as {
    label: string;
    title: string;
    icon: React.ReactNode;
    run: () => void;
    showLabel?: boolean;
  }[];

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-gray-950 border rounded-lg overflow-hidden transition-colors motion-reduce:transition-none ${
        focused
          ? 'border-blue-300 ring-2 ring-blue-300/70'
          : active
            ? 'border-blue-400/40'
            : 'border-gray-800'
      }`}
      onMouseDown={onFocus}
      data-agent-pane={session.id}
      data-pane-active={active}
      data-pane-focused={focused}
    >
      <div
        {...headerProps}
        className={`flex flex-nowrap items-center gap-x-1.5 h-8 px-2 border-b text-xs shrink-0 ${
          focused ? 'bg-blue-600/40 border-blue-300/50' : 'bg-gray-900 border-gray-800'
        } ${headerProps?.draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${headerProps?.className ?? ''}`}
      >
        {!solo && (
          <>
            <span
              className={`${glyph.className} shrink-0 ${glyph.animate ? 'animate-pulse motion-reduce:animate-none' : ''}`}
              title={glyph.label}
            >
              {glyph.glyph}
            </span>
            <span className="font-medium text-gray-200 truncate min-w-0">{session.name}</span>
            <span className="text-gray-500 font-mono truncate min-w-0 hidden xl:inline">
              {session.id}
            </span>
          </>
        )}
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-gray-600'}`}
          role="img"
          aria-label={connected ? 'Connected' : 'Disconnected'}
        />
        <div className="flex-1" />
        {focused ? (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-300 text-gray-950 font-medium shrink-0">
            <Keyboard size={11} aria-hidden="true" /> Typing here
          </span>
        ) : (
          active && (
            <span className="px-1.5 py-0.5 rounded border border-gray-600 text-gray-300 shrink-0">
              Active
            </span>
          )
        )}
        {narrow ? (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              onBlur={(e) => {
                if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) setMenuOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-800 ${paneBtnFocus}`}
              title="Pane actions"
              aria-label="Pane actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-30 min-w-40 py-1 rounded-md border border-gray-700 bg-gray-900 shadow-lg"
                onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
                onBlur={(e) => {
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) setMenuOpen(false);
                }}
              >
                {actions.map((a) => (
                  <button
                    key={a.label}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      a.run();
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-gray-200 hover:bg-gray-800 ${paneBtnFocus}`}
                  >
                    {a.icon} {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          actions.map((a) => (
            <button
              key={a.label}
              onClick={a.run}
              className={`flex items-center gap-1 p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 shrink-0 ${paneBtnFocus}`}
              title={a.title}
              aria-label={a.label}
            >
              {a.icon}
              {a.showLabel && <span>{a.label}</span>}
            </button>
          ))
        )}
        <button
          onClick={onClose}
          className={`p-1.5 rounded text-gray-400 hover:text-red-300 hover:bg-gray-800 shrink-0 ${paneBtnFocus}`}
          title="Close"
          aria-label={`Close ${session.name}`}
        >
          <X size={12} />
        </button>
      </div>
      <div
        className={`relative flex-1 min-h-0 transition-opacity motion-reduce:transition-none ${
          focused ? '' : active ? 'opacity-80' : 'opacity-60'
        }`}
      >
        <div
          ref={containerRef}
          className="absolute inset-0 p-1"
          style={{ backgroundColor: options.theme.background }}
        />
        {exited && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-900/95 border-t border-gray-800 text-xs text-gray-400">
            <span>Detached. The session keeps running in the background.</span>
            <button
              onClick={() => setGeneration((g) => g + 1)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white shrink-0"
            >
              <RefreshCw size={12} /> Reattach
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
