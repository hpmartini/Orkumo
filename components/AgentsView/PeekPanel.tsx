import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ArrowRight, RefreshCw, Copy, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AgentSession, AgentLogs } from '../../types';
import { fetchAgentLogs } from '../../services/agentsApi';
import { extractNumberedChoices, stripAnsi } from '../../utils/agentInput';
import { parseAnsiToReact } from '../../utils/ansiParser';
import { stateGlyph } from '../../utils/agentSessions';

interface PeekPanelProps {
  session: AgentSession;
  onClose: () => void;
  onAttach: () => void;
  onReply: (text: string) => Promise<void>;
}

/**
 * Peek panel: recent output / blocking question of a session plus a reply input.
 * Numbered keys pick predefined choices, Tab inserts the suggested reply,
 * a `!` prefix sends a shell command instead of a prompt.
 */
export const PeekPanel: React.FC<PeekPanelProps> = ({ session, onClose, onAttach, onReply }) => {
  const [logs, setLogs] = useState<AgentLogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const replyRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (session.kind === 'interactive') {
      setLogs({
        source: 'logs',
        text: '',
        entries: [],
        note: 'Interactive sessions run in their own terminal. Background them with /bg or ← to manage them here.',
      });
      setLoading(false);
      return;
    }
    try {
      const data = await fetchAgentLogs(session.id, 60);
      setLogs(data);
    } catch (err) {
      setLogs({
        source: 'logs',
        text: '',
        entries: [],
        note: err instanceof Error ? err.message : 'Failed to load output',
      });
    } finally {
      setLoading(false);
    }
  }, [session.id, session.kind]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    replyRef.current?.focus();
  }, [session.id]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [logs]);

  const choices = logs?.source === 'logs' ? extractNumberedChoices(logs.text) : [];

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onReply(text);
      setReply('');
      toast.success(text.startsWith('!') ? 'Command sent' : 'Reply sent');
      setTimeout(load, 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send(reply);
      return;
    }
    if (e.key === 'Tab' && session.suggestedReply && !reply) {
      e.preventDefault();
      setReply(session.suggestedReply);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (!reply && /^[1-9]$/.test(e.key) && choices.some((c) => c.number === Number(e.key))) {
      e.preventDefault();
      send(e.key);
    }
  };

  const glyph = stateGlyph(session.displayState);
  const cleanText = stripAnsi(logs?.text || '');
  const outputLines = cleanText
    .split(/\r?\n/)
    .filter((line, idx, arr) => line.trim() || (idx > 0 && arr[idx - 1].trim()));

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-gray-950 border-l border-gray-800"
      data-peek-panel
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <span className={`${glyph.className} ${glyph.animate ? 'animate-pulse' : ''}`}>
          {glyph.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-100 truncate">{session.name}</div>
          <div className="text-[11px] text-gray-500 font-mono truncate">
            {session.id} · {session.cwd}
          </div>
        </div>
        <button
          onClick={load}
          className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(session.sessionId || session.id);
            toast.success('Session id copied');
          }}
          className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
          title="Copy session id"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={onAttach}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-600/20 text-blue-300 hover:bg-blue-600/40"
          title="Attach (Enter / →)"
        >
          <ArrowRight size={12} /> Attach
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
          title="Close (Esc / Space)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Meta */}
      <div className="px-3 py-2 border-b border-gray-800 text-xs space-y-1 shrink-0">
        <div className="text-gray-400">
          <span className="text-gray-600">state </span>
          {glyph.label.toLowerCase()}
          {session.waitingFor && (
            <span className="text-yellow-400"> · waiting for {session.waitingFor}</span>
          )}
          {session.tokens != null && (
            <span className="text-gray-600"> · {session.tokens} tokens</span>
          )}
        </div>
        {session.detail && <div className="text-gray-300">{session.detail}</div>}
        {session.intent && (
          <div className="text-gray-500 line-clamp-3" title={session.intent}>
            <span className="text-gray-600">task </span>
            {session.intent}
          </div>
        )}
        {session.worktree && (
          <div className="text-gray-500 font-mono truncate">worktree {session.worktree}</div>
        )}
        {session.links.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {session.links.map((link) => (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-700 text-gray-300 hover:border-blue-500/50 hover:text-white"
              >
                {link.provider === 'gitlab' ? '!' : '#'}
                {link.number ?? 'PR'} {link.title ? `· ${link.title}` : ''}
                <ExternalLink size={9} />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto min-h-0 p-3 font-mono text-xs leading-5"
        style={{ backgroundColor: '#0a0a0f' }}
      >
        {loading && !logs ? (
          <div className="text-gray-600 italic">Loading recent output…</div>
        ) : logs?.source === 'transcript' ? (
          logs.entries.length === 0 ? (
            <div className="text-gray-600 italic">{logs.note || 'No output yet.'}</div>
          ) : (
            logs.entries.map((entry, idx) => (
              <div
                key={idx}
                className={`mb-3 whitespace-pre-wrap break-words ${entry.role === 'user' ? 'text-blue-300' : 'text-gray-200'}`}
              >
                <span className="text-gray-600 select-none">
                  {entry.role === 'user' ? '❯ ' : '● '}
                </span>
                {entry.text}
              </div>
            ))
          )
        ) : outputLines.length === 0 ? (
          <div className="text-gray-600 italic">{logs?.note || 'No output yet.'}</div>
        ) : (
          outputLines.map((line, idx) => (
            <div key={idx} className="whitespace-pre-wrap break-words text-gray-300">
              {parseAnsiToReact(line, idx)}
            </div>
          ))
        )}
        {session.result && logs?.source === 'transcript' && (
          <div className="mt-2 pt-2 border-t border-gray-800 text-emerald-300 whitespace-pre-wrap">
            {session.result}
          </div>
        )}
      </div>

      {/* Choices */}
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-t border-gray-800 shrink-0">
          {choices.map((choice) => (
            <button
              key={choice.number}
              onClick={() => send(String(choice.number))}
              className="px-2 py-1 rounded border border-gray-700 text-xs text-gray-200 hover:border-blue-500/60 hover:bg-blue-600/10"
            >
              <span className="text-blue-300 font-mono mr-1">{choice.number}</span>
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {/* Reply */}
      <div className="border-t border-gray-800 px-3 py-2 shrink-0">
        {session.suggestedReply && !reply && (
          <div className="text-[11px] text-gray-500 mb-1 truncate">
            <kbd className="kbd">Tab</kbd> {session.suggestedReply}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-mono">❯</span>
          <input
            ref={replyRef}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            placeholder={
              session.kind === 'interactive'
                ? 'Interactive sessions cannot be replied to here'
                : 'reply · ! for a shell command · 1-9 to pick a choice'
            }
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none font-mono"
            aria-label="Reply to session"
          />
          {sending && <RefreshCw size={12} className="animate-spin text-gray-500" />}
        </div>
      </div>
    </div>
  );
};
