import React, { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navigate',
    rows: [
      ['↑ / ↓', 'Move between rows'],
      ['Enter', 'Attach to session (or dispatch if the input has text)'],
      ['→', 'Attach to the selected session'],
      ['Space', 'Open / close the peek panel'],
      ['Alt+1 … Alt+9', 'Attach to session 1-9 in the focused directory'],
      ['Enter on a group', 'Collapse / expand the group'],
      ['Esc', 'Close peek panel, clear the input'],
      ['Ctrl+C', 'Clear input; press twice to leave the agents view'],
      ['?', 'Show this overlay'],
    ],
  },
  {
    title: 'Dispatch',
    rows: [
      ['Enter', 'Dispatch a new background session'],
      ['Ctrl+Enter', 'Dispatch and attach immediately'],
      ['Shift+Enter / Ctrl+J', 'Insert a newline'],
      ['Tab', 'Browse subagents (empty input) or apply a suggestion'],
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
      ['Shift+↑ / Shift+↓', 'Reorder the selected session'],
      ['Ctrl+X', 'Stop session; press again within 2 s to delete'],
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
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 sticky top-0 bg-gray-900">
          <Keyboard size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-100">Agent view shortcuts</h3>
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
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                {section.title}
              </div>
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
