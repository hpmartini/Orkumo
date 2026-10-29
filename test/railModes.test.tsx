import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import React, { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentList } from '../components/AgentsView/AgentList';
import { useRailPreferences, FAVORITES_GROUP_KEY, STORAGE_KEY } from '../hooks/useRailPreferences';
import { groupSessions, railItems, COMPLETED_VISIBLE_LIMIT } from '../utils/agentSessions';
import type { AgentGrouping, AgentSession } from '../types';

// #50: the rail list functions (#46-#49) behave the same in Project, Status and Directory

let seq = 0;
const session = (partial: Partial<AgentSession>): AgentSession => ({
  id: `s${++seq}`,
  sessionId: null,
  kind: 'background',
  cwd: '/home/dev/app',
  startedAt: 1000 + seq,
  name: `agent-${seq}`,
  state: 'done',
  pinned: false,
  order: null,
  links: [],
  displayState: 'completed',
  ...partial,
});

// Two directories (= two project/directory groups) and two state groups (working, needs input)
const SESSIONS = [
  session({
    name: 'alpha-worker',
    cwd: '/home/dev/alpha',
    state: 'working',
    displayState: 'working',
  }),
  session({
    name: 'beta-asker',
    cwd: '/home/dev/beta',
    state: 'blocked',
    displayState: 'needs-input',
  }),
];

/** Same wiring as AgentsView: groupSessions -> rail.arrange -> railItems, prefs per grouping */
function Rail({
  grouping,
  sessions = SESSIONS,
}: {
  grouping: AgentGrouping;
  sessions?: AgentSession[];
}) {
  const rail = useRailPreferences(grouping);
  const groups = useMemo(
    () => rail.arrange(groupSessions(sessions, grouping)),
    [rail, sessions, grouping]
  );
  const items = railItems(groups, rail.collapsed, grouping);
  const [selectedIndex, setSelectedIndex] = useState(0);
  return (
    <div data-focus-zone="rail" tabIndex={0}>
      <button onClick={() => rail.collapseAll([FAVORITES_GROUP_KEY, ...groups.map((g) => g.key)])}>
        Collapse all groups
      </button>
      <button onClick={() => rail.expandAll()}>Expand all groups</button>
      <AgentList
        items={items}
        selectedIndex={selectedIndex}
        onSelectIndex={setSelectedIndex}
        onActivate={() => {}}
        onTogglePeek={() => {}}
        peekId={null}
        openIds={new Set()}
        now={2000}
        grouping={grouping}
        contexts={{}}
        servers={new Map()}
        rowActions={() => []}
        groupActions={(g) => [
          { id: 'toggle', label: 'Toggle', onSelect: () => rail.toggleCollapsed(g.key) },
        ]}
        collapsedKeys={rail.collapsed}
        onToggleGroup={rail.toggleCollapsed}
        favoriteGroupKeys={rail.favoriteGroups}
        favoriteSessionIds={rail.favoriteSessions}
        onToggleFavoriteGroup={rail.toggleFavoriteGroup}
        onToggleFavoriteSession={rail.toggleFavoriteSession}
        onMoveGroup={rail.moveGroup}
      />
    </div>
  );
}

const MODES: { grouping: AgentGrouping; first: RegExp; second: RegExp }[] = [
  { grouping: 'project', first: /^alpha$/, second: /^beta$/ },
  { grouping: 'state', first: /^Needs input$/, second: /^Working$/ },
  { grouping: 'directory', first: /alpha$/, second: /beta$/ },
];

const headers = () => screen.getAllByRole('option').filter((el) => el.hasAttribute('draggable'));
const headerTitle = (h: HTMLElement) =>
  within(h)
    .getByRole('button', { name: /^(Expand|Collapse) / })
    .getAttribute('aria-label')!
    .replace(/^(Expand|Collapse) /, '');
