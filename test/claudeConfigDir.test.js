// #190: Claude's config dir may be added as a project directory and used for agent dispatch,
// every other hidden home dir stays blocked. Runs the real server (server/index.js) against a
// throwaway HOME and data dir; only the `claude` CLI is a stand-in script.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// realpath: macOS tmpdir lives under /var, which validatePath forbids
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'devorbit-190-'));
const home = path.join(root, 'home');
const altConfig = path.join(root, 'alt-claude');
const fakeClaude = path.join(root, 'claude');
const cwdLog = path.join(root, 'dispatch-cwd.txt');
const servers = [];

function startServer(port, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(root, 'data-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      DEVORBIT_DATA_PATH: dataDir,
      SERVER_PORT: String(port),
      CLAUDE_CLI_PATH: fakeClaude,
      CLAUDE_CONFIG_DIR: '',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  servers.push(child);
  return { base: `http://127.0.0.1:${port}`, dataDir };
}

async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/config`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server ${base} did not start`);
}

const addDir = (base, dir) =>
  fetch(`${base}/api/config/directories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dir }),
  });

let main;
let alt;

beforeAll(async () => {
  for (const dir of ['.claude', '.ssh', '.aws', '.config', '.gnupg', '.foo', '.claude-evil']) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }
  fs.mkdirSync(altConfig);
  fs.mkdirSync(path.join(home, 'PROJECTS'));
  fs.symlinkSync(path.join(home, '.ssh'), path.join(home, 'PROJECTS', 'ssh-link'));
  fs.symlinkSync(path.join(home, '.ssh'), path.join(home, '.claude', 'ssh-link'));
  // Stand-in CLI: records its cwd and answers like `claude --bg`
  fs.writeFileSync(
    fakeClaude,
    `#!/bin/sh\npwd -P > "${cwdLog}"\necho "backgrounded · abc123 · test"\n`,
    { mode: 0o755 }
  );
  main = startServer(3291);
  alt = startServer(3292, { CLAUDE_CONFIG_DIR: altConfig });
  await Promise.all([waitUp(main.base), waitUp(alt.base)]);
}, 30000);

afterAll(() => {
  for (const child of servers) child.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Claude config dir as project directory (#190)', () => {
  it('AC-1: accepts ~/.claude and stores it in config.json', async () => {
    const res = await addDir(main.base, path.join(home, '.claude'));
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(main.dataDir, 'config.json'), 'utf-8'));
    expect(onDisk.directories).toContain(path.join(home, '.claude'));
  });

  it('AC-1: honours $CLAUDE_CONFIG_DIR instead of ~/.claude', async () => {
    expect((await addDir(alt.base, altConfig)).status).toBe(200);
    // With a custom config dir, ~/.claude is just another hidden dir
    const res = await addDir(alt.base, path.join(home, '.claude'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Scanning hidden directories in home is not allowed');
  });

  it.each(['.ssh', '.aws', '.config', '.gnupg', '.foo', '.claude-evil'])(
    'AC-2: still rejects hidden ~/%s',
    async (dir) => {
      const res = await addDir(main.base, path.join(home, dir));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Scanning hidden directories in home is not allowed');
    }
  );

  it.each([
    ['PROJECTS', 'ssh-link'],
    ['.claude', 'ssh-link'],
  ])('AC-2: rejects a symlink %s/%s pointing to ~/.ssh', async (...parts) => {
    const res = await addDir(main.base, path.join(home, ...parts));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Symlink points to forbidden location');
  });

  it('AC-2: rejects traversal out of ~/.claude', async () => {
    const res = await addDir(main.base, `${home}/.claude/../.ssh`);
    expect(res.status).toBe(400);
  });

  it('AC-3: dispatches an agent with cwd ~/.claude', async () => {
    const cwd = path.join(home, '.claude');
    const res = await fetch(`${main.base}/api/agents/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'update the global rules', cwd }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe('abc123');
    expect(fs.readFileSync(cwdLog, 'utf-8').trim()).toBe(cwd);
  });
});

describe('scan of the Claude config dir (#190)', () => {
  it('AC-4: lists ~/.claude as Git project, not the plugin marketplaces', async () => {
    const claude = path.join(root, 'scan', '.claude');
    fs.mkdirSync(path.join(claude, '.git'), { recursive: true });
    fs.mkdirSync(path.join(claude, 'plugins', 'marketplaces', 'x', '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(claude, 'plugins', 'marketplaces', 'x', 'package.json'),
      '{"name":"x"}'
    );
    const dataDir = fs.mkdtempSync(path.join(root, 'scan-data-'));
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({ directories: [claude], scanDepth: 2 })
    );
    vi.stubEnv('DEVORBIT_DATA_PATH', dataDir);
    // keep the real ~/.claude/jobs out of the scan
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(root, 'no-jobs'));
    try {
      vi.resetModules();
      const scanner = await import('../server/services/scannerService.js');
      const paths = scanner.scanAllDirectories().map((p) => p.path);
      expect(paths).toContain(claude);
      expect(paths.some((p) => p.includes('marketplaces'))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
