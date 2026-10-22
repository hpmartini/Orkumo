import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, LogOut, Eye, X, Maximize2, SquareTerminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL, getWsUrl } from '../../utils/apiConfig';
import {
  DEFAULT_TERMINAL_OPTIONS,
  useGhosttyTheme,
  withGhostty,
} from '../../hooks/useGhosttyTheme';
import type { AgentSession } from '../../types';
import { stateGlyph } from '../../utils/agentSessions';

interface AgentTerminalProps {
  session: AgentSession;
  /** Whether the pane is currently visible (tabs layout hides inactive panes) */
  visible: boolean;
  /** Highlight as the active pane in tiled layouts */
  active: boolean;
  onFocus: () => void;
  onClose: () => void;
  onPeek: () => void;
  onMaximize?: () => void;
}

/**
 * Build the PTY WebSocket URL for `claude attach <id>`.
 */
export function buildAttachUrl(sessionId: string, cwd: string, cols: number, rows: number): string {
  const ptySession = `agent-${sessionId}-${Date.now()}`;
  const args = encodeURIComponent(JSON.stringify(['attach', sessionId]));
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
  onFocus,
  onClose,
  onPeek,
  onMaximize,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
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
      return true;
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
    const url = buildAttachUrl(session.id, session.cwd, terminal.cols, terminal.rows);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    if (generation > 0) terminal.reset();

    ws.onopen = () => setConnected(true);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'output':
            terminal.write(data.data);
            break;
          case 'connected':
            terminal.write(`\x1b[2m# claude attach ${session.id} (PID ${data.pid})\x1b[0m\r\n`);
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
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          // ignore
        }
      }, 50);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener('resize', fit);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          // ignore
        }
        if (active) terminalRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [visible, active]);

  const glyph = stateGlyph(session.displayState);

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-gray-950 border ${
        active ? 'border-blue-500/60' : 'border-gray-800'
      } rounded-lg overflow-hidden`}
      onMouseDown={onFocus}
      data-agent-pane={session.id}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1 bg-gray-900 border-b border-gray-800 text-xs shrink-0">
        <span
          className={`${glyph.className} ${glyph.animate ? 'animate-pulse' : ''}`}
          title={glyph.label}
        >
          {glyph.glyph}
        </span>
        <span className="font-medium text-gray-200 truncate">{session.name}</span>
        <span className="text-gray-600 font-mono truncate hidden md:inline">{session.id}</span>
        <span
          className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-600'}`}
        />
        <div className="flex-1" />
        <button
          onClick={onPeek}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          title="Peek (recent output)"
        >
          <Eye size={12} />
        </button>
        {connected ? (
          <button
            onClick={() => sendInput('\x1a')}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            title="Detach (Ctrl+Z) - the session keeps running"
          >
            <LogOut size={12} />
          </button>
        ) : (
          <button
            onClick={() => setGeneration((g) => g + 1)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-300 hover:text-white hover:bg-gray-800"
            title="Reattach"
          >
            <RefreshCw size={12} />
            <span>Reattach</span>
          </button>
        )}
        <button
          onClick={openInGhostty}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          title="Open in Ghostty"
        >
          <SquareTerminal size={12} />
        </button>
        {onMaximize && (
          <button
            onClick={onMaximize}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            title="Show only this pane"
          >
            <Maximize2 size={12} />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800"
          title="Close tab"
        >
          <X size={12} />
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
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
