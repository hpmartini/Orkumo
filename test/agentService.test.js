import { describe, it, expect, vi } from 'vitest';

// node-pty is a native module - keep it out of the unit test
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const {
  buildDispatchArgs,
  parseDispatchOutput,
  parseRemoveHints,
  parseDaemonStatus,
  deriveDisplayState,
  extractPrLinks,
  projectSlug,
} = await import('../server/services/agentService.js');

describe('agentService - buildDispatchArgs', () => {
  it('builds a plain background prompt', () => {
    expect(buildDispatchArgs({ prompt: 'investigate flaky test' })).toEqual([
      '--bg',
      'investigate flaky test',
    ]);
  });

  it('maps every dispatch option to its CLI flag', () => {
    const args = buildDispatchArgs({
      prompt: 'do it',
      name: 'flaky-test-fix',
      agent: 'code-reviewer',
      model: 'opus',
      fallbackModel: 'sonnet',
      effort: 'high',
      permissionMode: 'plan',
      skipPermissions: true,
      allowSkipPermissions: true,
      restricted: true,
      settings: './ci.json',
      addDirs: ['../shared', ' '],
      pluginDirs: ['./plugins'],
      mcpConfigs: ['./mcp.json'],
      strictMcpConfig: true,
    });
    expect(args).toEqual([
      '--bg',
      '--name',
      'flaky-test-fix',
      '--agent',
      'code-reviewer',
      '--model',
      'opus',
      '--fallback-model',
      'sonnet',
      '--effort',
      'high',
      '--permission-mode',
      'plan',
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      '--restricted',
      '--settings',
      './ci.json',
      '--add-dir',
      '../shared',
      '--plugin-dir',
      './plugins',
      '--mcp-config',
      './mcp.json',
      '--strict-mcp-config',
      'do it',
    ]);
  });

  it('uses --exec for shell jobs and --resume for continuations', () => {
    expect(buildDispatchArgs({ exec: 'pytest -x' })).toEqual(['--bg', '--exec', 'pytest -x']);
    expect(buildDispatchArgs({ resume: 'abc', prompt: 'finish the migration' })).toEqual([
      '--bg',
      '--resume',
      'abc',
      'finish the migration',
    ]);
    expect(buildDispatchArgs({ resume: 'abc' })).toEqual(['--bg', '--resume', 'abc']);
  });
});

describe('agentService - output parsing', () => {
  it('extracts the session id from `claude --bg` output', () => {
    const output = [
      'Starting background service…',
      'backgrounded · a5df1c0f · hello-agent',
      '  claude agents             list sessions',
      '  claude attach a5df1c0f    open in this terminal',
    ].join('\n');
    expect(parseDispatchOutput(output)).toEqual({
      id: 'a5df1c0f',
      name: 'hello-agent',
      alreadyRunning: false,
    });
  });

  it('falls back to the attach hint and detects copies', () => {
    expect(
      parseDispatchOutput('session already running, started a copy\n  claude attach 12345678')
    ).toMatchObject({
      id: '12345678',
      alreadyRunning: true,
    });
    expect(parseDispatchOutput('nothing useful').id).toBeNull();
  });

  it('parses force flags from a `claude rm` refusal', () => {
    const message =
      'worktree has unpushed commits; rerun with --discard-unpushed abc123@wt-1 or --force-remove-worktree wt-1';
    expect(parseRemoveHints(message)).toEqual({
      discardUnpushed: 'abc123@wt-1',
      forceRemoveWorktree: 'wt-1',
    });
    expect(parseRemoveHints('')).toEqual({ discardUnpushed: null, forceRemoveWorktree: null });
  });

  it('parses daemon status', () => {
    expect(
      parseDaemonStatus('not running\n\nbg sessions:\n  bg workers:   0 in roster.json')
    ).toMatchObject({ running: false, workers: 0 });
    expect(parseDaemonStatus('running pid 4242 version 2.1.276\n  3 workers')).toMatchObject({
      running: true,
      pid: 4242,
      version: '2.1.276',
      workers: 3,
    });
  });
});

describe('agentService - state helpers', () => {
  it('derives display states', () => {
    expect(deriveDisplayState({ kind: 'interactive' })).toBe('interactive');
    expect(deriveDisplayState({ kind: 'background', state: 'working' })).toBe('working');
    expect(deriveDisplayState({ kind: 'background', state: 'blocked' })).toBe('needs-input');
    expect(deriveDisplayState({ kind: 'background', state: 'failed' })).toBe('failed');
    expect(deriveDisplayState({ kind: 'background', state: 'stopped' })).toBe('stopped');
    expect(deriveDisplayState({ kind: 'background', state: 'done', status: 'idle', pid: 1 })).toBe(
      'idle'
    );
    expect(deriveDisplayState({ kind: 'background', state: 'done' })).toBe('completed');
    expect(
      deriveDisplayState({
        kind: 'background',
        state: 'working',
        tempo: 'idle',
        loop: { routine: 'x' },
      })
    ).toBe('loop');
  });

  it('extracts PR / MR links from state.json children', () => {
    const links = extractPrLinks([
      { id: '1', href: 'https://github.com/o/r/pull/12', kind: 'pr', title: 'Fix' },
      { id: '2', href: 'https://gitlab.com/o/r/-/merge_requests/3' },
      { id: '3', href: 'https://example.com', kind: 'frame' },
    ]);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ number: 12, provider: 'github', title: 'Fix' });
    expect(links[1]).toMatchObject({ number: 3, provider: 'gitlab' });
    expect(extractPrLinks(null)).toEqual([]);
  });

  it('slugs project directories like Claude Code does', () => {
    expect(projectSlug('/home/user/DevHub')).toBe('-home-user-DevHub');
  });
});
