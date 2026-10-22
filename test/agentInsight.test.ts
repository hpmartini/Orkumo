import { describe, it, expect } from 'vitest';
import {
  applyQuickFilters,
  collectPullRequests,
  mergeServers,
  summarizeContext,
} from '../utils/agentSessions';
import type { AgentSession } from '../types';

const session = (partial: Partial<AgentSession>): AgentSession => ({
  id: 'x',
  sessionId: null,
  kind: 'background',
  cwd: '/work/repo',
  startedAt: 1000,
  name: 'session',
  state: 'done',
  pinned: false,
  order: null,
  links: [],
  displayState: 'completed',
  ...partial,
});

const pr = (over: Record<string, unknown>) => ({
  number: 1,
  title: 't',
  url: 'https://github.com/o/r/pull/1',
  author: null,
  isDraft: false,
  headRef: 'feat',
  baseRef: 'main',
  updatedAt: '2026-01-01T00:00:00Z',
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  ci: 'success',
  ciPassed: 1,
  ciFailed: 0,
  ciPending: 0,
  mergeReady: false,
  repoSlug: 'o/r',
  ...over,
});
const ctx = (branch: string, items: unknown[]) =>
  ({ repo: { branch }, pulls: { open: items.length, url: '', items } }) as never;

describe('completed filter, merged servers and PR list', () => {
  it('completed matches done/stopped but not failed or running', () => {
    const all = ['done', 'stopped', 'failed', 'working', 'blocked'].map((state) =>
      session({ id: state, state: state as never })
    );
    expect(applyQuickFilters(all, new Set(['completed'])).map((s) => s.id)).toEqual([
      'done',
      'stopped',
    ]);
    // state chips are alternatives
    expect(applyQuickFilters(all, new Set(['completed', 'failed'])).map((s) => s.id)).toEqual([
      'done',
      'stopped',
      'failed',
    ]);
  });

  it('unions listening processes with app servers, deduped by port', () => {
    const s = session({});
    const apps = [{ name: 'web', path: '/work/repo', port: 3000, status: 'STOPPED' }];
    const context = {
      servers: [
        { port: 3000, pid: 7, command: 'vite', url: 'http://localhost:3000' },
        { port: 4000, pid: 8, command: 'node', url: 'http://localhost:4000' },
      ],
    } as never;
    expect(mergeServers(s, apps, context)).toEqual([
      { port: 3000, running: true, name: 'web', command: 'vite', pid: 7 },
      { port: 4000, running: true, name: 'node', command: 'node', pid: 8 },
    ]);
    expect(mergeServers(s, apps, undefined)).toEqual([{ port: 3000, running: false, name: 'web' }]);
  });

  it('dedupes PRs per repo, sorts merge-ready first and links agents by branch', () => {
    const a = session({ id: 'a' });
    const b = session({ id: 'b' });
    const ready = pr({
      number: 2,
      url: 'https://github.com/o/r/pull/2',
      mergeReady: true,
      headRef: 'other',
      updatedAt: '2025-01-01T00:00:00Z',
    });
    const newer = pr({});
    const contexts = { a: ctx('feat', [newer, ready]), b: ctx('feat', [newer]) };
    const rows = collectPullRequests([a, b], contexts);
    expect(rows.map((r) => r.pr.number)).toEqual([2, 1]);
    expect(rows[1].agents.map((s) => s.id)).toEqual(['a', 'b']);
    expect(rows[0].agents).toEqual([]);
    expect(summarizeContext([a, b], { contexts }).openPrs).toBe(2);
  });
});
