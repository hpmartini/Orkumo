import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDuration, formatResetIn, rankSessions, staleAge } from '../utils/usage';
import { inProjectScope } from '../utils/projectScope';
import { fetchUsage } from '../services/api';
import { SessionsCard } from '../components/UsageView/SessionsCard';
import { UsageCard } from '../components/UsageView/UsageCard';
import type { UsageSession, UsageResponse } from '../components/UsageView/types';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const H = 3_600_000;
const s = (
  id: string,
  lastAgoH: number,
  durH: number,
  tokens: number,
  cwd = '/p/a'
): UsageSession => ({
  id,
  providerId: 'claude',
  provider: 'Claude Code',
  title: null,
  cwd,
  branch: null,
  firstMs: NOW - (lastAgoH + durH) * H,
  lastMs: NOW - lastAgoH * H,
  tokens,
});
const SESSIONS = [s('new', 0, 1, 10), s('big', 5, 0.5, 9_000), s('long', 30, 9, 50, '/p/b')];

vi.mock('../services/api', () => ({
  fetchUsageSessions: vi.fn(async () => ({ generatedAt: NOW, days: 7, sessions: SESSIONS })),
  fetchUsage: vi.fn(),
}));

describe('rankSessions (#184 AC-4)', () => {
  const ids = (sort: 'recent' | 'tokens' | 'duration') =>
    rankSessions(SESSIONS, sort).map((x) => x.id);
  it('orders by newest, most tokens, longest duration', () => {
    expect(ids('recent')).toEqual(['new', 'big', 'long']);
    expect(ids('tokens')).toEqual(['big', 'long', 'new']);
    expect(ids('duration')).toEqual(['long', 'new', 'big']);
  });
  it('filters to the context projects and caps the list', () => {
    const inA = (cwd?: string) => inProjectScope(cwd, ['/p/a']);
    expect(rankSessions(SESSIONS, 'recent', inA).map((x) => x.id)).toEqual(['new', 'big']);
    expect(rankSessions(SESSIONS, 'recent', undefined, 1)).toHaveLength(1);
  });
  it('formats durations', () => {
    expect(formatDuration(30_000)).toBe('< 1 min');
    expect(formatDuration(14 * 60_000)).toBe('14 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 05 min');
  });
});

describe('limit staleness (#184 AC-5)', () => {
  it('flags snapshots older than an hour with their age', () => {
    expect(staleAge(NOW - 10 * 60_000, NOW)).toBeNull();
    expect(staleAge(NOW - 3 * H, NOW)).toBe('vor 3 h');
    expect(staleAge(NOW - 26 * 24 * H, NOW)).toBe('vor 26 T');
    expect(staleAge(null, NOW)).toBeNull();
  });
  it('a reset window has no countdown', () => {
    expect(formatResetIn(null, NOW)).toBe('erfolgt');
  });
});

const first = () => screen.getAllByRole('listitem')[0];

describe('SessionsCard (#184 AC-4)', () => {
  it('switches tabs and filters by context', async () => {
    const { rerender } = render(<SessionsCard active />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('tab', { name: 'Größte (Tokens)' }));
    expect(screen.getByRole('tab', { name: 'Größte (Tokens)' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(first()).getByTitle('Tokens der Session')).toHaveTextContent('9');
    await userEvent.click(screen.getByRole('tab', { name: 'Längste (Dauer)' }));
    expect(within(first()).getByTitle('/p/b')).toBeInTheDocument();
    rerender(<SessionsCard active projectPaths={['/p/b']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

describe('UsageCard limits (#184 AC-5)', () => {
  it('hides the 5h bar without a source window, shows a reset window as 0 %, flags stale', async () => {
    const data = {
      generatedAt: NOW,
      days: 7,
      providers: [
        {
          id: 'claude',
          label: 'Claude Code',
          kind: 'claude',
          available: true,
          limits: {
            fiveHour: null,
            weekly: { usedPercent: 83, resetsAt: NOW + H },
            source: 'claude-cache',
            asOf: NOW - 26 * 24 * H,
          },
          totals: zero,
          cacheHitRate: null,
          daily: [],
        },
        {
          id: 'codex-a',
          label: 'Codex A',
          kind: 'codex',
          available: true,
          limits: {
            fiveHour: { usedPercent: 0, resetsAt: null, reset: true },
            weekly: { usedPercent: 90, resetsAt: NOW + H },
            source: 'rollout',
            asOf: NOW - 60_000,
          },
          totals: zero,
          cacheHitRate: null,
          daily: [],
        },
      ],
    } as unknown as UsageResponse;
    vi.mocked(fetchUsage).mockResolvedValue(data);
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    render(<UsageCard onOpen={() => {}} />);
    const [claude, codex] = await screen.findAllByRole('listitem');
    vi.useRealTimers();
    expect(within(claude).getByText('kein 5-h-Limit')).toBeInTheDocument();
    expect(within(claude).getByText(/veraltet · vor 26 T/)).toBeInTheDocument();
    expect(within(codex).getByRole('progressbar', { name: '5 h genutzt' })).toHaveAttribute(
      'aria-valuenow',
      '0'
    );
    expect(within(codex).queryByText(/veraltet/)).toBeNull();
  });
});
