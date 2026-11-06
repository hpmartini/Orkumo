import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { AgentList } from '../components/AgentsView/AgentList';
import {
  DEFAULT_AGENT_CARD_FIELDS,
  type AgentCardFields,
  type AgentContext,
  type AgentGrouping,
  type AgentSession,
} from '../types';
import type { NavItem, SessionGroup } from '../utils/agentSessions';

const pr = (number: number, state = 'open') => ({
  id: `pr-${number}`,
  href: `https://github.com/hpmartini/Orkumo/pull/${number}`,
  title: `PR ${number}`,
  number,
  provider: 'github' as const,
  state,
});

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: 's1',
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/Orkumo',
    startedAt: 1000,
    name: 'session',
    state: 'done',
    pinned: false,
    order: null,
    links: [],
    displayState: 'completed',
    ...partial,
  } as AgentSession;
}

const ctx = {
  repo: {
    name: 'Orkumo',
    root: '/home/dev/Orkumo',
    slug: 'hpmartini/Orkumo',
    branch: 'feat/159-agent-panel',
    dirty: false,
    ahead: 0,
    behind: 0,
    isWorktree: false,
    worktreeName: null,
    worktreePath: null,
  },
  model: null,
  issues: [],
  pulls: [],
  servers: [],
  subagents: { running: 0, total: 0, names: [] },
} as unknown as AgentContext;

function renderList(
  s: AgentSession,
  opts: {
    grouping?: AgentGrouping;
    groupKey?: string;
    cardFields?: AgentCardFields;
    issues?: string[];
    workflowIssue?: string;
    onOpenIssue?: (key: string) => void;
    cardDetails?: 'hover' | 'click' | 'always';
  } = {}
) {
  const group: SessionGroup = {
    key: (opts.groupKey ?? 'g') as SessionGroup['key'],
    title: 'Group',
    sessions: [s],
    hidden: 0,
  } as SessionGroup;
  const items: NavItem[] = [{ type: 'session', session: s, group } as NavItem];
  return render(
    <AgentList
      items={items}
      selectedIndex={-1}
      onSelectIndex={() => {}}
      onActivate={() => {}}
      onTogglePeek={() => {}}
      peekId={null}
      openIds={new Set()}
      now={2000}
      grouping={opts.grouping ?? 'state'}
      cardDetails={opts.cardDetails ?? 'always'}
      cardFields={opts.cardFields}
      lookup={
        opts.workflowIssue ? { workflowIssues: new Map([[s.id, opts.workflowIssue]]) } : undefined
      }
      contexts={{ [s.id]: ctx }}
      servers={new Map()}
      rowActions={() => []}
      groupActions={() => []}
      collapsedKeys={new Set()}
      issuesByAgent={opts.issues ? new Map([[s.id, opts.issues]]) : undefined}
      onOpenIssue={opts.onOpenIssue ?? (() => {})}
      onOpenPrs={() => {}}
    />
  );
}

const card = () => screen.getByRole('option');

describe('AgentList harness badge (#195, AC-6)', () => {
  it.each([
    [session({}), 'Claude Code'],
    [session({ chat: true, kind: 'interactive' }), 'Claude Code'],
    [session({ kind: 'interactive', ptyArgs: ['--session-id', 'x'] }), 'Claude Code'],
    [session({ kind: 'interactive', ptyCommand: 'omp', ptyArgs: [] }), 'Oh My Pi'],
    [session({ kind: 'interactive', ptyCommand: 'opencode', ptyArgs: [] }), 'OpenCode'],
    [session({ kind: 'interactive', ptyCommand: 'codex', ptyArgs: ['--', 'hi'] }), 'Codex'],
    [session({ kind: 'interactive', ptyCommand: 'pi', ptyArgs: [] }), 'Pi'],
  ])('shows the harness of every kind of session (%#)', (s, label) => {
    renderList(s);
    expect(within(card()).getByLabelText(`Harness: ${label}`).textContent).toBe(label);
  });

  it('is positioned or hidden through cardFields', () => {
    renderList(session({ ptyCommand: 'codex' }), {
      cardFields: { ...DEFAULT_AGENT_CARD_FIELDS, harness: 'hidden' },
    });
    expect(within(card()).queryByLabelText(/Harness:/)).toBeNull();
  });
});
const leftColumn = () => card().firstElementChild as HTMLElement;

