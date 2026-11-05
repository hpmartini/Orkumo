import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** GFM rendered with Tailwind classes (no typography plugin in this app) */
const components: Components = {
  h1: (p) => <h1 className="text-lg font-semibold text-gray-50 mt-4 mb-2" {...p} />,
  h2: (p) => <h2 className="text-base font-semibold text-gray-50 mt-4 mb-2" {...p} />,
  h3: (p) => <h3 className="text-sm font-semibold text-gray-100 mt-3 mb-1.5" {...p} />,
  // No remote image loads: a prompt-injected ![](https://host/?q=<secret>) would leak data
  img: ({ alt, src }) => (
    <span className="text-gray-400" title={typeof src === 'string' ? src : undefined}>
      [image{alt ? `: ${alt}` : ''}]
    </span>
  ),
  p: (p) => <p className="my-2 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 pl-5 list-disc space-y-0.5" {...p} />,
  ol: (p) => <ol className="my-2 pl-8 list-decimal space-y-0.5" {...p} />,
  a: (p) => (
    <a
      className="text-blue-300 underline hover:text-blue-200"
      target="_blank"
      rel="noreferrer"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote className="my-2 pl-3 border-l-2 border-gray-600 text-gray-300" {...p} />
  ),
  hr: () => <hr className="my-3 border-gray-700" />,
  table: (p) => (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs border-collapse" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-gray-700 px-2 py-1 text-left bg-gray-800" {...p} />,
  td: (p) => <td className="border border-gray-700 px-2 py-1 align-top" {...p} />,
  pre: (p) => (
    <pre
      className="my-2 p-3 rounded-md bg-gray-950 border border-gray-800 overflow-x-auto text-xs leading-snug"
      {...p}
    />
  ),
  code: ({ className, children, ...rest }) =>
    // Fenced blocks carry a language class or a newline; everything else is inline code
    className || String(children).includes('\n') ? (
      <code className={`font-mono ${className ?? ''}`} {...rest}>
        {children}
      </code>
    ) : (
      <code
        className="font-mono text-[0.85em] px-1 py-0.5 rounded bg-gray-800 text-pink-200"
        {...rest}
      >
        {children}
      </code>
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
