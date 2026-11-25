import React from 'react';
import { Choice, choiceMode } from '@hpmartini/agents-ui/components/Choice';
import { buildSlices, sliceGroups } from '../../utils/board';

interface SlicePickerProps {
  slices: ReturnType<typeof buildSlices>;
  /** Label of the slice kind ("Repo", "Label", ...), also the main group heading */
  kindLabel: string;
  selected: string | null;
  allCount: number;
  onSelect: (value: string | null) => void;
}

/** Slice selector for the board header: favorites, others and hidden as groups, with counts (#179) */
export const SlicePicker: React.FC<SlicePickerProps> = ({
  slices,
  kindLabel,
  selected,
  allCount,
  onSelect,
}) => {
  const groups = sliceGroups(slices, kindLabel, '');
  // A stored selection without items here (other context, data changed) still filters the board
  const missing =
    selected !== null && !groups.some((g) => g.entries.some((e) => e.value === selected))
      ? selected
      : null;
  const count = 1 + (missing === null ? 0 : 1) + groups.reduce((n, g) => n + g.entries.length, 0);
  // Pills have no group headers and show hints only as tooltips: count and hidden go in the label
  const pills = choiceMode(count) === 'pills';
  return (
    <Choice
      value={selected ?? ''}
      // '' is "All": slice values are repo, label, milestone or assignee names, never empty
      onChange={(v) => onSelect(v || null)}
      options={[
        { value: '', label: `All (${allCount})` },
        ...(missing === null ? [] : [{ value: missing, label: `${missing} (no items)` }]),
        ...groups.flatMap((g) =>
          g.entries.map((e) =>
            pills
              ? {
                  value: e.value,
                  label: `${e.value} (${e.count}${e.hidden ? ', hidden' : ''})`,
                  muted: e.hidden,
                }
              : {
                  value: e.value,
                  label: e.value,
                  hint: String(e.count),
                  group: g.label,
                  muted: e.hidden,
                }
          )
        ),
      ]}
      label={`Select ${kindLabel}`}
      searchPlaceholder={`Search ${kindLabel}…`}
      // pills wrap only when the header runs out of room; the menu trigger truncates
      className={pills ? undefined : 'max-w-56'}
    />
  );
};
