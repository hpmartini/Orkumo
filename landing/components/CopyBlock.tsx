import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/utils';

export function CopyBlock({ commands, className }: { commands: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the commands stay selectable */
    }
  };

  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-[6px] border border-hairline bg-[#080b0f]',
        className
      )}
    >
      <pre className="min-w-0 flex-1 overflow-x-auto p-3 font-mono text-[12.5px] leading-6 text-paper/90 sm:text-[13px]">
        {commands.split('\n').map((line) => (
          <div key={line}>
            <span className="select-none text-signal-yellow">$ </span>
            {line}
          </div>
        ))}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy commands'}
        className="mt-1.5 mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[4px] bg-[#080b0f] text-muted hover:bg-[#151b23] hover:text-paper"
      >
        {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
      </button>
      <span className="sr-only" role="status">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}
