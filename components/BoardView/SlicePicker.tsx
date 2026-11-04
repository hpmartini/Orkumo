import React, { useId, useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { buildSlices, sliceGroups, type SliceEntry } from '../../utils/board';
import { usePopover } from '../AgentsView/PullRequestsPanel';

interface SlicePickerProps {
  slices: ReturnType<typeof buildSlices>;
  /** Label of the slice kind ("Repo", "Label", ...), also the main group heading */
  kindLabel: string;
  selected: string | null;
  allCount: number;
  onSelect: (value: string | null) => void;
}

/** "owner/name" -> dim owner prefix + bold name; other values stay whole */
const SliceName: React.FC<{ value: string }> = ({ value }) => {
  const cut = value.lastIndexOf('/') + 1;
  return (
    <span className="truncate min-w-0">
      {cut > 0 && <span className="text-gray-500">{value.slice(0, cut)}</span>}
      <span className="font-medium">{value.slice(cut)}</span>
    </span>
  );
};

/** Searchable slice selector for the board header (replaces a plain <select>, #179) */
export const SlicePicker: React.FC<SlicePickerProps> = ({
  slices,
  kindLabel,
  selected,
  allCount,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        data-popover-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${kindLabel} wählen`}
        title={selected ?? undefined}
        className="flex items-center gap-1.5 max-w-56 bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs hover:border-gray-500"
      >
        <span className="truncate min-w-0">
          {selected ? <SliceName value={selected} /> : `Alle (${allCount})`}
        </span>
        <ChevronDown size={12} className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <SliceList
          slices={slices}
          kindLabel={kindLabel}
          selected={selected}
          allCount={allCount}
          onSelect={(v) => {
            setOpen(false);
            onSelect(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

type Row = { value: string | null; entry?: SliceEntry };

const SliceList: React.FC<SlicePickerProps & { onClose: () => void }> = ({
  slices,
  kindLabel,
  selected,
  allCount,
  onSelect,
  onClose,
}) => {
  const ref = usePopover(onClose);
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const groups = useMemo(() => sliceGroups(slices, kindLabel, query), [slices, kindLabel, query]);
  // "Alle" only while not searching, so Enter after typing takes the first match
  const rows: Row[] = useMemo(
    () => [
      ...(query.trim() ? [] : [{ value: null }]),
      ...groups.flatMap((g) => g.entries.map((entry) => ({ value: entry.value, entry }))),
    ],
    [groups, query]
  );
  const optionId = (i: number) => `${id}-opt-${i}`;
  const scrollTo = (i: number) =>
    document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      setActive(next);
      scrollTo(next);
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault();
      onSelect(rows[active].value);
    }
  };

  const option = (row: Row, i: number) => {
    const isSelected = row.value === selected;
    return (
      <li
        key={row.entry?.key ?? '__all__'}
        id={optionId(i)}
        role="option"
        aria-selected={isSelected}
        title={row.value ?? undefined}
        data-testid="slice-option"
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => onSelect(row.value)}
        className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer whitespace-nowrap text-sm ${i === active ? 'bg-gray-800' : ''} ${isSelected ? 'text-blue-300' : 'text-gray-100'} ${row.entry?.hidden ? 'opacity-60' : ''}`}
      >
        <Check size={14} className={`shrink-0 ${isSelected ? '' : 'invisible'}`} />
        {row.value ? <SliceName value={row.value} /> : <span className="font-medium">Alle</span>}
        <span className="ml-auto shrink-0 pl-2 tabular-nums text-[11px] text-gray-400 bg-gray-800 border border-gray-700 rounded-full px-1.5">
          {row.entry?.count ?? allCount}
        </span>
      </li>
    );
  };

  let i = query.trim() ? 0 : 1;
  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 z-40 w-80 max-w-[90vw] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <Search size={14} className="shrink-0 text-gray-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={`${kindLabel} suchen…`}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={rows.length ? optionId(active) : undefined}
          aria-label={`${kindLabel} suchen`}
          className="w-full bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
        />
      </div>
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label={kindLabel}
        className="max-h-[60vh] overflow-y-auto py-1"
      >
        {!query.trim() && option(rows[0], 0)}
        {groups.map((g) => (
          <li key={g.label} role="presentation">
            <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-gray-500 border-t border-gray-800/70">
              {g.label}
            </div>
            <ul role="group" aria-label={g.label}>
              {g.entries.map((entry) => option({ value: entry.value, entry }, i++))}
            </ul>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">Keine Treffer</li>}
      </ul>
    </div>
  );
};
