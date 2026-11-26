import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Worker profile on `orkumo start` and on the `--resume` fallback of a reply: the argv that reaches `claude`
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profile-'));
const project = path.join(home, 'project');
fs.mkdirSync(project);
process.env.CLAUDE_CONFIG_DIR = home;
process.env.CLAUDE_CLI_PATH = '/bin/sh'; // any executable: execFile is mocked

const calls = [];
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  const execFile = (cmd, args, opts, cb) => {
    if (cmd === '/bin/sh') calls.push(args);
    if (args[0] === 'agents') {
      cb(null, JSON.stringify([{ kind: 'background', id: 'job12345', cwd: project }]), '');
    } else cb(null, 'backgrounded · new12345 · w\n  claude attach new12345', '');
  };
  return { ...actual, default: { ...actual, execFile }, execFile };
});

const {
  dispatch,
  replySession,
  respawnSession,
  resumeProfileArgs,
  interactiveOrchestratorArgs,
  ORCHESTRATOR_SETTINGS,
  LEGACY_ORCHESTRATOR_SETTINGS,
} = await import('../server/services/agentService.js');
const { settingsService } = await import('../server/services/settingsService.js');
const workerSettings = path.join(home, 'profiles', 'worker.json');
const claudeCalls = () => calls.filter((a) => a[0] !== 'agents' && a[0] !== 'daemon');

beforeEach(() => {
  calls.length = 0;
});

describe('worker profile', () => {
  it('start: profile "worker" adds the fixed settings path and strict MCP, without the unsafe opt-in', async () => {
    await dispatch(
      { prompt: 'fix the login', cwd: project, profile: 'worker' },
      { allowedDirs: [project], unsafeAllowed: false }
    );
    const args = claudeCalls()[0];
    expect(args.slice(0, 3)).toEqual(['--bg', '--settings', workerSettings]);
    expect(args).toContain('--strict-mcp-config');
    const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    expect(Object.keys(mcp.mcpServers)).toEqual(['fetch', 'playwright']);
    expect(args.slice(-2)).toEqual(['--', 'fix the login']);
  });

  it('start: an unknown profile is refused', async () => {
    await expect(
      dispatch(
        { prompt: 'fix the login', cwd: project, profile: 'root' },
        { allowedDirs: [project], unsafeAllowed: false }
      )
    ).rejects.toThrow(/Unknown profile/);
  });

  it('resume: repeats --settings and the MCP flags the job was started with', async () => {
    const mcp = '{"mcpServers":{}}';
    fs.mkdirSync(path.join(home, 'jobs', 'job12345'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'jobs', 'job12345', 'state.json'),
      JSON.stringify({
        sessionId: 'sess-1',
        respawnFlags: [
          '--name',
          'w',
          '--settings',
          workerSettings,
          '--strict-mcp-config',
          '--mcp-config',
          mcp,
          '--model',
          'opus',
        ],
      })
    );
    await replySession('job12345', 'weiter', { mode: 'resume' });
    expect(claudeCalls()[0]).toEqual([
      '--resume',
      'sess-1',
      '--bg',
      '--settings',
      workerSettings,
      '--strict-mcp-config',
      '--mcp-config',
      mcp,
      '--',
      'weiter',
    ]);
  });

  it('resume: a session without a profile resumes without extra flags', () => {
    expect(resumeProfileArgs(['--name', 'x', '--model', 'opus'])).toEqual([]);
    expect(resumeProfileArgs(undefined)).toEqual([]);
  });
});

