import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoldButtons, GroupingPicker } from '../components/AgentsView/ProjectsRail';
import type { AgentGrouping } from '../types';

const renderPicker = (grouping: AgentGrouping = 'project') => {
  const onGrouping = vi.fn();
  render(<GroupingPicker grouping={grouping} onGrouping={onGrouping} />);
  return { onGrouping, trigger: screen.getByRole('button', { name: /^Group agents by/ }) };
};

afterEach(cleanup);

describe('GroupingPicker', () => {
  it('shows only the current grouping until hovered, then all four to pick from', async () => {
    const user = userEvent.setup();
    const { trigger, onGrouping } = renderPicker('state');
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
});

describe('FoldButtons', () => {
  const renderButtons = (props: Partial<React.ComponentProps<typeof FoldButtons>> = {}) => {
    const handlers = { onGroups: vi.fn(), onCards: vi.fn() };
    render(<FoldButtons groupsCollapsed={false} cardsExpanded={false} {...handlers} {...props} />);
    return handlers;
  };

  it('collapses groups while one is open and expands them once all are collapsed', async () => {
    const user = userEvent.setup();
    const { onGroups } = renderButtons();
    await user.click(screen.getByRole('button', { name: 'Collapse all groups' }));
    expect(onGroups).toHaveBeenLastCalledWith(true);
    cleanup();
    const collapsed = renderButtons({ groupsCollapsed: true });
    await user.click(screen.getByRole('button', { name: 'Expand all groups' }));
    expect(collapsed.onGroups).toHaveBeenLastCalledWith(false);
  });

  it('expands all agent cards while none is open and collapses them once one is', async () => {
    const user = userEvent.setup();
    const { onCards } = renderButtons();
    await user.click(screen.getByRole('button', { name: 'Expand all agent cards' }));
    expect(onCards).toHaveBeenLastCalledWith(true);
    cleanup();
    const open = renderButtons({ cardsExpanded: true });
    await user.click(screen.getByRole('button', { name: 'Collapse all agent cards' }));
    expect(open.onCards).toHaveBeenLastCalledWith(false);
  });

  it('disables folding groups with an explaining tooltip while a filter is active', () => {
    renderButtons({ groupsDisabled: true });
    const groups = screen.getByRole('button', { name: 'Collapse all groups' });
    expect(groups).toBeDisabled();
    expect(groups).toHaveAttribute('title', 'Clear the filters to fold groups');
    expect(screen.getByRole('button', { name: 'Expand all agent cards' })).toBeEnabled();
  });
});
