import React, { useEffect, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useDialogA11y } from '../CommandPalette/useDialogA11y';

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navigate',
    rows: [
      ['↑ / ↓', 'Move between rows'],
      ['Cmd/Ctrl+P', 'Command palette: > commands, @ agents, # projects'],
      ['N / Alt+N', 'New task (opens the task composer)'],
      ['Enter', 'Attach to the selected session'],
      ['→', 'Attach to the selected session'],
      ['Space', 'Open / close the peek panel'],
      ['Alt+1 … Alt+9', 'Attach to session 1-9 in the focused directory'],
      ['Enter on a group', 'Collapse / expand the group'],
      ['Esc', 'Close peek panel'],
      ['Ctrl+C', 'Press twice to leave the agents view'],
      ['?', 'Show this overlay'],
    ],
  },
  {
    title: 'New task / agent (composer)',
    rows: [
      ['Cmd/Ctrl+Enter', 'Dispatch (New agent: start and attach)'],
      ['Cmd/Ctrl+Shift+Enter', 'Dispatch and attach immediately'],
      ['Enter / Ctrl+J', 'Insert a newline'],
      ['Tab', 'Apply the highlighted suggestion'],
      ['Esc', 'Close the composer (the draft is kept)'],
      ['Ctrl+G', 'Edit the prompt in a larger editor'],
      ['@agent / <agent> …', 'Run a custom subagent'],
      ['@repo …', 'Dispatch into another repository'],
      ['! command', 'Run a shell command as a background job'],
      ['/resume · /model · /effort', 'Resume a past session, set dispatch model / effort'],
      ['a:name · s:state · #123 · URL', 'Filter the list instead of dispatching'],
    ],
  },
  {
    title: 'Manage',
    rows: [
      ['Ctrl+S', 'Toggle grouping: state ↔ directory'],
      ['Ctrl+T (Alt+P)', 'Pin / unpin the selected session'],
      ['Ctrl+R', 'Rename the selected session'],
      ['Shift+↑ / Shift+↓', 'Reorder the selected session or group'],
      ['Shift+F', 'Favorite / unfavorite the selected session or group'],
      ['Ctrl+X', 'Delete session (with confirmation)'],
      ['Ctrl+X on a group', 'Delete all sessions in the group (with confirmation)'],
    ],
  },
  {
    title: 'Attached terminal',
    rows: [
      ['Ctrl+Z', 'Detach - the session keeps running'],
      ['← on an empty prompt', 'Return to the agent view (CLI behaviour)'],
      ['/bg · /fork', 'Background / fork the conversation from inside the session'],
      ['Ctrl+O', 'Transcript mode'],
    ],
  },
];

export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ open, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogA11y(open, dialogRef, () => dialogRef.current);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950/70 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={trapTab}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 sticky top-0 bg-gray-900">
          <Keyboard size={16} className="text-blue-300" />
          <h3 id="shortcuts-title" className="text-sm font-semibold text-gray-100">
            Agent view shortcuts
          </h3>
          <span className="text-xs text-gray-500">
            Ctrl+T is reserved by most browsers - use Alt+P there (Ctrl+T works in the desktop app).
          </span>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 p-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="text-xs font-semibold text-gray-300 mb-2">{section.title}</div>
              <table className="w-full text-sm">
                <tbody>
                  {section.rows.map(([keys, desc]) => (
                    <tr key={keys} className="border-t border-gray-800/60">
                      <td className="py-1 pr-3 font-mono text-xs text-blue-300 whitespace-nowrap align-top">
                        {keys}
                      </td>
                      <td className="py-1 text-gray-300">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