// Orchestrators start with ~/.claude/profiles/orchestrator.json: Remote Control on (although
// ~/.claude/settings.json turns it off for every other session) and a small fixed prompt load
describe('orchestrator profile', () => {
  const writeJob = (id, state) => {
    fs.mkdirSync(path.join(home, 'jobs', id), { recursive: true });
    fs.writeFileSync(path.join(home, 'jobs', id, 'state.json'), JSON.stringify(state));
  };
  const readFlags = (id) =>
    JSON.parse(fs.readFileSync(path.join(home, 'jobs', id, 'state.json'), 'utf8')).respawnFlags;
  const marked = (orchestrators, orchestratorRoles = {}) =>
    vi.spyOn(settingsService, 'getAgentViewSettings').mockReturnValue({
      ...settingsService.getAgentViewSettings(),
      orchestrators,
      orchestratorRoles,
    });

  it('start: a worker gets the worker profile, an orchestrator the orchestrator profile', async () => {
    await dispatch(
      { prompt: 'fix the login', cwd: project, profile: 'worker' },
      { allowedDirs: [project], unsafeAllowed: false }
    );
    await dispatch(
      { prompt: 'watch the board', cwd: project, profile: 'orchestrator', name: 'b-orchestrator' },
      { allowedDirs: [project], unsafeAllowed: false }
    );
    const [worker, orch] = claudeCalls();
    expect(worker).not.toContain(ORCHESTRATOR_SETTINGS);
    expect(ORCHESTRATOR_SETTINGS).toBe(path.join(home, 'profiles', 'orchestrator.json'));
    expect(orch).toEqual([
      '--bg',
      '--name',
      'b-orchestrator',
      '--settings',
      ORCHESTRATOR_SETTINGS,
      '--',
      'watch the board',
    ]);
  });

  it('start: a profile and client settings are not combined (two --settings)', async () => {
    await expect(
      dispatch(
        { prompt: 'watch the board', cwd: project, profile: 'orchestrator', settings: '{}' },
        { allowedDirs: [project], unsafeAllowed: true }
      )
    ).rejects.toThrow(/settings/);
  });

  it('resume: an orchestrator keeps its profile', async () => {
    marked([]);
    writeJob('job12345', {
      sessionId: 'sess-1',
      respawnFlags: ['--name', 'b-orchestrator', '--settings', ORCHESTRATOR_SETTINGS],
    });
    await replySession('job12345', 'weiter', { mode: 'resume' });
    expect(claudeCalls()[0]).toEqual([
      '--resume',
      'sess-1',
      '--bg',
      '--settings',
      ORCHESTRATOR_SETTINGS,
      '--',
      'weiter',
    ]);
  });

  it('resume: an orchestrator started with the legacy inline settings gets the profile', async () => {
    marked([]);
    writeJob('job12345', {
      sessionId: 'sess-1',
      respawnFlags: ['--name', 'b-orchestrator', '--settings', LEGACY_ORCHESTRATOR_SETTINGS],
    });
    await replySession('job12345', 'weiter', { mode: 'resume' });
    expect(claudeCalls()[0]).toEqual([
      '--resume',
      'sess-1',
      '--bg',
      '--settings',
      ORCHESTRATOR_SETTINGS,
      '--',
      'weiter',
    ]);
  });

  it('resume: a session marked as orchestrator but started without --settings gets the profile', async () => {
    marked(['job12345']);
    writeJob('job12345', { sessionId: 'sess-1', respawnFlags: ['--name', 'main-orchestrator'] });
    await replySession('job12345', 'weiter', { mode: 'resume' });
    expect(claudeCalls()[0]).toContain(ORCHESTRATOR_SETTINGS);
    marked([]);
    calls.length = 0;
    await replySession('job12345', 'weiter', { mode: 'resume' });
    expect(claudeCalls()[0]).not.toContain(ORCHESTRATOR_SETTINGS);
  });

  it('respawn: a marked orchestrator gets the profile written into its respawn flags first', async () => {
    marked(['job12345']);
    writeJob('job12345', { sessionId: 'sess-1', respawnFlags: ['--name', 'main-orchestrator'] });
    await respawnSession('job12345');
    expect(readFlags('job12345')).toEqual([
      '--name',
      'main-orchestrator',
      '--settings',
      ORCHESTRATOR_SETTINGS,
    ]);
    expect(claudeCalls()[0]).toEqual(['respawn', 'job12345']);
  });

  it('respawn: the legacy inline settings are replaced in place', async () => {
    marked([]);
    writeJob('job12345', {
      sessionId: 'sess-1',
      respawnFlags: ['--settings', LEGACY_ORCHESTRATOR_SETTINGS, '--model', 'opus'],
    });
    await respawnSession('job12345');
    expect(readFlags('job12345')).toEqual(['--settings', ORCHESTRATOR_SETTINGS, '--model', 'opus']);
  });

  it('respawn: a worker and a session with its own --settings stay as they are', async () => {
    marked(['job12345']);
    const flags = ['--settings', workerSettings];
    writeJob('job12345', { sessionId: 'sess-1', respawnFlags: flags });
    await respawnSession('job12345');
    marked([]);
    writeJob('job99999', { sessionId: 'sess-2', respawnFlags: ['--name', 'w'] });
    await respawnSession('job99999');
    expect(readFlags('job12345')).toEqual(flags);
    expect(readFlags('job99999')).toEqual(['--name', 'w']);
  });

  it('respawn --all: every orchestrator job gets the profile before the CLI restarts them', async () => {
    marked(['job22222']);
    writeJob('job11111', {
      sessionId: 'sess-1',
      respawnFlags: ['--settings', LEGACY_ORCHESTRATOR_SETTINGS],
    });
    writeJob('job22222', { sessionId: 'sess-2', respawnFlags: ['--name', 'main-orchestrator'] });
    writeJob('job33333', { sessionId: 'sess-3', respawnFlags: ['--name', 'w'] });
    await respawnSession('--all');
    expect(readFlags('job11111')).toEqual(['--settings', ORCHESTRATOR_SETTINGS]);
    expect(readFlags('job22222')).toEqual([
      '--name',
      'main-orchestrator',
      '--settings',
      ORCHESTRATOR_SETTINGS,
    ]);
    expect(readFlags('job33333')).toEqual(['--name', 'w']);
    expect(claudeCalls()[0]).toEqual(['respawn', '--all']);
  });

  it('interactive resume of a marked orchestrator adds --remote-control and the profile', () => {
    const settings = {
      orchestrators: ['uuid-1', 'uuid-2'],
      orchestratorRoles: { 'uuid-2': 'board-orchestrator' },
    };
    expect(interactiveOrchestratorArgs(['--resume', 'uuid-1'], settings)).toEqual([
      '--remote-control',
      'orchestrator',
      '--settings',
      ORCHESTRATOR_SETTINGS,
    ]);
    expect(interactiveOrchestratorArgs(['--resume', 'uuid-2'], settings)).toEqual([
      '--remote-control',
      'board-orchestrator',
      '--settings',
      ORCHESTRATOR_SETTINGS,
    ]);
    expect(interactiveOrchestratorArgs(['--resume', 'uuid-3'], settings)).toEqual([]);
    expect(interactiveOrchestratorArgs(['--session-id', 'uuid-1'], settings)).toEqual([]);
    expect(
      interactiveOrchestratorArgs(
        ['--resume', 'uuid-1', '--remote-control', 'x', '--settings', '{}'],
        settings
      )
    ).toEqual([]);
  });
});
