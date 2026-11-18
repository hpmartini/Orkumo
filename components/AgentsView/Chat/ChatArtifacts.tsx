import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Code2, ExternalLink, FileText, FolderOpen, Files, Globe, Loader2, X } from 'lucide-react';
import {
  fetchChatArtifactContent,
  fetchChatArtifacts,
  type ChatArtifact,
  type ChatArtifacts,
  type ClaudeArtifact,
} from '../../../services/agentsApi';
import { useDialogA11y } from '../../CommandPalette/useDialogA11y';
import { relativeTime } from '../../../utils/chatHistory';
import { openFile } from '../../../utils/openFile';
import { pollWhileVisible } from '../../../utils/visiblePoll';
import { ChatFileContext, ChatMarkdown, CopyButton } from './ChatMarkdown';
import type { ChatMessage } from '../../../utils/chatEvents';

/** While the modal is open: documents appear without a tool call the client could see */
const MODAL_POLL_MS = 4000;

/** Tools whose result changes the list: file writes (omp's arrive mapped) and claude.ai publishes */
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'edit', 'Artifact']);

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
const NONE: ChatArtifacts = { files: [], pages: [] };

export function useChatArtifacts(chatId: string | null, refreshKey: string): ChatArtifacts {
  const [artifacts, setArtifacts] = useState<ChatArtifacts>(NONE);
  useEffect(() => {
    if (!chatId) return setArtifacts(NONE);
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Pages the agent published or linked to; a page it only read is listed, not counted */
const countedPages = (pages: ClaudeArtifact[]) => pages.filter((p) => p.source !== 'read').length;

/** Footer button with both counts ("2 artifacts · 12 files"); hidden while there is neither */
export const ChatArtifactsButton: React.FC<{ artifacts: ChatArtifacts; onOpen: () => void }> = ({
  artifacts,
  onOpen,
}) => {
  const pages = countedPages(artifacts.pages);
  const files = artifacts.files.length;
  if (pages === 0 && files === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 text-xs text-gray-300 hover:text-white hover:bg-gray-800 ${focusRing}`}
      title="Claude artifacts (pages on claude.ai) and files this agent created or edited"
    >
      <Files size={13} aria-hidden className="text-gray-400" />
      <span className="tabular-nums text-gray-100">
        {[pages > 0 && plural(pages, 'artifact'), files > 0 && plural(files, 'file')]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </button>
  );
};

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

/** One row of the list: a claude.ai page or a file */
type Entry =
  | { key: string; page: ClaudeArtifact; file?: never }
  | { key: string; file: ChatArtifact; page?: never };

interface Section {
  label: string;
  groups: { label: string; items: Entry[] }[];
}

const PAGE_SOURCE: Record<ClaudeArtifact['source'], string> = {
  published: 'Published',
  linked: 'Linked',
  read: 'Read only',
};

/** Name of a page: its title, else label, else the artifact id */
const pageName = (p: ClaudeArtifact) => p.title || p.label || p.url.split('/').pop() || p.url;

/** Facts of a page as label/value rows; empty values are left out */
function pageFacts(p: ClaudeArtifact, cwd: string): [string, string][] {
  const facts: [string, string | null][] = [
    ['Type', p.type],
    ['Status', PAGE_SOURCE[p.source]],
    ['Version', p.version != null ? String(p.version) : null],
    ['Updated', p.updatedAt != null ? new Date(p.updatedAt).toLocaleString() : null],
    ['Label', p.label],
    ['Description', p.description],
    ['Source', p.file && shownPath(p.file, cwd)],
    ['URL', p.url],
  ];
  return facts.filter((f): f is [string, string] => !!f[1]);
}

/** Facts shown in monospace */
const MONO_FACTS = new Set(['Source', 'URL']);

/** The page's details; its source file is previewed when it is one of the listed files */
const PageDetail: React.FC<{
  chatId: string;
  cwd: string;
  page: ClaudeArtifact;
  files: ChatArtifact[];
}> = ({ chatId, cwd, page, files }) => {
  const source = page.file ? files.find((f) => f.path === page.file) : undefined;
  return (
    <>
      <div className="flex items-center gap-2 min-h-10 px-3 py-1.5 border-b border-gray-800 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-gray-100 truncate">{pageName(page)}</div>
          <div className="text-[11px] text-gray-500 truncate" title={page.url}>
            Claude artifact · {page.type}
            {page.version != null && ` · version ${page.version}`}
          </div>
        </div>
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer noopener"
          className={`${actionBtn} !text-blue-300`}
        >
          <ExternalLink size={13} aria-hidden /> Open on claude.ai
        </a>
        <button
          type="button"
          className={actionBtn}
          disabled={!page.file}
          title={page.file ?? 'No local source known'}
          onClick={() => page.file && openFile(page.file, cwd, { editor: true })}
        >
          <Code2 size={13} aria-hidden /> Open source
        </button>
        <CopyButton text={page.url} label="Copy URL" className="!text-xs !px-2 !py-1" />
      </div>
      <div className="flex-1 min-h-0 overflow-auto thin-scrollbar bg-gray-950">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 px-4 py-3 text-xs border-b border-gray-800">
          {pageFacts(page, cwd).map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-gray-500">{k}</dt>
              <dd
                className={`min-w-0 break-words text-gray-200 ${MONO_FACTS.has(k) ? 'font-mono' : ''}`}
              >
                {v}
              </dd>
            </React.Fragment>
          ))}
        </dl>
        {source ? (
          <Preview key={source.path} chatId={chatId} cwd={cwd} artifact={source} />
        ) : page.file ? (
          <p className="px-4 py-3 text-xs text-gray-500">
            The source was not written in this session, so it has no preview here: open it with
            “Open source”.
          </p>
        ) : null}
      </div>
    </>
  );
};

/**
 * Everything the session produced, in two sections: Claude artifacts (pages hosted on
 * claude.ai) and Files (grouped Documents / Created / Edited); the selected one on the right.
 * Arrow keys move through the list, Esc closes.
 */
export const ChatArtifactsModal: React.FC<{
  chatId: string;
  cwd: string;
  title: string;
  artifacts: ChatArtifacts;
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

  const sections = useMemo((): Section[] => {
    const pages: Entry[] = artifacts.pages.map((page) => ({ key: `page:${page.url}`, page }));
    const files = GROUPS.map((g) => ({
      label: g.label,
      items: artifacts.files
        .filter(g.test)
        .map((file): Entry => ({ key: `file:${file.path}`, file })),
    })).filter((g) => g.items.length > 0);
    const all: Section[] = [
      { label: 'Claude Artifacts', groups: pages.length ? [{ label: '', items: pages }] : [] },
      { label: 'Files', groups: files },
    ];
    return all.filter((s) => s.groups.length > 0);
  }, [artifacts]);
  const ordered = useMemo(
    () => sections.flatMap((s) => s.groups.flatMap((g) => g.items)),
    [sections]
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(ordered[0]?.key ?? null);
  const selected = ordered.find((e) => e.key === selectedKey) ?? ordered[0] ?? null;

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected?.key]);

  const move = (delta: number | 'first' | 'last') => {
    if (ordered.length === 0) return;
    const index = selected ? ordered.indexOf(selected) : -1;
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? ordered.length - 1
          : Math.min(ordered.length - 1, Math.max(0, index + delta));
    setSelectedKey(ordered[next].key);
  };

  const optionId = (e: Entry) => `artifact-${ordered.indexOf(e)}`;
  const counts = [
    plural(countedPages(artifacts.pages), 'artifact'),
    plural(artifacts.files.length, 'file'),
  ].join(' · ');

  const row = (e: Entry) => {
    const isSelected = e === selected;
    const Icon = e.page ? Globe : e.file.kind === 'document' ? FileText : Code2;
    const sub = e.page
      ? [
          e.page.type,
          e.page.source !== 'published' && PAGE_SOURCE[e.page.source],
          e.page.version != null && `v${e.page.version}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : e.file.kind === 'document'
        ? 'session document'
        : shownPath(e.file.path, cwd).replace(/\/?[^/]*$/, '') || './';
    const time = e.page
      ? relativeTime(e.page.updatedAt)
      : e.file.exists
        ? relativeTime(e.file.mtime)
        : 'deleted';
    const dim = e.file ? !e.file.exists : e.page.source === 'read';
    return (
      <div
        key={e.key}
        id={optionId(e)}
        role="option"
        aria-selected={isSelected}
        data-artifact={e.page ? 'page' : 'file'}
        title={e.page ? e.page.url : e.file.path}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => {
          setSelectedKey(e.key);
          listRef.current?.focus({ preventScroll: true });
        }}
        className={`flex items-start gap-2 mx-1 px-2 py-1.5 rounded cursor-pointer ${
          isSelected ? 'bg-blue-500/15 text-gray-50' : 'text-gray-300 hover:bg-gray-800'
        }`}
      >
        <Icon
          size={13}
          aria-hidden
          className={`mt-0.5 shrink-0 ${isSelected ? 'text-blue-300' : e.page ? 'text-amber-300' : 'text-gray-500'}`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs ${dim ? 'text-gray-500' : ''} ${e.file && !e.file.exists ? 'line-through' : ''}`}
          >
            {e.page ? pageName(e.page) : e.file.name}
          </span>
          <span className={`block truncate text-[11px] text-gray-500 ${e.page ? '' : 'font-mono'}`}>
            {sub}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">{time}</span>
      </div>
    );
  };

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
            {counts} from {title}
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
            {sections.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">No artifacts in this session yet.</p>
            )}
            {sections.map((s) => (
              <div key={s.label} role="group" aria-label={s.label} className="mb-2">
                <div className="flex items-center justify-between px-3 pt-2 pb-1 text-xs font-semibold text-gray-200">
                  {s.label}
                  <span className="tabular-nums font-normal text-gray-500">
                    {s.groups.reduce((n, g) => n + g.items.length, 0)}
                  </span>
                </div>
                {s.groups.map((g) => (
                  <div key={g.label || s.label} className="mb-1">
                    {g.label && (
                      <div className="flex items-center justify-between px-3 pt-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        {g.label}
                        <span className="tabular-nums normal-case tracking-normal">
                          {g.items.length}
                        </span>
                      </div>
                    )}
                    {g.items.map(row)}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="min-w-0 min-h-0 flex flex-col">
            {selected?.page ? (
              <PageDetail chatId={chatId} cwd={cwd} page={selected.page} files={artifacts.files} />
            ) : selected?.file ? (
              <FileDetail chatId={chatId} cwd={cwd} file={selected.file} />
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

/** A file's path, actions and preview */
const FileDetail: React.FC<{ chatId: string; cwd: string; file: ChatArtifact }> = ({
  chatId,
  cwd,
  file,
}) => (
  <>
    <div className="flex items-center gap-2 min-h-10 px-3 py-1.5 border-b border-gray-800 shrink-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-100 truncate">{file.name}</div>
        <div className="text-[11px] text-gray-500 font-mono truncate" title={file.path}>
          {shownPath(file.path, cwd)}
          {file.size != null && ` · ${formatSize(file.size)}`}
        </div>
      </div>
      <button
        type="button"
        className={actionBtn}
        disabled={!file.exists}
        onClick={() => openFile(file.path, cwd, { editor: true })}
      >
        <Code2 size={13} aria-hidden /> Open in VS Code
      </button>
      <button
        type="button"
        className={actionBtn}
        disabled={!file.exists}
        onClick={() => openFile(file.path, cwd, { reveal: true })}
      >
        <FolderOpen size={13} aria-hidden /> Reveal in Finder
      </button>
      <CopyButton text={file.path} label="Copy path" className="!text-xs !px-2 !py-1" />
    </div>
    <div className="flex-1 min-h-0 overflow-auto thin-scrollbar bg-gray-950">
      <Preview key={file.path} chatId={chatId} cwd={cwd} artifact={file} />
    </div>
  </>
);
