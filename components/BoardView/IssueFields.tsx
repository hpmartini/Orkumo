import React, { useEffect, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { BoardLabel, BoardRepoOptions } from '../../types';
import { fetchRepoOptions } from '../../services/boardApi';
import { usePopover } from '../AgentsView/PullRequestsPanel';
import { LabelChip } from './BoardCard';

/** Labels, assignees and milestones of `repo` (server caches them for 5 min) */
export function useRepoOptions(repo: string | null) {
  const [options, setOptions] = useState<BoardRepoOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOptions(null);
    setError(null);
    if (!repo) return;
    let alive = true;
    fetchRepoOptions(repo)
      .then((o) => alive && setOptions(o))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Fehler'));
    return () => {
      alive = false;
    };
  }, [repo]);
  return { options, error };
}

export const FIELD_INPUT =
  'w-full bg-gray-850 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-blue-500';

const PickerList: React.FC<{
  choices: { value: string; label: React.ReactNode }[];
  selected: string[];
  multi: boolean;
  onPick: (value: string) => void;
  onClose: () => void;
  label: string;
}> = ({ choices, selected, multi, onPick, onClose, label }) => {
  const ref = usePopover(onClose);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="listbox"
      aria-label={label}
      aria-multiselectable={multi}
      className="absolute z-30 left-0 top-full mt-1 w-64 max-h-64 overflow-y-auto thin-scrollbar rounded-md border border-gray-600 bg-gray-800 shadow-xl py-1 focus:outline-none"
    >
      {choices.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Keine Einträge</p>}
      {choices.map((c) => {
        const on = selected.includes(c.value);
        return (
          <button
            key={c.value}
            type="button"
            role="option"
            aria-selected={on}
            onClick={() => onPick(c.value)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-750 hover:text-white focus-visible:bg-gray-750 focus-visible:outline-none"
          >
            <Check size={12} className={on ? 'text-cursor' : 'invisible'} />
            {c.label}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Shows the current value(s) and opens a pick list. Multi mode toggles values and
 * reports the full new set; single mode reports one value (or null to clear) and closes.
 */
export const FieldPicker: React.FC<{
  label: string;
  multi?: boolean;
  /** null while the repo options load */
  choices: { value: string; label: React.ReactNode }[] | null;
  value: string[];
  onChange: (next: string[]) => void;
  display: React.ReactNode;
  disabled?: boolean;
}> = ({ label, multi = false, choices, value, onChange, display, disabled }) => {
  const [open, setOpen] = useState(false);
  const pick = (v: string) => {
    if (multi) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    else {
      onChange(value[0] === v ? [] : [v]);
      setOpen(false);
    }
  };
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        aria-label={`${label} ändern`}
        disabled={disabled || !choices}
        onClick={() => setOpen(!open)}
        className="group w-full flex items-center gap-1 min-h-[24px] rounded px-1 -mx-1 text-left hover:bg-gray-800 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
        title={choices ? `${label} ändern` : 'Lade Auswahl …'}
      >
        <span className="flex-1 min-w-0 flex flex-wrap gap-1">{display}</span>
        <Pencil size={11} className="shrink-0 text-gray-500 opacity-0 group-hover:opacity-100" />
      </button>
      {open && choices && (
        <PickerList
          label={label}
          choices={choices}
          selected={value}
          multi={multi}
          onPick={pick}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

export const labelChoices = (options: BoardRepoOptions | null) =>
  options?.labels.map((l) => ({ value: l.name, label: <LabelChip label={l} /> })) ?? null;
export const assigneeChoices = (options: BoardRepoOptions | null) =>
  options?.assignees.map((a) => ({ value: a.login, label: a.login })) ?? null;
export const milestoneChoices = (options: BoardRepoOptions | null) =>
  options?.milestones.map((m) => ({ value: m.title, label: m.title })) ?? null;

/** Label names -> chips with the repo's colours (unknown names grey) */
export const labelsFor = (names: string[], options: BoardRepoOptions | null): BoardLabel[] =>
  names.map((n) => options?.labels.find((l) => l.name === n) ?? { name: n, color: '8b949e' });
