import React, { useEffect, useState } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  ExternalLink,
  ImageIcon,
  Link2,
  Wrench,
} from 'lucide-react';
import type { ChatPart, ChatProvider } from '../../services/chatHistoryApi';
import {
  ChatMarkdown,
  CopyButton,
} from '@hpmartini/agents-ui/components/AgentsView/Chat/ChatMarkdown';

type Artifact = Extract<ChatPart, { type: 'artifact' }>;
type Tool = Extract<ChatPart, { type: 'tool' }>;

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const CARD = 'my-2 rounded-lg border border-gray-700 bg-gray-950/60';

const KIND_LABEL: Record<string, string> = {
  'text/markdown': 'Document',
  'text/html': 'Web page',
  'image/svg+xml': 'SVG',
  'application/vnd.ant.react': 'React component',
  'application/vnd.ant.mermaid': 'Diagram',
  'application/vnd.ant.code': 'Code',
};

const formatSize = (bytes?: number) =>
  bytes == null
    ? ''
    : bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** http(s) only: a stored chat must never turn into a javascript: link */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

/**
 * Rendered artifact. Pages and SVG run in an iframe without same-origin (no access to Orkumo,
 * its storage or the API); everything else shows as Markdown or code.
 */
const ArtifactBody: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { kind, content, language } = artifact;
  if (kind === 'text/html' || kind === 'image/svg+xml')
    return (
      <iframe
        title={artifact.title}
        sandbox="allow-scripts"
        srcDoc={
          kind === 'image/svg+xml'
            ? `<!doctype html><body style="margin:0;display:grid;place-items:center;background:#fff">${content}</body>`
            : content
        }
        className="w-full h-[28rem] bg-white rounded-b-lg"
      />
    );
  if (kind === 'text/markdown')
    return (
      <div className="px-4 py-3">
        <ChatMarkdown text={content} />
      </div>
    );
  const fence = language ?? (kind === 'application/vnd.ant.mermaid' ? 'mermaid' : 'tsx');
  return (
    <div className="px-2 py-1">
      <ChatMarkdown text={`\`\`\`${fence}\n${content}\n\`\`\``} />
    </div>
  );
};

/** Artifact / canvas card in the flow of the chat; opens in place */
const ArtifactCard: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const [open, setOpen] = useState(false);
  const label = KIND_LABEL[artifact.kind] ?? 'Artifact';
  return (
    <div className={CARD} data-part="artifact">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`flex flex-1 min-w-0 items-center gap-2 text-left ${FOCUS}`}
        >
          {artifact.kind === 'text/markdown' ? (
            <FileText size={16} className="shrink-0 text-amber-300" aria-hidden />
          ) : (
            <Code2 size={16} className="shrink-0 text-amber-300" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm text-gray-100">{artifact.title}</span>
            <span className="block text-[11px] text-gray-400">
              {label}
              {artifact.version > 1 && ` · version ${artifact.version}`}
            </span>
          </span>
          <span className="ml-auto text-xs text-gray-300">{open ? 'Hide' : 'Open'}</span>
        </button>
        <CopyButton text={artifact.content} label="Copy artifact" />
      </div>
      {open && (
        <div className="border-t border-gray-800 max-h-[36rem] overflow-auto">
          <ArtifactBody artifact={artifact} />
        </div>
      )}
    </div>
  );
};

/** Uploaded or generated image, fetched in the desktop app's main process with the login there */
const ChatImage: React.FC<{ provider: ChatProvider; name?: string; asset?: string }> = ({
  provider,
  name,
  asset,
}) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.chatSync;
    if (!asset || !api?.asset) return;
    let cancelled = false;
    api
      .asset(provider, asset)
      .then((url) => !cancelled && setSrc(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [provider, asset]);
  return src ? (
    <img
      src={src}
      alt={name ?? 'Image'}
      className="my-2 max-h-80 max-w-full rounded-lg border border-gray-700"
    />
  ) : (
    <span
      className="my-1 inline-flex items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-xs text-gray-300"
      data-part="image"
    >
      <ImageIcon size={13} aria-hidden className="text-gray-400" />
      {name ?? 'Image'}
    </span>
  );
};

