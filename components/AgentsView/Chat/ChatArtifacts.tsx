import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Code2, FileText, FolderOpen, Files, Loader2, X } from 'lucide-react';
import {
  fetchChatArtifactContent,
  fetchChatArtifacts,
  type ChatArtifact,
} from '../../../services/agentsApi';
import { useDialogA11y } from '../../CommandPalette/useDialogA11y';
import { relativeTime } from '../../../utils/chatHistory';
import { openFile } from '../../../utils/openFile';
import { pollWhileVisible } from '../../../utils/visiblePoll';
import { ChatFileContext, ChatMarkdown, CopyButton } from './ChatMarkdown';
import type { ChatMessage } from '../../../utils/chatEvents';

/** While the modal is open: documents appear without a tool call the client could see */
const MODAL_POLL_MS = 4000;

/** Tool names that write files (omp's write/edit arrive mapped, its patch edit as `edit`) */
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'edit']);

/** Changes when a file tool call finishes or a turn ends: then the list is fetched again */
export function artifactRefreshKey(messages: ChatMessage[], turns: number): string {
  let done = 0;
  for (const m of messages)
    if (m.kind === 'assistant')
      for (const b of m.blocks)
        if (b?.type === 'tool' && b.result !== undefined && FILE_TOOLS.has(b.name)) done++;
  return `${done}:${turns}`;
}

const focusRing = 'focus-visible:outline-2 focus-visible:outline-blue-400';
const actionBtn = `flex items-center gap-1.5 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300 ${focusRing}`;

/**
 * Artifacts of a chat, refetched whenever `refreshKey` changes (finished file tool calls,
 * turns). Errors keep the last list: the chat itself reports a gone session.
 */
