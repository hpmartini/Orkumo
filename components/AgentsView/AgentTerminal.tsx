import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useReducer,
  useSyncExternalStore,
} from 'react';
import { Terminal as XTerm, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { openLink } from '../../utils/links';
import { createFileLinkProvider, type FilePathMatch } from '../../utils/fileLinks';
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
  MessageSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL, getWsUrl } from '../../utils/apiConfig';
import { agentWsUrl, targetOf } from '../../utils/agentTarget';
import {
  DEFAULT_TERMINAL_OPTIONS,
  useGhosttyTheme,
  withGhostty,
} from '../../hooks/useGhosttyTheme';
import type { AgentSession } from '../../types';
import { attachTerminalKeys } from '../../utils/terminalKeys';
import { stateGlyph } from '../../utils/agentSessions';
import { shellCwd } from '../../utils/agentWorkspace';

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
  /** Linked PRs, issues and running processes, shown after the connection dot */
  meta?: React.ReactNode;
  /** Cmd/Ctrl-click on a link: open it in the built-in browser instead of externally */
  onOpenLink?: (url: string) => void;
  /** Present when the agent has a UI view: switches the pane to it, the process keeps running */
  onShowChat?: () => void;
}

/**
 * Build the PTY WebSocket URL for `claude attach <id>`, on the instance the session runs on (#220).
 */
export function buildAttachUrl(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
  cliArgs: string[] = ['attach', sessionId],
  command: NonNullable<AgentSession['ptyCommand']> = 'claude'
): string {
  const ptySession = `agent-${sessionId}-${Date.now()}`;
  const args = encodeURIComponent(JSON.stringify(cliArgs));
  return `${agentWsUrl(sessionId)}?sessionId=${ptySession}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}&command=${command}&args=${args}`;
}

