import { describe, it, expect } from 'vitest';
import { parseTopProcesses } from '../server/services/healthService.js';

// `ps -A -o pid=,pcpu=,rss=,comm=` on macOS: comm is the full path (last column, may contain spaces)
const STATS = [
  '    1   2,7  20976 /sbin/launchd',
  ' 9031  12.5 107504 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper (GPU)',
  ' 9032   0.0  88944 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
  ' 9035   1.0 500000 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
  '  700  45.0 300000 node',
  '  701   3.2   1024 /usr/libexec/logd',
  '  702   0.1   2048 /usr/sbin/mDNSResponderHelper',
  '  703   0.2   4096 kernel_task',
  '  704   0.3   8192 /bin/zsh',
  '  705   0.4  16384 /usr/bin/ssh',
  '',
  'garbage line without numbers',
  '  abc  1.0 100 broken',
  '  706  x.y 100 broken-cpu',
  '  707   1.0',
].join('\n');

const ARGS = [
  '    1 /sbin/launchd',
  ` 9031 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (GPU) --type=gpu-process ${'--flag '.repeat(40)}`,
  '  700 node /Users/me/project/server/index.js --port 3001',
].join('\n');

describe('parseTopProcesses', () => {
  const result = parseTopProcesses(STATS, ARGS);

  it('sorts by cpu descending and limits to 8 by default', () => {
    expect(result.byCpu).toHaveLength(8);
    expect(result.byCpu.map((p) => p.pid).slice(0, 4)).toEqual([700, 9031, 701, 1]);
    const cpus = result.byCpu.map((p) => p.cpuPercent);
    expect(cpus).toEqual([...cpus].sort((a, b) => b - a));
  });

  it('sorts by memory and converts rss KiB to bytes', () => {
    expect(result.byMemory.map((p) => p.pid).slice(0, 3)).toEqual([9035, 700, 9031]);
    expect(result.byMemory[0].rssBytes).toBe(500000 * 1024);
  });

  it('uses the basename of comm (spaces kept) and the truncated args as command', () => {
    const gpu = result.byCpu.find((p) => p.pid === 9031);
    expect(gpu.name).toBe('Google Chrome Helper (GPU)');
    expect(gpu.command.length).toBe(120);
    expect(gpu.command.startsWith('/Applications/Google Chrome.app')).toBe(true);
    expect(result.byCpu.find((p) => p.pid === 700).command).toBe(
      'node /Users/me/project/server/index.js --port 3001'
    );
    // no args entry -> falls back to comm
    expect(result.byMemory.find((p) => p.pid === 9035).command).toMatch(/Google Chrome Helper$/);
  });

  it('parses comma decimal separator and skips malformed lines', () => {
    expect(result.byCpu.find((p) => p.pid === 1).cpuPercent).toBe(2.7);
    const all = parseTopProcesses(STATS, ARGS, 100).byCpu;
    expect(all).toHaveLength(10);
    expect(all.some((p) => p.pid === 706 || p.pid === 707)).toBe(false);
  });

  it('aggregates processes with the same name in byApp', () => {
    const helper = result.byApp.find((a) => a.name === 'Google Chrome Helper');
    expect(helper).toEqual({
      name: 'Google Chrome Helper',
      processCount: 2,
      cpuPercent: 1,
      rssBytes: (88944 + 500000) * 1024,
    });
    expect(result.byApp[0].name).toBe('Google Chrome Helper');
    expect(result.byApp).toHaveLength(5);
  });

  it('returns empty lists for empty output', () => {
    expect(parseTopProcesses('', '')).toEqual({ byCpu: [], byMemory: [], byApp: [] });
  });
});
