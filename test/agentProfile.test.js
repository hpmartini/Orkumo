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

const { dispatch, replySession, resumeProfileArgs } =
  await import('../server/services/agentService.js');
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