describe('AgentList workflow card (#159, AC-3)', () => {
  it('shows the title without prefix and issue + PR pills under the glyph', () => {
    const onOpenIssue = vi.fn();
    const s = session({
      name: 'MACC Orkumo#159 Darstellung Agent-Panel',
      links: [pr(160)],
    });
    renderList(s, {
      issues: ['hpmartini/Orkumo#159'],
      workflowIssue: 'hpmartini/Orkumo#159',
      onOpenIssue,
    });
    expect(within(card()).getByText('Darstellung Agent-Panel')).toBeTruthy();
    expect(within(card()).queryByText(/MACC/)).toBeNull();

    const buttons = within(leftColumn()).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe('#159');
    expect(buttons[1].textContent).toContain('Pull request');

    fireEvent.click(buttons[0]);
    expect(onOpenIssue).toHaveBeenCalledWith('hpmartini/Orkumo#159');
    // The workflow issue is not repeated in the details
    expect(card().querySelector('[data-card-details]')).toBeNull();
  });

  it('a local agent keeps its full name and a narrow left column', () => {
    renderList(session({ name: 'package.json build install' }));
    expect(within(card()).getByText('package.json build install')).toBeTruthy();
    expect(within(leftColumn()).queryAllByRole('button')).toHaveLength(0);
    expect(leftColumn().className).toContain('w-4');
  });
});

describe('AgentList project pill (#159, AC-4)', () => {
  const s = session({ name: 'MACC Orkumo#159 x' });
  const projectPill = () => within(card()).queryByTitle('hpmartini/Orkumo');

  for (const grouping of ['state', 'directory', 'none'] as const) {
    it(`shows the project in grouping "${grouping}"`, () => {
      renderList(s, { grouping });
      expect(projectPill()?.textContent).toBe('Orkumo');
    });
  }

  it('hides it in project grouping, except in the favorites group', () => {
    const { unmount } = renderList(s, { grouping: 'project' });
    expect(projectPill()).toBeNull();
    unmount();
    renderList(s, { grouping: 'project', groupKey: 'favorites' });
    expect(projectPill()?.textContent).toBe('Orkumo');
  });
});

describe('AgentList local agent links (#159, AC-5)', () => {
  it('keeps all linked issues and PRs', () => {
    renderList(session({ name: 'local work', links: [pr(1), pr(2)] }), {
      issues: ['hpmartini/Orkumo#3', 'hpmartini/Orkumo#4'],
    });
    const details = card().querySelector('[data-card-details]') as HTMLElement;
    expect(within(details).getByText('#3')).toBeTruthy();
    expect(within(details).getByText('#4')).toBeTruthy();
    const prPill = within(card()).getByTitle(/List pull requests/);
    expect(prPill.textContent).toMatch(/2/);
  });
});

describe('AgentList card fields (#159, AC-7)', () => {
  const s = session({ name: 'MACC Orkumo#159 x', links: [pr(160)] });
  const opts = { issues: ['hpmartini/Orkumo#159'], workflowIssue: 'hpmartini/Orkumo#159' };

  it('hidden elements disappear', () => {
    renderList(s, {
      ...opts,
      cardFields: { ...DEFAULT_AGENT_CARD_FIELDS, pr: 'hidden', branch: 'hidden' },
    });
    expect(within(card()).queryByText(/Pull request/)).toBeNull();
    expect(within(card()).queryByText('feat/159-agent-panel')).toBeNull();
    expect(within(leftColumn()).getAllByRole('button')).toHaveLength(1);
  });

  it('moved elements render in their new slot', () => {
    renderList(s, {
      ...opts,
      cardFields: { ...DEFAULT_AGENT_CARD_FIELDS, issue: 'title', branch: 'details' },
    });
    expect(within(leftColumn()).queryByText('#159')).toBeNull();
    const titleRow = within(card()).getByText('x').parentElement as HTMLElement;
    expect(within(titleRow).getByText('#159')).toBeTruthy();
    const details = card().querySelector('[data-card-details]') as HTMLElement;
    expect(within(details).getByText('feat/159-agent-panel')).toBeTruthy();
  });
});

