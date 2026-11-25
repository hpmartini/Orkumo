// SlicePicker on the shared Choice: "All" maps to null, entries keep their group and count
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SlicePicker } from '../components/BoardView/SlicePicker';
import type { SliceEntry } from '../utils/board';

const entry = (value: string, count: number, extra: Partial<SliceEntry> = {}): SliceEntry => ({
  key: `repo:${value}`,
  kind: 'repo',
  value,
  count,
  favorite: false,
  hidden: false,
  ...extra,
});

const slices = {
  favorites: [entry('acme/app', 4, { favorite: true })],
  others: [entry('acme/api', 2), entry('acme/web', 1), entry('acme/cli', 1)],
  hidden: [entry('acme/old', 3, { hidden: true })],
};

const open = (selected: string | null) => {
  const onSelect = vi.fn();
  render(
    <SlicePicker
      slices={slices}
      kindLabel="Repo"
      selected={selected}
      allCount={11}
      onSelect={onSelect}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /^Select Repo/ }));
  return { onSelect, list: screen.getByRole('listbox', { name: 'Select Repo' }) };
};

describe('SlicePicker', () => {
  it('lists All plus each group with counts and maps a pick to its value', () => {
    const { onSelect, list } = open(null);
    expect(within(list).getByRole('group', { name: 'Favorites' })).toHaveTextContent('acme/app4');
    expect(within(list).getByRole('group', { name: 'Hidden' })).toHaveTextContent('acme/old3');
    fireEvent.click(within(list).getByRole('option', { name: /acme\/api/ }));
    expect(onSelect).toHaveBeenCalledWith('acme/api');
  });

  it('picking All clears the selection to null', () => {
    const { onSelect, list } = open('acme/api');
    fireEvent.click(within(list).getByRole('option', { name: /^All/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
