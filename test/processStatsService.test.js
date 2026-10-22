import { describe, it, expect } from 'vitest';
import {
  parsePids,
  parsePs,
  aggregateStats,
  getProcessStats,
} from '../server/services/processStatsService.js';

describe('processStatsService - parsePids', () => {
  it('parses and dedupes positive integers', () => {
    expect(parsePids('1, 22,22,333')).toEqual([1, 22, 333]);
  });
  it.each([
    [''],
    [undefined],
    ['0'],
    ['-1'],
    ['1.5'],
    ['abc'],
    ['1;ls'],
    ['1,,x'],
    ['99999999999'],
  ])('rejects %s', (input) => {
    expect(parsePids(input)).toBeNull();
  });
  it('caps at 50 pids', () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => i + 1).join(',');
    expect(parsePids(ids(50))).toHaveLength(50);
    expect(parsePids(ids(51))).toBeNull();
  });
});

describe('processStatsService - aggregateStats', () => {
  const rows = parsePs(
    [
      '  100     1  1.5  10240',
      '  101   100  2.0  20480',
      '  102   101  0.5   1024',
      '  200     1  9.0   2048',
      'garbage line',
    ].join('\n')
  );

  it('parses ps rows', () => {
    expect(rows).toHaveLength(4);
  });
  it('accepts a locale decimal comma', () => {
    expect(parsePs('7 1 3,5 2048')).toEqual([{ pid: 7, ppid: 1, cpu: 3.5, rss: 2048 }]);
  });
  it('sums the process tree and converts rss to MB', () => {
    expect(aggregateStats(rows, [100])).toEqual([{ pid: 100, cpu: 4, memMb: 31 }]);
  });
  it('omits vanished pids and keeps request order', () => {
    expect(aggregateStats(rows, [200, 999, 102]).map((s) => s.pid)).toEqual([200, 102]);
  });
  it('survives a ppid cycle', () => {
    const cyc = parsePs('1 2 1.0 1024\n2 1 1.0 1024');
    expect(aggregateStats(cyc, [1])).toEqual([{ pid: 1, cpu: 2, memMb: 2 }]);
  });
});

describe('processStatsService - getProcessStats', () => {
  it('reports the current process', async () => {
    const [stat] = await getProcessStats([process.pid]);
    expect(stat.pid).toBe(process.pid);
    expect(stat.memMb).toBeGreaterThan(0);
  });
});