export function useChatArtifacts(chatId: string | null, refreshKey: string): ChatArtifact[] {
  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);
  useEffect(() => {
    if (!chatId) return setArtifacts([]);
    let cancelled = false;
    fetchChatArtifacts(chatId)
      .then((list) => !cancelled && setArtifacts(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chatId, refreshKey]);
  return artifacts;
}

/** Footer button; hidden while the session has no artifacts */
export const ChatArtifactsButton: React.FC<{ count: number; onOpen: () => void }> = ({
  count,
  onOpen,
}) =>
  count === 0 ? null : (
    <button
      type="button"
      onClick={onOpen}
      className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 text-xs text-gray-300 hover:text-white hover:bg-gray-800 ${focusRing}`}
      title="Files and documents this agent created or edited"
    >
      <Files size={13} aria-hidden className="text-gray-400" />
      Artifacts
      <span className="tabular-nums text-gray-100">{count}</span>
    </button>
  );

const GROUPS: { label: string; test: (a: ChatArtifact) => boolean }[] = [
  { label: 'Documents', test: (a) => a.kind === 'document' },
  { label: 'Created', test: (a) => a.kind === 'file' && a.action === 'created' },
  { label: 'Edited', test: (a) => a.kind === 'file' && a.action === 'edited' },
];

function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Path for display: relative inside the session directory */
const shownPath = (file: string, cwd: string) =>
  file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;

const isMarkdown = (file: string) => /\.(md|markdown|mdx)$/i.test(file);

/** Code with line numbers: two columns, so a 30k-line file stays two text nodes */
const CodePreview: React.FC<{ text: string }> = ({ text }) => {
  const numbers = useMemo(() => {
    const count = text.split('\n').length;
    return Array.from({ length: count }, (_, i) => i + 1).join('\n');
  }, [text]);
  return (
    <div className="flex min-w-max text-xs leading-relaxed font-mono">
      <pre
        aria-hidden
        className="sticky left-0 shrink-0 select-none px-3 py-3 text-right text-gray-600 bg-gray-950 border-r border-gray-800"
      >
        {numbers}
      </pre>
      <pre className="px-3 py-3 text-gray-200">{text}</pre>
    </div>
  );
};

type PreviewState =
  | { state: 'loading' }
  | { state: 'ready'; content: string }
  | { state: 'error'; message: string };

const GONE: PreviewState = { state: 'error', message: 'The file no longer exists.' };

const Preview: React.FC<{ chatId: string; cwd: string; artifact: ChatArtifact }> = ({
  chatId,
  cwd,
  artifact,
}) => {
  const [preview, setPreview] = useState<PreviewState>(
    artifact.exists ? { state: 'loading' } : GONE
  );
  useEffect(() => {
    if (!artifact.exists) {
      setPreview(GONE);
      return;
    }
    let cancelled = false;
    // Keep the old text while a changed file reloads: no flicker on live updates
    setPreview((p) => (p.state === 'ready' ? p : { state: 'loading' }));
    fetchChatArtifactContent(chatId, artifact.path)
      .then((d) => !cancelled && setPreview({ state: 'ready', content: d.content }))
      .catch(
        (e: Error) =>
          !cancelled && setPreview({ state: 'error', message: e.message || 'Preview failed' })
      );
    return () => {
      cancelled = true;
    };
  }, [chatId, artifact.path, artifact.mtime, artifact.exists]);

  if (preview.state === 'loading')
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-gray-400">
        <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />
        Loading preview…
      </div>
    );
  if (preview.state === 'error')
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 px-6 text-center">
        <p className="text-sm text-gray-300">{preview.message}</p>
        {artifact.exists && (
          <p className="text-xs text-gray-500">Open it in VS Code or reveal it in Finder above.</p>
        )}
      </div>
    );
  if (!preview.content)
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500">
        Empty file
      </div>
    );
  return isMarkdown(artifact.path) ? (
    <div className="px-5 py-4 max-w-3xl">
      <ChatFileContext.Provider value={cwd}>
        <ChatMarkdown text={preview.content} />
      </ChatFileContext.Provider>
    </div>
  ) : (
    <CodePreview text={preview.content} />
  );
};

/**
 * Everything the session produced: list grouped Documents / Created / Edited on the left,
 * preview on the right. Arrow keys move through the list, Esc closes.
 */
export const ChatArtifactsModal: React.FC<{
  chatId: string;
  cwd: string;
  title: string;
  artifacts: ChatArtifact[];
  onClose: () => void;
}> = ({ chatId, cwd, title, artifacts: initial, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => listRef.current);
  const [artifacts, setArtifacts] = useState(initial);
  useEffect(() => setArtifacts(initial), [initial]);
  useEffect(
    () =>
      pollWhileVisible(
        () =>
          fetchChatArtifacts(chatId)
            .then(setArtifacts)
            .catch(() => {}),
        MODAL_POLL_MS,
        { immediate: false }
      ),
    [chatId]
  );

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({ label: g.label, items: artifacts.filter(g.test) })).filter(
        (g) => g.items.length > 0
      ),
    [artifacts]
  );
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [selectedPath, setSelectedPath] = useState<string | null>(ordered[0]?.path ?? null);
  const selected = ordered.find((a) => a.path === selectedPath) ?? ordered[0] ?? null;

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected?.path]);

  const move = (delta: number | 'first' | 'last') => {
    if (ordered.length === 0) return;
    const index = selected ? ordered.indexOf(selected) : -1;
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? ordered.length - 1
          : Math.min(ordered.length - 1, Math.max(0, index + delta));
    setSelectedPath(ordered[next].path);
  };

  const optionId = (a: ChatArtifact) => `artifact-${ordered.indexOf(a)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-artifacts-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className="outline-none flex flex-col w-[min(1180px,96vw)] h-[86vh] rounded-lg border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 h-10 px-3 border-b border-gray-800 shrink-0 text-sm">
          <Files size={14} aria-hidden className="text-gray-400" />
          <h2 id="chat-artifacts-title" className="font-medium text-gray-100">
            Artifacts
          </h2>
          <span className="text-xs text-gray-500 truncate min-w-0">
            {artifacts.length} from {title}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 ${focusRing}`}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[minmax(14rem,20rem)_1fr]">
          <div
            ref={listRef}
            role="listbox"
            aria-label="Artifacts"
            tabIndex={0}
            aria-activedescendant={selected ? optionId(selected) : undefined}
            onKeyDown={(e) => {
              const keys: Record<string, number | 'first' | 'last'> = {
                ArrowDown: 1,
                ArrowUp: -1,
                Home: 'first',
                End: 'last',
              };
              if (!(e.key in keys)) return;
              e.preventDefault();
              move(keys[e.key]);
            }}
            className={`min-h-0 overflow-y-auto thin-scrollbar border-r border-gray-800 py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400`}
          >
            {groups.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">No artifacts in this session yet.</p>
            )}
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="mb-1">
                <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {g.label}
                  <span className="tabular-nums normal-case tracking-normal">{g.items.length}</span>
                </div>
                {g.items.map((a) => {
                  const isSelected = a === selected;
                  const Icon = a.kind === 'document' ? FileText : Code2;
                  return (
                    <div
                      key={a.path}
                      id={optionId(a)}
                      role="option"
                      aria-selected={isSelected}
                      title={a.path}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedPath(a.path);
                        listRef.current?.focus({ preventScroll: true });
                      }}
                      className={`flex items-start gap-2 mx-1 px-2 py-1.5 rounded cursor-pointer ${
                        isSelected
                          ? 'bg-blue-500/15 text-gray-50'
                          : 'text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      <Icon
                        size={13}
                        aria-hidden
                        className={`mt-0.5 shrink-0 ${isSelected ? 'text-blue-300' : 'text-gray-500'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-xs ${a.exists ? '' : 'line-through text-gray-500'}`}
                        >
                          {a.name}
                        </span>
                        <span className="block truncate text-[11px] text-gray-500 font-mono">
                          {a.kind === 'document'
                            ? 'session document'
                            : shownPath(a.path, cwd).replace(/\/?[^/]*$/, '') || './'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">
                        {a.exists ? relativeTime(a.mtime) : 'deleted'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="min-w-0 min-h-0 flex flex-col">
            {selected ? (
              <>
                <div className="flex items-center gap-2 min-h-10 px-3 py-1.5 border-b border-gray-800 shrink-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-100 truncate">{selected.name}</div>
                    <div
                      className="text-[11px] text-gray-500 font-mono truncate"
                      title={selected.path}
                    >
                      {shownPath(selected.path, cwd)}
                      {selected.size != null && ` · ${formatSize(selected.size)}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={actionBtn}
                    disabled={!selected.exists}
                    onClick={() => openFile(selected.path, cwd, { editor: true })}
                  >
                    <Code2 size={13} aria-hidden /> Open in VS Code
                  </button>
                  <button
                    type="button"
                    className={actionBtn}
                    disabled={!selected.exists}
                    onClick={() => openFile(selected.path, cwd, { reveal: true })}
                  >
                    <FolderOpen size={13} aria-hidden /> Reveal in Finder
                  </button>
                  <CopyButton
                    text={selected.path}
                    label="Copy path"
                    className="!text-xs !px-2 !py-1"
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-auto thin-scrollbar bg-gray-950">
                  <Preview key={selected.path} chatId={chatId} cwd={cwd} artifact={selected} />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-500">
                Nothing to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    // A pane can sit in a transformed container; fixed positioning needs the body
    document.body
  );
};
