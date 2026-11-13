// Orchestrators in the rail: pinned group in every grouping, badge on the card
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AgentList } from '../components/AgentsView/AgentList';
import type { AgentGrouping, AgentSession } from '../types';
import {
  groupSessions,
  railItems,
  withOrchestratorSessions,
  isOrchestrator,
  orchestratorKey,
  withoutOrchestrator,
  ORCHESTRATORS_GROUP_KEY,
  type NavItem,
} from '../utils/agentSessions';
import { withFavoriteSessions, FAVORITES_GROUP_KEY } from '../hooks/useRailPreferences';

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: 's1',
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/app',
    startedAt: 1000,
    name: 'session',
    state: 'working',
    pinned: false,
    order: null,
    links: [],
    displayState: 'working',
    ...partial,
  } as AgentSession;
}

const orch = session({ id: 'job-o', name: 'chief', cwd: '/data/orchestrator' });
const worker = session({ id: 'job-w', name: 'worker' });
const tty = session({
  id: 'interactive-5',
  kind: 'interactive',
  sessionId: 'uuid-t',
  paneId: 'orch-1',
  name: 'tty orchestrator',
  displayState: 'interactive',
});
const all = [worker, orch, tty];
const marked = ['job-o', 'uuid-t'];

describe('isOrchestrator / marking keys', () => {
  it('matches a row by id, transcript uuid or pane id', () => {
    expect(isOrchestrator(orch, marked)).toBe(true);
    expect(isOrchestrator(tty, marked)).toBe(true);
    expect(isOrchestrator(tty, ['orch-1'])).toBe(true);
    expect(isOrchestrator(worker, marked)).toBe(false);
    expect(isOrchestrator(worker, undefined)).toBe(false);
  });

  it('stores a job by id, a terminal by its transcript, and unmarks every alias', () => {
    expect(orchestratorKey(orch)).toBe('job-o');
    expect(orchestratorKey(tty)).toBe('uuid-t');
    expect(withoutOrchestrator(['uuid-t', 'orch-1', 'job-o'], tty)).toEqual(['job-o']);
  });
});

describe('withOrchestratorSessions', () => {
  it.each<AgentGrouping>(['state', 'project', 'directory', 'none'])(
    'pins orchestrators in a leading group with the %s grouping',
    (grouping) => {
      const groups = withOrchestratorSessions(groupSessions(all, grouping), marked);
      expect(groups[0]).toMatchObject({ key: ORCHESTRATORS_GROUP_KEY, title: 'Orchestrators' });
      expect(groups[0].sessions.map((s) => s.id).sort()).toEqual(['interactive-5', 'job-o']);
      const rest = groups.slice(1).flatMap((g) => [...g.sessions, ...g.hidden]);
      expect(rest.map((s) => s.id)).toEqual(['job-w']);
    }
  );

  it('sits above favorites and drops a favorites section it emptied', () => {
    const favs = withFavoriteSessions(groupSessions(all, 'project'), ['job-o', 'job-w']);
    const groups = withOrchestratorSessions(favs, marked);
    expect(groups.map((g) => g.key).slice(0, 2)).toEqual([
      ORCHESTRATORS_GROUP_KEY,
      FAVORITES_GROUP_KEY,
    ]);
    const onlyOrch = withOrchestratorSessions(
      withFavoriteSessions(groupSessions(all, 'project'), ['job-o']),
      marked
    );
    expect(onlyOrch.some((g) => g.key === FAVORITES_GROUP_KEY)).toBe(false);
  });

  it('keeps state groups (they always show) and leaves lists without marks alone', () => {
    const groups = withOrchestratorSessions(groupSessions([orch], 'state'), ['job-o']);
    expect(groups.find((g) => g.key === 'working')?.sessions).toEqual([]);
    const plain = groupSessions(all, 'state');
    expect(withOrchestratorSessions(plain, [])).toBe(plain);
    expect(withOrchestratorSessions(plain, ['nobody'])).toBe(plain);
  });
});

function renderRail(items: NavItem[]) {
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
      grouping="project"
      contexts={{}}
      servers={new Map()}
      rowActions={() => []}
      groupActions={() => [{ id: 'toggle', label: 'Collapse', onSelect: () => {} }]}
      collapsedKeys={new Set()}
      orchestratorIds={marked}
      onMoveGroup={() => {}}
    />
  );
}

describe('AgentList', () => {
  const items = railItems(
    withOrchestratorSessions(groupSessions(all, 'project'), marked),
    new Set(),
    'project'
  );

  it('shows the Orchestrators group first, without project actions or dragging', () => {
    renderRail(items);
    const orchHeader = screen
      .getAllByRole('option')
      .find((el) => el.textContent?.includes('Orchestrators'))!;
    expect(within(orchHeader).getByLabelText('Orchestrators')).toBeTruthy();
    expect(within(orchHeader).queryByRole('button', { name: /Actions for/ })).toBeNull();
    expect(orchHeader.getAttribute('draggable')).toBe('false');
    expect(screen.getAllByRole('option')[0]).toBe(orchHeader);
  });

  it('marks orchestrator cards with a badge, and only those', () => {
    renderRail(items);
    const badges = screen.getAllByTestId('orchestrator-badge');
    expect(badges).toHaveLength(2);
    const workerCard = screen
      .getAllByRole('option')
      .find((el) => el.getAttribute('data-session-id') === 'job-w')!;
    expect(within(workerCard).queryByTestId('orchestrator-badge')).toBeNull();
    expect(badges[0].textContent).toBe('Orchestrator');
  });
});
