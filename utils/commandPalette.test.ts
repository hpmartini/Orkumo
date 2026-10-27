import { describe, it, expect } from 'vitest';
import { fuzzyMatch, parsePaletteInput, rankCommands, type PaletteCommand } from './commandPalette';

const cmd = (
  id: string,
  title: string,
  scope: PaletteCommand['scope'] = 'command',
  extra: Partial<PaletteCommand> = {}
): PaletteCommand => ({ id, title, group: 'View', scope, run: () => {}, ...extra });

describe('parsePaletteInput', () => {
  it('maps prefixes to modes', () => {
    expect(parsePaletteInput('>split')).toEqual({ mode: 'command', query: 'split' });
    expect(parsePaletteInput('@ bob')).toEqual({ mode: 'agent', query: 'bob' });
    expect(parsePaletteInput('#dash')).toEqual({ mode: 'project', query: 'dash' });
    expect(parsePaletteInput('  plain ')).toEqual({ mode: 'all', query: 'plain' });
  });
});

describe('fuzzyMatch', () => {
  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'New task')).toBeNull();
    expect(fuzzyMatch('st', 'task')).toBeNull();
  });
  it('reports match indices', () => {
    expect(fuzzyMatch('nt', 'New task')?.indices).toEqual([0, 4]);
    expect(fuzzyMatch('task', 'New task')?.indices).toEqual([4, 5, 6, 7]);
  });
  it('scores contiguous and prefix matches above scattered ones', () => {
    const contiguous = fuzzyMatch('task', 'New task')!.score;
    const scattered = fuzzyMatch('task', 'Toggle all sessions kind')!.score;
    expect(contiguous).toBeGreaterThan(scattered);
    expect(fuzzyMatch('new', 'New task')!.score).toBeGreaterThan(
      fuzzyMatch('task', 'New task')!.score
    );
  });
});

describe('rankCommands', () => {
  const list = [
    cmd('a', 'Open settings'),
    cmd('b', 'New agent task', 'command', { keywords: 'dispatch compose' }),
    cmd('c', 'build-agent', 'agent'),
    cmd('d', 'DevOrbit', 'project'),
  ];
  it('keeps order for an empty query and filters by mode', () => {
    expect(rankCommands(list, '').map((r) => r.command.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rankCommands(list, '@').map((r) => r.command.id)).toEqual(['c']);
    expect(rankCommands(list, '#').map((r) => r.command.id)).toEqual(['d']);
  });
  it('ranks title matches and falls back to keywords', () => {
    expect(rankCommands(list, 'set')[0].command.id).toBe('a');
    expect(rankCommands(list, 'dispatch').map((r) => r.command.id)).toEqual(['b']);
    expect(rankCommands(list, 'zzz')).toEqual([]);
  });
});
