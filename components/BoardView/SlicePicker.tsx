import React from 'react';
import { Choice } from '@hpmartini/agents-ui/components/Choice';
import { buildSlices, sliceGroups } from '../../utils/board';

interface SlicePickerProps {
  slices: ReturnType<typeof buildSlices>;
  /** Label of the slice kind ("Repo", "Label", ...), also the main group heading */
  kindLabel: string;
  selected: string | null;
  allCount: number;
  onSelect: (value: string | null) => void;
}

/** Slice selector for the board header: favorites, others and hidden as groups, counts as hints (#179) */
export const SlicePicker: React.FC<SlicePickerProps> = ({
  slices,
  kindLabel,
  selected,
  allCount,
  onSelect,
}) => (
  <Choice
    value={selected ?? ''}
    // '' is "All": slice values are repo, label, milestone or assignee names, never empty
    onChange={(v) => onSelect(v || null)}
    options={[
      { value: '', label: 'All', hint: String(allCount) },
      ...sliceGroups(slices, kindLabel, '').flatMap((g) =>
        g.entries.map((e) => ({
          value: e.value,
          label: e.value,
          hint: String(e.count),
          group: g.label,
        }))
      ),
    ]}
    label={`Select ${kindLabel}`}
    placeholder={selected ?? ''}
    searchPlaceholder={`Search ${kindLabel}…`}
    className="max-w-56"
  />
);
