import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RailNav, type RailNavProps } from '../components/AgentsView/ProjectsRail';

const nav: RailNavProps = {
  onOpenDashboard: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenProject: vi.fn(),
  onStartApp: vi.fn(),
  onStopApp: vi.fn(),
};

const renderNav = (collapseDisabled = false) => {
  const onCollapseAll = vi.fn();
  const onExpandAll = vi.fn();
  render(
    <RailNav
      nav={nav}
      grouping="project"
      onGrouping={vi.fn()}
      onCollapseAll={onCollapseAll}
      onExpandAll={onExpandAll}
      collapseDisabled={collapseDisabled}
    />
  );
  return {
    onCollapseAll,
    onExpandAll,
    collapse: screen.getByRole('button', { name: 'Collapse all groups' }),
    expand: screen.getByRole('button', { name: 'Expand all groups' }),
  };
};

describe('RailNav collapse/expand all (#49)', () => {
  afterEach(cleanup);

  it('shows both header buttons with a tooltip', () => {
    const { collapse, expand } = renderNav();
    expect(collapse.getAttribute('title')).toBe('Collapse all groups');
    expect(expand.getAttribute('title')).toBe('Expand all groups');
  });

  it('calls the matching handler on click', async () => {
    const user = userEvent.setup();
    const { collapse, expand, onCollapseAll, onExpandAll } = renderNav();
    await user.click(collapse);
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    expect(onExpandAll).not.toHaveBeenCalled();
    await user.click(expand);
    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });

  it('is reachable by Tab and fires on Enter and Space', async () => {
    const user = userEvent.setup();
    const { collapse, expand, onCollapseAll, onExpandAll } = renderNav();
    // Tab order: four grouping buttons, then collapse, then expand
    while (document.activeElement !== collapse) await user.tab();
    await user.keyboard('{Enter}');
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(document.activeElement).toBe(expand);
    await user.keyboard(' ');
    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });

  it('is disabled with an explaining tooltip while a filter is active', async () => {
    const user = userEvent.setup();
    const { collapse, expand, onCollapseAll } = renderNav(true);
    expect((collapse as HTMLButtonElement).disabled).toBe(true);
    expect((expand as HTMLButtonElement).disabled).toBe(true);
    expect(collapse.getAttribute('title')).toBe('Clear the filters to collapse groups');
    expect(expand.getAttribute('title')).toBe('Clear the filters to expand groups');
    await user.click(collapse);
    expect(onCollapseAll).not.toHaveBeenCalled();
  });
});
