// #253: fixed projects stay in the rail's Project grouping without sessions, at their place
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { groupSessions, railItems } from '../utils/agentSessions';
import { useRailPreferences, STORAGE_KEY } from '../hooks/useRailPreferences';
import type { AgentSession } from '../types';

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
const APPS = [{ id: 'app-orkumo', name: 'Orkumo', path: '/Home/Dev/Orkumo' }];
const rows = (sessions: AgentSession[], fixedProjects: string[]) =>
  railItems(
    groupSessions(sessions, 'project', { apps: APPS, fixedProjects }),
    new Set(),
    'project'
  ).map((i) =>
    i.type === 'group' ? `[${i.group.title}|${i.group.key}|${i.group.cwd}]` : `  ${i.type}`
  );

describe('fixed projects in the project grouping', () => {
  it('shows a fixed project without sessions, an undetected directory included', () => {
    expect(rows([], ['/home/dev/notes'])).toEqual([
      '[notes|project:dir:/home/dev/notes|/home/dev/notes]',
    ]);
    // without it an empty project is not listed at all
    expect(rows([], [])).toEqual([]);
  });

  it('sessions land in the fixed group, also from its worktrees; no second group', () => {
    const sessions = [
      session({ cwd: '/home/dev/notes' }),
      session({ cwd: '/home/dev/notes/.claude/worktrees/feat-x' }),
      session({ cwd: '/home/dev/other' }),
    ];
    expect(rows(sessions, ['/home/dev/notes'])).toEqual([
      '[notes|project:dir:/home/dev/notes|/home/dev/notes]',
      '  session',
      '  session',
      '[other|project:dir:/home/dev/other|/home/dev/other]',
      '  session',
    ]);
  });

  it('a fixed worktree path or a path inside a scanned app means that project', () => {
    expect(rows([], ['/home/dev/notes/.claude/worktrees/feat-x', '/home/dev/notes'])).toEqual([
      '[notes|project:dir:/home/dev/notes|/home/dev/notes]',
    ]);
    expect(rows([], ['/home/dev/orkumo'])).toEqual([
      '[Orkumo|project:app-orkumo|/Home/Dev/Orkumo]',
    ]);
  });

  it('other groupings ignore fixed projects', () => {
    const groups = groupSessions([], 'directory', { fixedProjects: ['/home/dev/notes'] });
    expect(groups).toEqual([]);
  });
});

describe('useRailPreferences fixed projects', () => {
  beforeEach(() => localStorage.clear());

  it('toggles, persists and reloads them; old stored prefs have none', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ modes: {}, favoriteGroups: ['x'] }));
    const { result, unmount } = renderHook(() => useRailPreferences('project'));
    expect(result.current.fixedProjects).toEqual([]);
    act(() => result.current.toggleFixedProject('/home/dev/notes'));
    act(() => result.current.toggleFixedProject('/home/dev/other'));
    act(() => result.current.toggleFixedProject('/home/dev/notes'));
    expect(result.current.fixedProjects).toEqual(['/home/dev/other']);
    unmount();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).fixedProjects).toEqual([
      '/home/dev/other',
    ]);
    expect(renderHook(() => useRailPreferences('project')).result.current.fixedProjects).toEqual([
      '/home/dev/other',
    ]);
  });
});