/** Uploaded file; the text the provider extracted from it opens in place */
const FileChip: React.FC<{ part: Extract<ChatPart, { type: 'file' }> }> = ({ part }) => {
  const [open, setOpen] = useState(false);
  const meta = [part.mime, formatSize(part.size)].filter(Boolean).join(' · ');
  return (
    <div className="my-1" data-part="file">
      <button
        type="button"
        onClick={() => part.content && setOpen((o) => !o)}
        aria-expanded={part.content ? open : undefined}
        className={`inline-flex max-w-full items-center gap-1.5 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 ${part.content ? 'hover:bg-gray-800' : 'cursor-default'} ${FOCUS}`}
      >
        <FileText size={13} aria-hidden className="shrink-0 text-gray-400" />
        <span className="truncate">{part.name}</span>
        {meta && <span className="shrink-0 text-gray-400">{meta}</span>}
      </button>
      {open && part.content && (
        <pre className="mt-1 max-h-64 overflow-auto rounded border border-gray-800 bg-gray-950 p-2 text-xs text-gray-300 whitespace-pre-wrap">
          {part.content}
        </pre>
      )}
    </div>
  );
};

/** Collapsed block (thinking, tool call): a summary line, the details on demand */
const Disclosure: React.FC<{
  icon: React.ReactNode;
  summary: React.ReactNode;
  children: React.ReactNode;
  part: string;
}> = ({ icon, summary, children, part }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 text-xs" data-part={part}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 ${FOCUS}`}
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        {icon}
        <span className="truncate">{summary}</span>
      </button>
      {open && <div className="mt-1 ml-5 space-y-1">{children}</div>}
    </div>
  );
};

const ToolLine: React.FC<{ part: Extract<ChatPart, { type: 'tool' }> }> = ({ part }) => (
  <Disclosure
    part="tool"
    icon={
      /search/i.test(part.name) ? <Globe size={12} aria-hidden /> : <Wrench size={12} aria-hidden />
    }
    summary={
      <>
        <span className="text-gray-300">{part.name}</span>
        {part.input && <span className="ml-1.5 font-mono">{part.input.split('\n')[0]}</span>}
        {part.error && <span className="ml-1.5 text-red-300">failed</span>}
      </>
    }
  >
    {part.input && (
      <pre className="max-h-48 overflow-auto rounded bg-gray-950 border border-gray-800 p-2 text-gray-300 whitespace-pre-wrap">
        {part.input}
      </pre>
    )}
    {part.output && (
      <pre
        className={`max-h-64 overflow-auto rounded bg-gray-950 border border-gray-800 p-2 whitespace-pre-wrap ${part.error ? 'text-red-300' : 'text-gray-300'}`}
      >
        {part.output}
      </pre>
    )}
  </Disclosure>
);

