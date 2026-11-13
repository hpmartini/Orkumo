import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { listOmpCommands, mergeOmpCommands, clearOmpCommandsCache, OMP_TUI_BUILTINS } =
  await import('../server/services/ompCommands.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-commands-'));

/** Fake omp: logs each start, answers get_available_commands in RPC framing (or hangs) */
function fakeOmp(name, { hang = false } = {}) {
  const bin = path.join(dir, name);
  const log = `${bin}.log`;
  const answer = JSON.stringify({
    id: 'devorbit-commands',
    type: 'response',
    command: 'get_available_commands',
    success: true,
    data: {
      commands: [
        { name: 'compact', source: 'builtin', description: 'Compact the context' },
        { name: 'model', aliases: ['models'], source: 'builtin', input: { hint: '<model>' } },
        { name: 'skill:goal-contract', source: 'skill', description: 'Contract' },
        { name: 'review', source: 'custom', description: 'Review changes' },
        { name: 'q', source: 'file', description: 'clashes with the quit alias' },
      ],
    },
  });
  fs.writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> "${log}"
echo '{"type":"ready"}'
${hang ? 'sleep 30' : `read line; echo '{"type":"extension_ui_request"}'; echo '${answer}'; sleep 30`}
`
  );
  fs.chmodSync(bin, 0o755);
  return {
    bin,
    starts: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
  };
}

beforeEach(() => clearOmpCommandsCache());

describe('listOmpCommands', () => {
  it('merges the TUI snapshot with the RPC answer', async () => {
    const { bin, starts } = fakeOmp('omp-ok');
    const list = await listOmpCommands(dir, { bin, extraArgs: ['--config', 'x.json'] });
    const names = list.map((c) => c.name);
    expect(names.slice(0, OMP_TUI_BUILTINS.length)).toEqual(OMP_TUI_BUILTINS.map((c) => c.name));
    expect(names).toEqual(
      expect.arrayContaining(['goal', 'compact', 'skill:goal-contract', 'review'])
    );
    expect(names).not.toContain('q');
    expect(list.find((c) => c.name === 'model')).toMatchObject({
      argumentHint: '<model>',
      builtin: true,
    });
    expect(list.find((c) => c.name === 'review').builtin).toBe(false);
    expect(starts()).toEqual(['--mode rpc --no-session --config x.json']);
  });

  it('caches per binary and cwd and shares a running probe', async () => {
    const { bin, starts } = fakeOmp('omp-cache');
    let t = 0;
    const deps = { bin, extraArgs: [], now: () => t };
    const [a, b] = await Promise.all([listOmpCommands(dir, deps), listOmpCommands(dir, deps)]);
    expect(a).toBe(b);
    await listOmpCommands(dir, deps);
    expect(starts()).toHaveLength(1);
    t = 6 * 60 * 1000;
    await listOmpCommands(dir, deps);
    expect(starts()).toHaveLength(2);
  });

  it('falls back to the snapshot plus Claude skills when omp does not answer', async () => {
    const { bin } = fakeOmp('omp-hang', { hang: true });
    const list = await listOmpCommands(dir, {
      bin,
      extraArgs: [],
      timeoutMs: 300,
      listSkills: async () => [{ name: 'goal-contract', description: 'Contract' }],
    });
    const names = list.map((c) => c.name);
    expect(names).toContain('goal');
    expect(names).toContain('skill:goal-contract');
    expect(names).not.toContain('compact');
  });
});

describe('mergeOmpCommands', () => {
  it('keeps the first entry per name or alias', () => {
    expect(
      mergeOmpCommands(
        [{ name: 'quit', aliases: ['q'] }],
        [{ name: 'q' }, { name: 'exit', aliases: ['quit'] }, { name: 'new', builtin: false }]
      ).map((c) => [c.name, c.builtin])
    ).toEqual([
      ['quit', true],
      ['new', false],
    ]);
  });
});
