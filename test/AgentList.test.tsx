import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  href: `https://github.com/hpmartini/DevHub/pull/${number}`,
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
    cwd: '/home/dev/DevHub',
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
    name: 'DevHub',
    root: '/home/dev/DevHub',
    slug: 'hpmartini/DevHub',
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
const leftColumn = () => card().firstElementChild as HTMLElement;

describe('AgentList workflow card (#159, AC-3)', () => {
  it('shows the title without prefix and issue + PR pills under the glyph', () => {
    const onOpenIssue = vi.fn();
    const s = session({
      name: 'MACC DevHub#159 Darstellung Agent-Panel',
      links: [pr(160)],
    });
    renderList(s, {
      issues: ['hpmartini/DevHub#159'],
      workflowIssue: 'hpmartini/DevHub#159',
      onOpenIssue,
    });
    expect(within(card()).getByText('Darstellung Agent-Panel')).toBeTruthy();
    expect(within(card()).queryByText(/MACC/)).toBeNull();

    const buttons = within(leftColumn()).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe('#159');
    expect(buttons[1].textContent).toContain('Pull request');

    fireEvent.click(buttons[0]);
    expect(onOpenIssue).toHaveBeenCalledWith('hpmartini/DevHub#159');
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
  const s = session({ name: 'MACC DevHub#159 x' });
  const projectPill = () => within(card()).queryByTitle('hpmartini/DevHub');

  for (const grouping of ['state', 'directory', 'none'] as const) {
    it(`shows the project in grouping "${grouping}"`, () => {
      renderList(s, { grouping });
      expect(projectPill()?.textContent).toBe('DevHub');
    });
  }

  it('hides it in project grouping, except in the favorites group', () => {
    const { unmount } = renderList(s, { grouping: 'project' });
    expect(projectPill()).toBeNull();
    unmount();
    renderList(s, { grouping: 'project', groupKey: 'favorites' });
    expect(projectPill()?.textContent).toBe('DevHub');
  });
});

describe('AgentList local agent links (#159, AC-5)', () => {
  it('keeps all linked issues and PRs', () => {
    renderList(session({ name: 'local work', links: [pr(1), pr(2)] }), {
      issues: ['hpmartini/DevHub#3', 'hpmartini/DevHub#4'],
    });
    const details = card().querySelector('[data-card-details]') as HTMLElement;
    expect(within(details).getByText('#3')).toBeTruthy();
    expect(within(details).getByText('#4')).toBeTruthy();
    const prPill = within(card()).getByTitle(/List pull requests/);
    expect(prPill.textContent).toMatch(/2/);
  });
});

describe('AgentList card fields (#159, AC-7)', () => {
  const s = session({ name: 'MACC DevHub#159 x', links: [pr(160)] });
  const opts = { issues: ['hpmartini/DevHub#159'], workflowIssue: 'hpmartini/DevHub#159' };

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
