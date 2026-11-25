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
    // hidden entries sit under their own "Hidden" header in the menu
    expect(within(list).getByRole('group', { name: 'Hidden' })).toHaveTextContent(
      /^Hiddenacme\/old3$/
    );
    expect(within(list).getByRole('group', { name: 'Hidden' })).toHaveTextContent('acme/old3');
    fireEvent.click(within(list).getByRole('option', { name: /acme\/api/ }));
    expect(onSelect).toHaveBeenCalledWith('acme/api');
  });

  it('picking All clears the selection to null', () => {
    const { onSelect, list } = open('acme/api');
    fireEvent.click(within(list).getByRole('option', { name: /^All/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the All count on the closed trigger, like before the migration', () => {
    render(
      <SlicePicker
        slices={slices}
        kindLabel="Repo"
        selected={null}
        allCount={11}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /^Select Repo/ })).toHaveTextContent('All (11)');
    fireEvent.click(screen.getByRole('button', { name: /^Select Repo/ }));
    // count once, not as label and hint
    expect(screen.getByRole('option', { name: /^All/ })).toHaveTextContent(/^All \(11\)$/);
  });

  it('keeps a selection missing from a menu-sized list as "(no items)"', () => {
    const { list } = open('acme/gone');
    expect(screen.getByRole('button', { name: /^Select Repo/ })).toHaveTextContent(
      'acme/gone (no items)'
    );
    expect(within(list).getByRole('option', { name: 'acme/gone (no items)' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});

describe('SlicePicker as pills (up to 3 options)', () => {
  const renderPills = (s: typeof slices, selected: string | null) => {
    const onSelect = vi.fn();
    render(
      <SlicePicker
        slices={s}
        kindLabel="Repo"
        selected={selected}
        allCount={5}
        onSelect={onSelect}
      />
    );
    return { onSelect, group: screen.getByRole('radiogroup', { name: 'Select Repo' }) };
  };
  const small = {
    favorites: [],
    others: [entry('acme/app', 4)],
    hidden: [entry('acme/old', 1, { hidden: true })],
  };

  it('shows counts and the hidden mark in the visible labels', () => {
    const { group } = renderPills(small, null);
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['All (5)', 'acme/app (4)', 'acme/old (1, hidden)']);
    expect(within(group).getByRole('radio', { name: 'All (5)' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('keeps a selection missing from an empty list checked as "(no items)"', () => {
    const { group, onSelect } = renderPills({ favorites: [], others: [], hidden: [] }, 'acme/gone');
    const gone = within(group).getByRole('radio', { name: 'acme/gone (no items)' });
    expect(gone).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(group).getByRole('radio', { name: 'All (5)' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('keeps a selection missing from a small list checked as "(no items)"', () => {
    const { group } = renderPills({ ...small, hidden: [] }, 'acme/gone');
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['All (5)', 'acme/gone (no items)', 'acme/app (4)']);
    expect(within(group).getByRole('radio', { name: 'acme/gone (no items)' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('a missing selection that tips the list past 3 options switches to the menu', () => {
    render(
      <SlicePicker
        slices={small}
        kindLabel="Repo"
        selected="acme/gone"
        allCount={5}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: /^Select Repo/ })).toHaveTextContent(
      'acme/gone (no items)'
    );
  });
});
