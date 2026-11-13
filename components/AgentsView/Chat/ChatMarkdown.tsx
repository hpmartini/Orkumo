import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { findFilePaths, type FilePathMatch } from '../../../utils/fileLinks';
import { openFile } from '../../../utils/openFile';

/**
 * Session directory file paths in the markdown resolve against. Without it (no session behind
 * the text) paths stay plain text.
 */
export const ChatFileContext = createContext<string | null>(null);

const focusRing = 'focus-visible:outline-2 focus-visible:outline-blue-400';
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const MOD = isMac ? 'Cmd' : 'Ctrl';

/** The whole text is one file path (`src/x.ts`, `/abs/y.md:12`), else null */
export function wholeFilePath(text: string): FilePathMatch | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 1024 || trimmed.includes('\n')) return null;
  const [match] = findFilePaths(trimmed);
  return match && match.start === 0 && match.end === trimmed.length ? match : null;
}

/** Text of a hast node (the fenced block's code, for the copy button) */
type HastNode = {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: { className?: unknown };
};
const hastText = (node: HastNode | undefined): string =>
  !node
    ? ''
    : node.type === 'text'
      ? (node.value ?? '')
      : (node.children ?? []).map(hastText).join('');

/** Copy button with a short "Copied" confirmation */
export const CopyButton: React.FC<{ text: string; label?: string; className?: string }> = ({
  text,
  label = 'Copy',
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false)
        );
      }}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 ${focusRing} ${className}`}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? (
        <Check size={12} aria-hidden className="text-emerald-400" />
      ) : (
        <Copy size={12} aria-hidden />
      )}
      {copied ? 'Copied' : label}
    </button>
  );
};

const CodeBlock: React.FC<React.ComponentProps<'pre'> & ExtraProps> = ({ node, children }) => {
  const code = (node?.children?.[0] ?? undefined) as HastNode | undefined;
  const classes = code?.properties?.className;
  const language = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((c) => c.startsWith('language-'))
    ?.slice('language-'.length);
  const text = hastText(code).replace(/\n$/, '');
  return (
    <div className="my-2.5 rounded-md border border-gray-800 bg-gray-950 overflow-hidden">
      <div className="flex items-center gap-2 h-7 pl-3 pr-1 border-b border-gray-800 bg-gray-900/70">
        <span className="font-mono text-[11px] text-gray-400">{language || 'text'}</span>
        <CopyButton text={text} label="Copy" className="ml-auto" />
      </div>
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed text-gray-200">{children}</pre>
    </div>
  );
};

/** Inline code naming a file: Cmd/Ctrl-click opens it in VS Code, with Shift in its default app */
const InlineCode: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const cwd = useContext(ChatFileContext);
  const text = typeof children === 'string' ? children : '';
  const match = cwd ? wholeFilePath(text) : null;
  const base = 'font-mono text-[0.85em] px-1 py-0.5 rounded bg-gray-800/80 text-pink-200';
  if (!match || !cwd) return <code className={base}>{children}</code>;
  return (
    <code
      className={`${base} cursor-pointer decoration-pink-300/40 decoration-dotted underline-offset-2 hover:underline`}
      title={`${MOD}-click: open in VS Code`}
      onClick={(e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        void openFile(match.path, cwd, { editor: !e.shiftKey, line: match.line, col: match.col });
      }}
    >
      {children}
    </code>
  );
};

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Web links open in a new tab; a link to a file path opens that file in VS Code */
const Link: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps> = ({
  node: _node,
  href,
  children,
  ...rest
}) => {
  const cwd = useContext(ChatFileContext);
  const match = cwd && href && !URL_SCHEME_RE.test(href) ? wholeFilePath(decodeURI(href)) : null;
  if (match && cwd)
    return (
      <a
        href={href}
        className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200"
        title={`Open in VS Code (${MOD}+Shift: default app)`}
        onClick={(e) => {
          e.preventDefault();
          void openFile(match.path, cwd, {
            editor: !e.shiftKey,
            line: match.line,
            col: match.col,
          });
        }}
      >
        {children}
      </a>
    );
  return (
    <a
      {...rest}
      href={href}
      className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
};

/** GFM rendered with Tailwind classes (no typography plugin in this app) */
const components: Components = {
  h1: ({ node: _n, ...p }) => (
    <h1 className="text-lg font-semibold text-gray-50 mt-5 mb-2 leading-snug" {...p} />
  ),
  h2: ({ node: _n, ...p }) => (
    <h2
      className="text-base font-semibold text-gray-50 mt-5 mb-2 pb-1 border-b border-gray-800 leading-snug"
      {...p}
    />
  ),
  h3: ({ node: _n, ...p }) => (
    <h3 className="text-sm font-semibold text-gray-100 mt-4 mb-1.5" {...p} />
  ),
  h4: ({ node: _n, ...p }) => <h4 className="text-sm font-medium text-gray-200 mt-3 mb-1" {...p} />,
  // No remote image loads: a prompt-injected ![](https://host/?q=<secret>) would leak data
  img: ({ alt, src }) => (
    <span className="text-gray-400" title={typeof src === 'string' ? src : undefined}>
      [image{alt ? `: ${alt}` : ''}]
    </span>
  ),
  p: ({ node: _n, ...p }) => <p className="my-2 leading-relaxed" {...p} />,
  ul: ({ node: _n, className, ...p }) => (
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'my-2 pl-1 space-y-0.5'
          : 'my-2 pl-5 list-disc space-y-0.5 marker:text-gray-500'
      }
      {...p}
    />
  ),
  ol: ({ node: _n, ...p }) => (
    <ol className="my-2 pl-6 list-decimal space-y-0.5 marker:text-gray-500" {...p} />
  ),
  li: ({ node: _n, className, ...p }) => (
    <li
      className={
        className?.includes('task-list-item') ? 'list-none flex items-start gap-2' : 'pl-0.5'
      }
      {...p}
    />
  ),
  // GFM task list boxes are read-only state
  input: ({ node: _n, checked, type }) =>
    type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={!!checked}
        readOnly
        disabled
        aria-label={checked ? 'Done' : 'Open'}
        className="mt-[0.3em] shrink-0 accent-blue-500"
      />
    ) : null,
  a: Link,
  blockquote: ({ node: _n, ...p }) => (
    <blockquote className="my-2 pl-3 border-l-2 border-gray-700 text-gray-300" {...p} />
  ),
  hr: () => <hr className="my-4 border-gray-800" />,
  table: ({ node: _n, ...p }) => (
    <div className="my-2.5 overflow-x-auto rounded-md border border-gray-800">
      <table className="w-full text-xs border-collapse" {...p} />
    </div>
  ),
  thead: ({ node: _n, ...p }) => <thead className="bg-gray-900" {...p} />,
  tr: ({ node: _n, ...p }) => (
    <tr className="border-b border-gray-800 last:border-b-0 even:bg-gray-900/40" {...p} />
  ),
  th: ({ node: _n, style, ...p }) => (
    <th
      className="px-2.5 py-1.5 text-left font-medium text-gray-200 whitespace-nowrap"
      style={style}
      {...p}
    />
  ),
  td: ({ node: _n, style, ...p }) => (
    <td className="px-2.5 py-1.5 align-top text-gray-300 tabular-nums" style={style} {...p} />
  ),
  pre: CodeBlock,
  code: ({ node: _n, className, children, ...rest }) =>
    // Fenced blocks carry a language class or a newline; everything else is inline code
    className || String(children).includes('\n') ? (
      <code className={`font-mono ${className ?? ''}`} {...rest}>
        {children}
      </code>
    ) : (
      <InlineCode>{children}</InlineCode>
    ),
};

export const ChatMarkdown: React.FC<{ text: string }> = React.memo(({ text }) => (
  <div className="text-sm text-gray-200 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  </div>
));
ChatMarkdown.displayName = 'ChatMarkdown';
