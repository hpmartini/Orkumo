import React, { useRef } from 'react';
import type { AgentSession } from '../../types';
import { useDialogA11y } from '../CommandPalette/useDialogA11y';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';

/** Asks before a resume that puts a second writer on a transcript another process holds (#236) */
export const CopyWarningDialog: React.FC<{
  holder: AgentSession;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ holder, onConfirm, onClose }) => {
  const dialogRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => cancelRef.current);
  // Orkumo stops a job or chat before it resumes the session elsewhere; a foreign terminal keeps running
  const handover = holder.kind === 'background' || !!holder.chat;
  const what = holder.chat
    ? 'a chat'
    : holder.kind === 'background'
      ? `background job ${holder.id}`
      : 'a running terminal';
  return (
    <div
      className="fixed inset-0 z-[90] bg-gray-950/70 flex items-start justify-center px-4 pt-[15vh]"
      onMouseDown={onClose}
    >
      <form
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="copy-warning-title"
        aria-describedby="copy-warning-text"
        tabIndex={-1}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-gray-800 border border-amber-500/50 rounded-xl shadow-2xl p-4 text-sm"
      >
        <h2 id="copy-warning-title" className="font-semibold text-amber-200 mb-2">
          Erzeugt Kopie
        </h2>
        <p id="copy-warning-text" className="text-gray-300 break-words">
          &quot;{holder.name}&quot; runs as {what}.{' '}
          {handover
            ? 'Continuing it here stops that process and starts a new one on the same session'
            : 'Resuming it here starts a second process on the same session'}{' '}
          in <span className="font-mono text-xs">{holder.cwd}</span>
          {handover ? '.' : "; both can overwrite each other's work."}
        </p>
        <div className="flex justify-end gap-2 mt-4 text-xs">
          <button
            type="button"
            ref={cancelRef}
            onClick={onClose}
            className={`px-3 py-1.5 rounded-md text-gray-200 hover:bg-gray-700 ${FOCUS}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`px-3 py-1.5 rounded-md font-medium text-gray-950 bg-amber-400 hover:bg-amber-300 ${FOCUS}`}
          >
            Create copy
          </button>
        </div>
      </form>
    </div>
  );
};
