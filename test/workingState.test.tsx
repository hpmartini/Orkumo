import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { deriveDisplayState } from '../server/services/agentService.js';
import { WORKING_CASES } from './fixtures/workingStates.js';
import {
  groupSessions,
  matchesQuickFilter,
  stateGlyph,
  summarizeSessions,
} from '../utils/agentSessions';
import { summarizeAgents } from '../utils/agentOverview';
import { AgentSummaryBar } from '../components/AgentsView/AgentSummaryBar';
import type { AgentSession } from '../types';

// Built like listSessions does: CLI state wins for `state`, the job file goes to the derivation
const sessions: AgentSession[] = WORKING_CASES.map((c, i) => {
  const s = {
    id: `s${i}`,
    sessionId: null,
    kind: 'background',
    cwd: '/x',
    startedAt: 0,
    name: c.label,
    state: c.cli,
    status: c.status,
    tempo: c.tempo,
    inFlight: c.inFlight,
    pid: 1,
    pinned: false,
    order: null,
    links: [],
  } as unknown as AgentSession;
  s.displayState = deriveDisplayState(s, c.job);
  return s;
});

describe('working state (#194)', () => {
  it.each(WORKING_CASES.map((c, i) => [c.label, c.expected, i] as const))(
    'AC-1 %s -> %s',
    (_label, expected, i) => {
      expect(sessions[i].displayState).toBe(expected);
    }
  );

  it('AC-2 a session waiting on its own background task is not working and shows as waiting', () => {
    const waiting = sessions.find((s) => s.displayState === 'waiting')!;
    expect(matchesQuickFilter('working', waiting)).toBe(false);
    expect(stateGlyph('waiting')).toMatchObject({
      animate: false,
      label: 'Waiting on background task',
    });
  });

  it('AC-3 header count, quick filter, state group and overview agree on one working agent', () => {
    const header = summarizeSessions(sessions).working;
    const filter = sessions.filter((s) => matchesQuickFilter('working', s)).length;
    const group =
      groupSessions(sessions, 'state').find((g) => g.key === 'working')?.sessions.length ?? 0;
    const overview = summarizeAgents(sessions, {}, 0).working;
    expect({ header, filter, group, overview }).toEqual({
      header: 1,
      filter: 1,
      group: 1,
      overview: 1,
    });

    render(
      <AgentSummaryBar
        counts={{ ...summarizeSessions(sessions), cacheExpiring: 0 }}
        openPrs={0}
        runningServers={0}
        daemon={null}
        justCompleted={0}
        active={new Set()}
        onToggle={() => {}}
        onOpenPrs={() => {}}
        onOpenServers={() => {}}
        panel={null}
      />
    );
    expect(screen.getByRole('button', { name: '1 working' })).toBeInTheDocument();
  });
});