const headerTitles = () => headers().map(headerTitle);
const header = (name: RegExp) => headers().find((h) => name.test(headerTitle(h)))!;
const rowVisible = (name: string) => screen.queryByText(name) !== null;
const indexOfTitle = (name: RegExp) => headerTitles().findIndex((t) => name.test(t));

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  // jsdom has no layout
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe.each(MODES)(
  'rail list functions in grouping "$grouping" (#50)',
  ({ grouping, first, second }) => {
    it('AC-1: a single click on a group header collapses and expands it', async () => {
      render(<Rail grouping={grouping} />);
      expect(rowVisible('alpha-worker')).toBe(true);
      const target = grouping === 'state' ? /^Working$/ : first;
      await userEvent.click(header(target));
      expect(rowVisible('alpha-worker')).toBe(false);
      await userEvent.click(header(target));
      expect(rowVisible('alpha-worker')).toBe(true);
    });

    it('AC-2: groups reorder by drag and drop, menu and Alt+Arrow', async () => {
      render(<Rail grouping={grouping} />);
      expect(indexOfTitle(first)).toBeLessThan(indexOfTitle(second));

      // Drag and drop: second onto first
      const data = new Map<string, string>();
      const dataTransfer = {
        setData: (k: string, v: string) => data.set(k, v),
        getData: (k: string) => data.get(k) ?? '',
        effectAllowed: '',
        dropEffect: '',
      };
      fireEvent.dragStart(header(second), { dataTransfer });
      fireEvent.dragOver(header(first), { dataTransfer });
      fireEvent.drop(header(first), { dataTransfer });
      expect(indexOfTitle(second)).toBeLessThan(indexOfTitle(first));

      // Context menu "Move down" puts it back after first
      fireEvent.contextMenu(header(second));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
      expect(indexOfTitle(first)).toBeLessThan(indexOfTitle(second));

      // Keyboard: select second (chevron twice = selected, still open), Alt+ArrowUp moves it before first
      await userEvent.click(within(header(second)).getByRole('button', { name: /^Collapse / }));
      await userEvent.click(within(header(second)).getByRole('button', { name: /^Expand / }));
      fireEvent.keyDown(header(second), { key: 'ArrowUp', altKey: true });
      expect(indexOfTitle(second)).toBeLessThan(indexOfTitle(first));
    });

    it('AC-3: groups and agents can be marked as favorites', async () => {
      render(<Rail grouping={grouping} />);
      await userEvent.click(
        within(header(second)).getByRole('button', { name: /^Add .* to favorites$/ })
      );
      expect(indexOfTitle(second)).toBe(0);
      expect(
        within(header(second)).getByRole('button', { name: /^Remove .* from favorites$/ })
      ).toBeTruthy();

      fireEvent.contextMenu(screen.getByText('alpha-worker'));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));
      expect(headerTitles()[0]).toBe('Favorites');
      const favRows = screen.getAllByRole('option');
      // Agent row directly follows the Favorites header and appears only once
      expect(favRows[1].textContent).toContain('alpha-worker');
      expect(screen.getAllByText('alpha-worker')).toHaveLength(1);
    });

    it('AC-4: collapse all and expand all work', async () => {
      render(<Rail grouping={grouping} />);
      await userEvent.click(screen.getByRole('button', { name: 'Collapse all groups' }));
      expect(rowVisible('alpha-worker')).toBe(false);
      expect(rowVisible('beta-asker')).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'Expand all groups' }));
      expect(rowVisible('alpha-worker')).toBe(true);
      expect(rowVisible('beta-asker')).toBe(true);
    });

    it('AC-5: collapsed state and order survive a reload and leave the other groupings untouched', async () => {
      const view = render(<Rail grouping={grouping} />);
      const before = Object.fromEntries(
        MODES.filter((m) => m.grouping !== grouping).map((m) => {
          view.rerender(<Rail grouping={m.grouping} />);
          return [m.grouping, headerTitles()];
        })
      );
      view.rerender(<Rail grouping={grouping} />);
      fireEvent.contextMenu(header(second));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
      await userEvent.click(header(second));
      const after = headerTitles();
      view.unmount();

      // Reload: a fresh hook reads localStorage
      const reloaded = render(<Rail grouping={grouping} />);
      expect(headerTitles()).toEqual(after);
      expect(indexOfTitle(second)).toBeLessThan(indexOfTitle(first));
      expect(within(header(second)).getByRole('button', { name: /^Expand / })).toBeTruthy();

      for (const m of MODES.filter((x) => x.grouping !== grouping)) {
        reloaded.rerender(<Rail grouping={m.grouping} />);
        expect(headerTitles()).toEqual(before[m.grouping]);
        expect(
          headers().every((h) => within(h).queryByRole('button', { name: /^Collapse / }))
        ).toBe(true);
        // "Expand all" in another grouping must not expand this grouping's collapsed group
        await userEvent.click(screen.getByRole('button', { name: 'Expand all groups' }));
      }
      reloaded.rerender(<Rail grouping={grouping} />);
      expect(within(header(second)).getByRole('button', { name: /^Expand / })).toBeTruthy();
    });
  }
);

describe('Status grouping edge cases (#50)', () => {
  it('collapses and reorders the Completed group with a "… N more" row', async () => {
    const done = Array.from({ length: COMPLETED_VISIBLE_LIMIT + 2 }, (_, i) =>
      session({ name: `done-${i}`, cwd: '/home/dev/alpha' })
    );
    render(<Rail grouping="state" sessions={[...SESSIONS, ...done]} />);
    expect(screen.getByText(/2 more/)).toBeTruthy();
    await userEvent.click(header(/^Completed$/));
    expect(screen.queryByText(/2 more/)).toBeNull();
    expect(rowVisible('done-0')).toBe(false);

    const completedAt = indexOfTitle(/^Completed$/);
    fireEvent.contextMenu(header(/^Completed$/));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(indexOfTitle(/^Completed$/)).toBe(completedAt - 1);
  });

  it('moves a group across empty status groups', async () => {
    render(<Rail grouping="state" />);
    // Pinned and Ready for review are empty but still headers in the status grouping
    const titles = headerTitles();
    expect(titles).toContain('Pinned');
    const working = indexOfTitle(/^Working$/);
    for (let i = 0; i < working; i++) {
      fireEvent.contextMenu(header(/^Working$/));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    }
    expect(headerTitles()[0]).toBe('Working');
    fireEvent.contextMenu(header(/^Working$/));
    expect((screen.getByRole('menuitem', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