const Sources: React.FC<{ items: { title: string; url: string }[] }> = ({ items }) => {
  const links = items.filter((s) => safeUrl(s.url));
  if (!links.length) return null;
  return (
    <div className="my-2" data-part="sources">
      <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-400">
        <Link2 size={11} aria-hidden /> Sources
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {links.map((s, i) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              title={s.url}
              className={`inline-flex max-w-[16rem] items-center gap-1 rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-300 hover:text-white hover:bg-gray-800 ${FOCUS}`}
            >
              <span className="tabular-nums text-gray-500">{i + 1}</span>
              <span className="truncate">{s.title || new URL(s.url).hostname}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
};

/** A page published on claude.ai by the Artifact tool (Claude Code on the web, Cowork) */
export interface PublishedArtifact {
  url: string;
  title: string;
  version?: number;
  /** the title came from the call itself, not from the file name */
  named?: boolean;
}

const PUBLISHED =
  /(?:Published (\S+) at|(?:Created a new|Updated the) Artifact at) (https:\/\/claude\.ai\/artifact\/[\w-]+)/;

/** The artifact a publish call created or updated; reads and data writes are no artifact of their own */
export function publishedArtifact(part: Tool): PublishedArtifact | null {
  const hit =
    part.name === 'Artifact' && part.output && !part.error ? PUBLISHED.exec(part.output) : null;
  if (!hit) return null;
  let title: string | undefined;
  try {
    const input: unknown = JSON.parse(part.input ?? '');
    if (input && typeof input === 'object' && 'title' in input && typeof input.title === 'string')
      title = input.title;
  } catch {
    // input was not JSON (shortened to the artifact URL): the file name stands in
  }
  const version = /\(Version (\d+)/.exec(part.output ?? '');
  return {
    url: hit[2],
    title:
      title ??
      (hit[1] ?? / with (\S+)/.exec(part.output ?? '')?.[1])?.split('/').pop() ??
      'Artifact',
    version: version ? Number(version[1]) : undefined,
    named: title !== undefined,
  };
}

/** Card of a published artifact; it opens next to the chat, where the login of the site is */
const PublishedCard: React.FC<{ artifact: PublishedArtifact; onOpen?: (url: string) => void }> = ({
  artifact,
  onOpen,
}) => (
  <a
    href={artifact.url}
    target="_blank"
    rel="noreferrer noopener"
    onClick={(e) => {
      if (!onOpen) return;
      e.preventDefault();
      onOpen(artifact.url);
    }}
    className={`${CARD} flex items-center gap-2 px-3 py-2 hover:bg-gray-900 ${FOCUS}`}
    data-part="published-artifact"
  >
    <Code2 size={16} className="shrink-0 text-amber-300" aria-hidden />
    <span className="min-w-0">
      <span className="block truncate text-sm text-gray-100">{artifact.title}</span>
      <span className="block text-[11px] text-gray-400">
        Artifact{artifact.version && artifact.version > 1 ? ` · version ${artifact.version}` : ''}
      </span>
    </span>
    <ExternalLink size={14} className="ml-auto shrink-0 text-gray-400" aria-hidden />
  </a>
);

/** Parts that stay in sight when the work before an answer folds away */
const KEPT = new Set<ChatPart['type']>(['artifact', 'file', 'image', 'sources']);

const isStep = (part: ChatPart) => part.type === 'thinking' || part.type === 'tool';

/**
 * Thinking and tool calls in a row fold into one line, as in the Claude and ChatGPT apps; the
 * artifacts they published stay visible below it (the last version of each).
 */
const Steps: React.FC<{
  parts: ChatPart[];
  provider: ChatProvider;
  onOpenUrl?: (url: string) => void;
  kept: ChatPart[];
}> = ({ parts, provider, onOpenUrl, kept }) => {
  const tools = parts.filter((p): p is Tool => p.type === 'tool');
  const thought = parts.some((p) => p.type === 'thinking');
  const published = new Map<string, PublishedArtifact>();
  for (const tool of tools) {
    const artifact = publishedArtifact(tool);
    // a later update often names only the URL: the title it was published with stays
    if (artifact)
      published.set(artifact.url, {
        ...artifact,
        title: artifact.named
          ? artifact.title
          : (published.get(artifact.url)?.title ?? artifact.title),
      });
  }
  const summary = [
    thought && 'Thinking',
    tools.length && `${tools.length} tool call${tools.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Disclosure
        part="steps"
        icon={tools.length ? <Wrench size={12} aria-hidden /> : <Brain size={12} aria-hidden />}
        summary={summary}
      >
        <PartList parts={parts.filter((p) => !KEPT.has(p.type))} provider={provider} />
      </Disclosure>
      <PartList parts={kept} provider={provider} />
      {[...published.values()].map((a) => (
        <PublishedCard key={a.url} artifact={a} onOpen={onOpenUrl} />
      ))}
    </>
  );
};

const PartList: React.FC<{ parts: ChatPart[]; provider: ChatProvider; user?: boolean }> = ({
  parts,
  provider,
  user = false,
}) => (
  <>
    {parts.map((part, i) => {
      switch (part.type) {
        case 'text':
          return user ? (
            <div key={i} className="whitespace-pre-wrap break-words">
              {part.text}
            </div>
          ) : (
            <ChatMarkdown key={i} text={part.text} />
          );
        case 'thinking':
          return (
            <Disclosure
              key={i}
              part="thinking"
              icon={<Brain size={12} aria-hidden />}
              summary="Thinking"
            >
              <p className="text-gray-400 whitespace-pre-wrap">{part.text}</p>
            </Disclosure>
          );
        case 'artifact':
          return <ArtifactCard key={i} artifact={part} />;
        case 'file':
          return <FileChip key={i} part={part} />;
        case 'image':
          return <ChatImage key={i} provider={provider} name={part.name} asset={part.asset} />;
        case 'tool':
          return <ToolLine key={i} part={part} />;
        case 'sources':
          return <Sources key={i} items={part.items} />;
        default:
          return null;
      }
    })}
  </>
);

/**
 * Everything of one message, or of one answer over several tool rounds, in the order shown. As in
 * the Claude and ChatGPT apps, the work before the final text (thinking, tool calls, the notes in
 * between) folds into one line; artifacts, files, images and sources from it stay visible.
 */
export const ChatParts: React.FC<{
  parts: ChatPart[];
  provider: ChatProvider;
  user?: boolean;
  onOpenUrl?: (url: string) => void;
}> = ({ parts, provider, user = false, onOpenUrl }) => {
  let end = parts.length;
  while (end > 0 && !isStep(parts[end - 1])) end--;
  if (user || end === 0) return <PartList parts={parts} provider={provider} user={user} />;
  const work = parts.slice(0, end);
  return (
    <>
      <Steps
        parts={work}
        provider={provider}
        onOpenUrl={onOpenUrl}
        kept={work.filter((p) => KEPT.has(p.type))}
      />
      <PartList parts={parts.slice(end)} provider={provider} />
    </>
  );
};
