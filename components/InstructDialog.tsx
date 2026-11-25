import { useRef, useState, useSyncExternalStore } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useDialogA11y } from '@hpmartini/agents-ui/components/CommandPalette/useDialogA11y';
import {
  ImageAttachments,
  imageDropHandlers,
} from '@hpmartini/agents-ui/components/ImageAttachments';
import { attachableFiles, submitIntent } from '@hpmartini/agents-ui/utils/composer';
import { uploadAttachment } from '../services/agentsApi';
import { instructOrchestrator } from '../services/orchestratorApi';
import { ATTACHMENT_EXTENSIONS } from '../config/limits.js';

/** What a module UI hands `host.instruct` (docs/MODULES.md): the item the message is about */
export interface InstructTarget {
  orchestrator: string;
  orchestratorName?: string;
  entry?: string;
  task?: { project: string; task: string };
  title: string;
  project?: string;
  /** Agent pane the Status view runs in (set by the host, not the module): its instance gets the message */
  session?: string;
}

// One dialog for the whole app; module UIs open it through the host, outside React
let current: InstructTarget | null = null;
const listeners = new Set<() => void>();
const set = (next: InstructTarget | null) => {
  current = next;
  listeners.forEach((l) => l());
};
export const openInstruct = (target: InstructTarget) => set(target);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'delivered' }
  | { kind: 'error'; message: string };

function Dialog({ target, onClose }: { target: InstructTarget; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => textRef.current);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const name = target.orchestratorName || target.orchestrator;
  const busy = phase.kind === 'sending';
  const done = phase.kind === 'delivered';
  const ref = target.entry
    ? `entry ${target.entry}`
    : target.task
      ? `task ${target.task.task}`
      : '';
  const header = `[Status] ${[target.project, target.title].filter(Boolean).join(' · ')}${ref ? ` (${ref})` : ''}`;
  const add = (more: File[]) => setFiles((prev) => [...prev, ...more]);

  const send = async () => {
    if (busy || done || !text.trim()) return;
    setPhase({ kind: 'sending' });
    try {
      const attachments = await Promise.all(
        files.map((file) => uploadAttachment(file, target.session))
      );
      await instructOrchestrator(
        target.orchestrator,
        {
          ...(target.entry ? { entry: target.entry } : { task: target.task }),
          text: text.trim(),
          attachments,
        },
        target.session
      );
      setPhase({ kind: 'delivered' });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-gray-950/70 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={() => !busy && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="instruct-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape' && !busy) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        {...imageDropHandlers(add, (l) => attachableFiles(l, ATTACHMENT_EXTENSIONS))}
        className="flex flex-col w-[560px] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-auto bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4"
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="min-w-0">
            <h2 id="instruct-title" className="text-sm font-semibold text-gray-50">
              Instruct {name}
            </h2>
            <p className="mt-1 font-mono text-xs text-gray-400 break-words">{header}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto p-1.5 rounded-md text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <label htmlFor="instruct-text" className="sr-only">
          Message to {name}
        </label>
        <textarea
          id="instruct-text"
          ref={textRef}
          value={text}
          disabled={busy || done}
          onChange={(e) => {
            setText(e.target.value);
            if (phase.kind === 'error') setPhase({ kind: 'idle' });
          }}
          onKeyDown={(e) => {
            if (submitIntent(e)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={6}
          placeholder="What should happen? Paste or drop images and files here."
          className="w-full resize-y rounded-md bg-gray-900 border border-gray-600 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-blue-400"
        />
        <ImageAttachments
          images={files}
          onChange={setFiles}
          disabled={busy || done}
          files={ATTACHMENT_EXTENSIONS}
        />
        <div className="flex items-center gap-3 mt-4 text-sm">
          <p aria-live="polite" className="min-w-0 flex-1 text-xs">
            {phase.kind === 'sending' && <span className="text-gray-300">Sending to {name}…</span>}
            {done && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Check size={13} aria-hidden="true" /> Delivered to {name}
              </span>
            )}
            {phase.kind === 'error' && (
              <span role="alert" className="text-red-300">
                Not delivered: {phase.message}
              </span>
            )}
          </p>
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-gray-700 text-gray-50 hover:bg-gray-600"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-gray-200 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !text.trim()}
                title="Send (⌘/Ctrl+Enter)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                {phase.kind === 'error' ? 'Send again' : 'Send'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Instruct dialog of module UIs (Status view); mount once inside the AgentsProvider */
export function InstructDialog() {
  const target = useSyncExternalStore(subscribe, () => current);
  // keyed by target so every opening starts empty
  return target ? (
    <Dialog
      key={`${target.orchestrator} ${target.entry ?? target.task?.task}`}
      target={target}
      onClose={() => set(null)}
    />
  ) : null;
}