describe('AgentList card details trigger (#181)', () => {
  // Three cards that all have details (a linked issue each)
  const sessions = ['a', 'b', 'c'].map((id) => session({ id, name: `agent ${id}` }));
  const group = { key: 'g', title: 'Group', sessions, hidden: 0 } as unknown as SessionGroup;
  const items = sessions.map((s) => ({ type: 'session', session: s, group }) as NavItem);

  function List({ mode, initial = -1 }: { mode: 'hover' | 'click'; initial?: number }) {
    const [selected, setSelected] = React.useState(initial);
    return (
      <>
        <button onClick={() => setSelected((i) => i + 1)}>arrow-down</button>
        <AgentList
          items={items}
          selectedIndex={selected}
          onSelectIndex={setSelected}
          onActivate={() => {}}
          onTogglePeek={() => {}}
          peekId={null}
          openIds={new Set()}
          now={2000}
          grouping="state"
          cardDetails={mode}
          contexts={Object.fromEntries(sessions.map((s) => [s.id, ctx]))}
          servers={new Map()}
          rowActions={() => []}
          groupActions={() => []}
          collapsedKeys={new Set()}
          issuesByAgent={new Map(sessions.map((s) => [s.id, [`hpmartini/Orkumo#${s.id}1`]]))}
          onOpenIssue={() => {}}
          onOpenPrs={() => {}}
        />
      </>
    );
  }

  const cardOf = (id: string) => document.querySelector(`[data-session-id="${id}"]`) as HTMLElement;
  const openCards = () =>
    [...document.querySelectorAll('[data-session-id]')]
      .filter((el) => el.querySelector('[data-card-details]'))
      .map((el) => el.getAttribute('data-session-id'));
  const hover = (id: string) => {
    fireEvent.mouseEnter(cardOf(id));
    act(() => vi.advanceTimersByTime(250));
  };
  // Pointer device: the component only reacts to hover where `(hover: hover)` matches
  const setHoverDevice = (matches: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({ matches, media: q }) as MediaQueryList);

  beforeEach(() => {
    window.Element.prototype.scrollIntoView = () => {}; // jsdom lacks it; the list scrolls the selection into view
    vi.useFakeTimers();
    setHoverDevice(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hover mode: a clicked card stays closed once the pointer moves to a card above or below (AC-1)', () => {
    render(<List mode="hover" />);
    hover('b');
    fireEvent.click(cardOf('b'));
    expect(openCards()).toEqual(['b']);
    for (const other of ['a', 'c']) {
      fireEvent.mouseLeave(cardOf('b'));
      hover(other);
      expect(openCards()).toEqual([other]);
      fireEvent.mouseLeave(cardOf(other));
      expect(openCards()).toEqual([]);
      hover('b');
    }
  });

  it('hover mode: keyboard selection opens while no card is hovered', () => {
    render(<List mode="hover" initial={0} />);
    fireEvent.click(screen.getByText('arrow-down'));
    expect(openCards()).toEqual(['b']);
    hover('c');
    expect(openCards()).toEqual(['c']);
  });

  it('click mode: hover opens nothing, click and keyboard selection open the selected card (AC-2)', () => {
    render(<List mode="click" />);
    hover('a');
    expect(openCards()).toEqual([]);
    fireEvent.click(cardOf('a'));
    expect(openCards()).toEqual(['a']);
    hover('c');
    expect(openCards()).toEqual(['a']);
    fireEvent.click(screen.getByText('arrow-down'));
    expect(openCards()).toEqual(['b']);
  });

  it('touch device: hover mode falls back to click', () => {
    setHoverDevice(false);
    render(<List mode="hover" />);
    fireEvent.mouseEnter(cardOf('c'));
    fireEvent.click(cardOf('c'));
    expect(openCards()).toEqual(['c']);
  });
});