/** PTY WebSocket URL for a plain shell in `cwd` (#207): no command, so the server starts its default shell */
export function buildShellUrl(cwd: string, cols: number, rows: number): string {
  return `${getWsUrl('/api/pty')}?sessionId=shell-${Date.now()}-${Math.random().toString(36).slice(2)}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;
}

/**
 * Cmd/Ctrl-click on a file path: VS Code, in the window of the pane's project; with Shift the
 * Mac's default app (#188). The server keeps folders and launchable files in Finder.
 */
async function openFile(match: FilePathMatch, cwd: string, editor: boolean) {
  try {
    const res = await fetch(`${API_BASE_URL}/files/${editor ? 'open-in-editor' : 'open'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        editor
          ? { path: match.path, cwd, line: match.line, col: match.col }
          : { path: match.path, cwd }
      ),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || res.statusText);
    if (body?.action === 'revealed') toast(`Startbare Datei, im Finder gezeigt: ${match.path}`);
  } catch (err) {
    toast.error(`Datei öffnen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * A pane's terminal and PTY connection outlive its component: splitting or unsplitting a tab
 * remounts the pane, and a new PTY would end the process behind it (an omp or shell pane has
 * nothing to reattach to, #195). An unmounted pane is released only if no mount takes it back.
 */
interface PaneTerminal {
  terminal: XTerm;
  fit: FitAddon;
  ws: WebSocket | null;
  connected: boolean;
  exited: boolean;
  /** re-renders the mounted pane after `connected` / `exited` changed */
  rerender: (() => void) | null;
  /** pending release of an unmounted pane */
  release?: number;
  // latest props, read by the handlers bound once at creation
  onClose: () => void;
  onOpenLink?: (url: string) => void;
  cwd: string;
}
const paneTerminals = new Map<string, PaneTerminal>();
const RELEASE_MS = 2000;
/** Re-render subscribers of any pane's connection state (the UI view of a pane reads it) */
const paneListeners = new Set<() => void>();
const notifyPanes = () => paneListeners.forEach((listener) => listener());

const sendTo = (pane: PaneTerminal | undefined, message: object) => {
  if (pane?.ws?.readyState === WebSocket.OPEN) pane.ws.send(JSON.stringify(message));
};

const subscribePanes = (listener: () => void) => {
  paneListeners.add(listener);
  return () => paneListeners.delete(listener);
};

/** Whether pane `id`'s PTY is connected, so its UI view can type into it */
export function usePaneConnected(id: string): boolean {
  return useSyncExternalStore(subscribePanes, () => paneTerminals.get(id)?.connected ?? false);
}

/**
 * Types a message into pane `id`'s agent like a paste followed by Enter (the UI view's input).
 * xterm's paste wraps it in bracketed-paste markers when the TUI asked for them, so a multi-line
 * message stays one message. false when the PTY is not connected.
 */
export function typeIntoPane(id: string, text: string): boolean {
  const pane = paneTerminals.get(id);
  if (!pane?.connected) return false;
  pane.terminal.paste(text);
  // A TUI that just received a paste treats an Enter in the same chunk as part of it
  window.setTimeout(() => sendTo(pane, { type: 'input', data: '\r' }), 80);
  return true;
}

/** Sends raw keys to pane `id`'s PTY (Esc, a choice number); false when not connected */
export function pressKeys(id: string, keys: string): boolean {
  const pane = paneTerminals.get(id);
  if (!pane?.connected) return false;
  sendTo(pane, { type: 'input', data: keys });
  return true;
}

/** Last `maxLines` non-empty lines of pane `id`'s visible screen ('' without a terminal) */
export function paneScreen(id: string, maxLines = 18): string {
  const terminal = paneTerminals.get(id)?.terminal;
  if (!terminal) return '';
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let y = buffer.viewportY; y < buffer.viewportY + terminal.rows; y++) {
    const line = buffer.getLine(y)?.translateToString(true) ?? '';
    if (line.trim()) lines.push(line);
  }
  return lines.slice(-maxLines).join('\n');
}

function createPaneTerminal(
  container: HTMLElement,
  options: ITerminalOptions,
  props: Pick<PaneTerminal, 'onClose' | 'onOpenLink' | 'cwd'>
): PaneTerminal {
  // Like other terminals: a plain click selects text, Cmd/Ctrl-click opens (#140), Cmd/Ctrl+Shift
  // in the system browser. Shared by plain-text URLs (WebLinksAddon) and OSC 8 hyperlinks, which
  // xterm otherwise opens through its own confirm() + window.open, a dead end in the desktop app
  const activateLink = (event: MouseEvent, uri: string) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const open = pane.onOpenLink;
    // after xterm's own mouseup handling: opening the split remounts this pane
    setTimeout(() => openLink(uri, open, event.shiftKey ? 'system' : undefined));
  };
  const terminal = new XTerm({
    ...options,
    scrollback: 5000,
    allowProposedApi: true,
    linkHandler: { activate: activateLink },
  });
  const fit = new FitAddon();
  const pane: PaneTerminal = {
    terminal,
    fit,
    ws: null,
    connected: false,
    exited: false,
    rerender: null,
    ...props,
  };
  terminal.loadAddon(fit);
  terminal.loadAddon(new WebLinksAddon(activateLink));
  // Inline images (SIXEL, iTerm2 protocol); DA1 / XTSMGRAPHICS answers let TUIs detect SIXEL
  terminal.loadAddon(new ImageAddon());
  terminal.registerLinkProvider(
    createFileLinkProvider(terminal, (event, match) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      void openFile(match, pane.cwd, !event.shiftKey);
    })
  );
  terminal.open(container);
  try {
    fit.fit();
  } catch {
    // container not laid out yet
  }
  const input = (data: string) => sendTo(pane, { type: 'input', data });
  terminal.onData(input);
  terminal.onResize(({ cols, rows }) => sendTo(pane, { type: 'resize', cols, rows }));
  attachTerminalKeys(
    terminal,
    input,
    () => pane.onClose(),
    // F6 moves focus back to the rail (handled at document level)
    (event) => event.key !== 'F6'
  );
  return pane;
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
  meta,
  onOpenLink,
  onShowChat,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const pane = paneTerminals.get(session.id);
  const connected = pane?.connected ?? false;
  const exited = pane?.exited ?? false;
  if (pane) {
    // Cmd+W, links and file paths are bound once at creation: they act through the latest props
    pane.onClose = onClose;
    pane.onOpenLink = onOpenLink;
    pane.cwd = session.cwd;
  }
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const shell = shellCwd(session.id) !== null;
  const ghostty = useGhosttyTheme();
  const options = withGhostty(DEFAULT_TERMINAL_OPTIONS, ghostty);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sendInput = useCallback(
    (data: string) => sendTo(paneTerminals.get(session.id), { type: 'input', data }),
    [session.id]
  );

  // Fit, then tell the PTY the real size even if xterm saw no change: the pty is opened
  // with the size from before layout, and a TUI only redraws after a resize.
  const syncSize = useCallback(() => {
    const current = paneTerminals.get(session.id);
    if (!current) return;
    try {
      current.fit.fit();
    } catch {
      return;
    }
    const { cols, rows } = current.terminal;
    sendTo(current, { type: 'resize', cols, rows });
  }, [session.id]);

  // Create the pane's terminal, or take back the one a remount left behind
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let current = paneTerminals.get(session.id);
    if (current?.terminal.element) {
      window.clearTimeout(current.release);
      container.appendChild(current.terminal.element);
    } else {
      current = createPaneTerminal(container, optionsRef.current, {
        onClose,
        onOpenLink,
        cwd: session.cwd,
      });
      paneTerminals.set(session.id, current);
    }
    current.rerender = rerender;
    rerender();
    const id = session.id;
    const held = current;
    return () => {
      held.rerender = null;
      held.release = window.setTimeout(() => {
        held.ws?.close();
        held.terminal.dispose();
        if (paneTerminals.get(id) === held) paneTerminals.delete(id);
        notifyPanes();
      }, RELEASE_MS);
    };
    // created once per pane; the props it reads are refreshed on every render above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // The Ghostty config may arrive after the terminal was created
  useEffect(() => {
    const current = paneTerminals.get(session.id);
    if (!current || !ghostty) return;
    Object.assign(current.terminal.options, optionsRef.current);
    try {
      current.fit.fit();
    } catch {
      // ignore
    }
  }, [ghostty, session.id]);

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
    const current = paneTerminals.get(session.id);
    if (!current) return;
    // A remounted pane (split, unsplit) keeps its connection and the process behind it
    if (generation === 0 && current.ws) return;
    const { terminal } = current;
    const update = (state: Partial<Pick<PaneTerminal, 'connected' | 'exited'>>) => {
      Object.assign(current, state);
      current.rerender?.();
      notifyPanes();
    };
    current.ws?.close();
    update({ connected: false, exited: false });
    try {
      current.fit.fit();
    } catch {
      // ignore
    }
    const url = shell
      ? buildShellUrl(session.cwd, terminal.cols, terminal.rows)
      : buildAttachUrl(
          session.id,
          session.cwd,
          terminal.cols,
          terminal.rows,
          session.ptyArgs,
          session.ptyCommand
        );
    const ws = new WebSocket(url);
    current.ws = ws;
    if (generation > 0) terminal.reset();

    ws.onopen = () => {
      update({ connected: true });
      syncSize();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'output':
            terminal.write(data.data);
            break;
          case 'connected': {
            // control characters stripped: a folder name must not drive the terminal
            // eslint-disable-next-line no-control-regex -- matching control characters is the point
            const safe = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, '');
            const cwd = safe(data.cwd ?? session.cwd);
            // the server falls back to $HOME when the folder is gone (e.g. a removed worktree)
            if (shell && data.cwd && data.cwd !== session.cwd.replace(/(.)\/+$/, '$1')) {
              terminal.write(`\x1b[33m# ${safe(session.cwd)} not found\x1b[0m\r\n`);
            }
            terminal.write(
              shell
                ? `\x1b[2m# ${data.shell ?? 'shell'} in ${cwd} (PID ${data.pid})\x1b[0m\r\n`
                : `\x1b[2m# ${data.reattached ? 'reattached: ' : ''}${session.ptyCommand ?? 'claude'} ${(session.ptyArgs ?? ['attach', session.id]).join(' ')} (PID ${data.pid})\x1b[0m\r\n`
            );
            break;
          }
          case 'exit':
            terminal.write(
              `\r\n\x1b[2m# ${shell ? 'shell exited' : 'detached'} (exit code ${data.exitCode})\x1b[0m\r\n`
            );
            update({ connected: false, exited: true });
            break;
          case 'error':
            terminal.write(`\x1b[31m${data.message}\x1b[0m\r\n`);
            update({ exited: true });
            break;
        }
      } catch {
        terminal.write(event.data);
      }
    };
    ws.onclose = () => {
      // a superseded socket (Reattach) must not flag the live one as detached
      if (current.ws !== ws) return;
      update({ connected: false, exited: true });
    };
    ws.onerror = () => terminal.write('\x1b[31mWebSocket connection error\x1b[0m\r\n');
    // no cleanup: the socket belongs to the pane terminal, released with it
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
        if (active && !document.querySelector('[aria-modal="true"]'))
          paneTerminals.get(session.id)?.terminal.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [visible, active, syncSize, session.id]);

  const glyph = stateGlyph(session.displayState);
  const reconnect = () => setGeneration((g) => g + 1);
  const moveToTab = onMaximize
    ? [
        {
          label: 'Move to own tab',
          title: 'Move to its own tab',
          icon: <Maximize2 size={12} />,
          run: onMaximize,
        },
      ]
    : [];
  // A plain shell (#207) has nothing to peek, detach from or resume: only restart it once it ended
  const shellActions = [
    ...(connected
      ? []
      : [
          {
            label: 'Restart',
            title: 'Start a new shell in this directory',
            icon: <RefreshCw size={12} />,
            run: reconnect,
            showLabel: true,
          },
        ]),
    ...moveToTab,
  ];
  const agentActions = [
    { label: 'Peek', title: 'Peek (recent output)', icon: <Eye size={12} />, run: onPeek },
    ...(onShowChat
      ? [
          {
            label: 'UI view',
            title: 'Show this agent in the UI view (same process, it keeps running)',
            icon: <MessageSquare size={12} />,
            run: onShowChat,
          },
        ]
      : []),
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
          run: reconnect,
          showLabel: true,
        },
    // Ghostty attaches locally only: a pane of another instance (#220) has no local session to open
    // …and only Claude Code sessions: other harnesses (#195) have no `claude attach` counterpart
    ...((session.ptyCommand && session.ptyCommand !== 'claude') || targetOf(session.id) !== ''
      ? []
      : [
          {
            label: 'Open in Ghostty',
            title: 'Open in Ghostty',
            icon: <SquareTerminal size={12} />,
            run: openInGhostty,
          },
        ]),
    ...moveToTab,
  ];
  const actions = (shell ? shellActions : agentActions) as {
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
        {meta && (
          <div className="flex items-center gap-x-2 min-w-0 overflow-hidden ml-1 text-[11px] text-gray-400">
            {meta}
          </div>
        )}
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
          title={shell ? 'Close (ends the shell)' : 'Close (the agent keeps running)'}
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
