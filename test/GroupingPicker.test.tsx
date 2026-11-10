import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupingPicker } from '../components/AgentsView/ProjectsRail';
import type { AgentGrouping } from '../types';

const renderPicker = (collapseDisabled = false, grouping: AgentGrouping = 'project') => {
  const handlers = { onGrouping: vi.fn(), onCollapseAll: vi.fn(), onExpandAll: vi.fn() };
  render(<GroupingPicker grouping={grouping} collapseDisabled={collapseDisabled} {...handlers} />);
  return { ...handlers, trigger: screen.getByRole('button', { name: /^Group agents by/ }) };
};

afterEach(cleanup);

describe('GroupingPicker', () => {
  it('shows only the current grouping until hovered, then all four to pick from', async () => {
    const user = userEvent.setup();
    const { trigger, onGrouping } = renderPicker(false, 'state');
    expect(trigger).toHaveTextContent('Status');
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    await user.hover(trigger);
    expect(screen.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([
      'Project',
      'Status',
      'Directory',
      'None',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'Status' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Directory' }));
    expect(onGrouping).toHaveBeenCalledWith('directory');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes again when the pointer leaves', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.hover(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.unhover(trigger);
    await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('opens from the keyboard, Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Project' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each(['project', 'state', 'directory'] as const)(
    'collapses and expands all groups from the menu in grouping %s (#49, #50)',
    async (grouping) => {
      const user = userEvent.setup();
      const { trigger, onCollapseAll, onExpandAll } = renderPicker(false, grouping);
      await user.click(trigger);
      await user.click(screen.getByRole('menuitem', { name: 'Collapse all groups' }));
      expect(onCollapseAll).toHaveBeenCalledTimes(1);
      expect(onExpandAll).not.toHaveBeenCalled();
      await user.click(trigger);
      await user.click(screen.getByRole('menuitem', { name: 'Expand all groups' }));
      expect(onExpandAll).toHaveBeenCalledTimes(1);
    }
  );

  it('disables collapse / expand with an explaining tooltip while a filter is active', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker(true);
    await user.click(trigger);
    const collapse = screen.getByRole('menuitem', { name: 'Collapse all groups' });
    const expand = screen.getByRole('menuitem', { name: 'Expand all groups' });
    expect(collapse).toBeDisabled();
    expect(expand).toBeDisabled();
    expect(collapse).toHaveAttribute('title', 'Clear the filters to collapse groups');
    expect(expand).toHaveAttribute('title', 'Clear the filters to expand groups');
  });
});
