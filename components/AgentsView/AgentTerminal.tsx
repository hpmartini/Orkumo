import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, LogOut, Eye, X, Maximize2 } from 'lucide-react';
import { getWsUrl } from '../../utils/apiConfig';
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

const TERMINAL_THEME = {
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
};

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
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
      scrollback: 5000,
      theme: TERMINAL_THEME,
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
      <div className="flex items-center gap-2 px-2 py-1 bg-gray-900 border-b border-gray-800 text-xs shrink-0">
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
          style={{ backgroundColor: '#0a0a0f' }}
        />
        {exited && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-900/95 border-t border-gray-800 text-xs text-gray-400">
            <span>Detached. The session keeps running in the background.</span>
            <button
              onClick={() => setGeneration((g) => g + 1)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              <RefreshCw size={12} /> Reattach
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
