import React from 'react';
import type { BoardLabel, BoardRepoOptions } from '../../types';
import {
  BUILD_LABEL,
  DYNAMIC_LABEL,
  GO_LABEL,
  MODE_LABELS,
  NEED_INPUT_LABEL,
  currentMode,
  setMode,
  toggleLabel,
  type FlowMode,
} from '../../utils/issueControls';
import { labelsFor } from './IssueFields';
import type { IssueSave } from './IssueEditors';

const MODES: { mode: FlowMode; label: string }[] = [
  { mode: 'default', label: 'Default' },
  { mode: 'orchestrate', label: 'Orchestrate' },
  { mode: 'pipeline', label: 'Pipeline' },
  { mode: 'image', label: 'Image' },
];

const BTN =
  'px-2 py-1 rounded border text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const btnState = (on: boolean) =>
  on
    ? 'border-cursor/60 bg-cursor/15 text-white'
    : 'border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800';

/** mw-board control labels as buttons; a label missing in the repo disables its button */
export const FlowControls: React.FC<{
  labels: BoardLabel[];
  repoOptions: BoardRepoOptions | null;
  onSave: IssueSave;
}> = ({ labels, repoOptions, onSave }) => {
  const names = labels.map((l) => l.name);
  const exists = (label: string) => !!repoOptions?.labels.some((l) => l.name === label);
  const apply = (next: string[]) =>
    onSave({ labels: next }, { labels: labelsFor(next, repoOptions) });
  const missing = (label: string) =>
    repoOptions && !exists(label) ? `Label ${label} gibt es im Repo nicht` : undefined;
  const toggle = (label: string, text: string, hint: string) => {
    const on = names.includes(label);
    return (
      <button
        onClick={() => apply(toggleLabel(names, label, !on))}
        disabled={!exists(label)}
        aria-pressed={on}
        title={missing(label) ?? `${hint} (${label} ${on ? 'entfernen' : 'setzen'})`}
        className={`${BTN} ${btnState(on)}`}
      >
        {text}
      </button>
    );
  };
  const mode = currentMode(names);

  return (
    <section aria-label="Kontrollfluss">
      <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2">
        Kontrollfluss
        {names.includes(NEED_INPUT_LABEL) && (
          <span className="px-1.5 rounded bg-amber-500/20 text-amber-300 font-normal">
            wartet auf Antwort
          </span>
        )}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {toggle(GO_LABEL, 'Freigeben', 'Issue für mw board freigeben')}
        {toggle(BUILD_LABEL, 'Umsetzen', 'Briefing freigeben, Umsetzung starten')}
        {toggle(DYNAMIC_LABEL, 'Dynamic', 'Dynamic Workflows')}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="mw-Modus">
        {MODES.map(({ mode: m, label }) => {
          const label_ = m === 'default' ? null : MODE_LABELS[m];
          return (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => mode !== m && apply(setMode(names, m))}
              disabled={!!label_ && !exists(label_)}
              title={label_ ? (missing(label_) ?? label_) : 'Kein Modus-Label'}
              className={`${BTN} ${btnState(mode === m)}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
};
