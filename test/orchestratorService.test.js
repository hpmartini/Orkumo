// Orchestrators: workspace bootstrap, overview, transcripts, projects, agent panes
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureOrchestratorWorkspace,
  templatesDir,
  buildOverview,
  overviewAgent,
  isListedAgent,
  isOrchestratorSession,
  lastAssistantText,
  readSessionTranscript,
  findSessionByRef,
  projectList,
  startAgentPane,
  orchestratorBriefing,
  SKILL_NAME,
} from '../server/services/orchestratorService.js';

let dataDir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const bootstrap = () =>
  ensureOrchestratorWorkspace({ apiUrl: 'http://127.0.0.1:4555/api', dataDir });

describe('ensureOrchestratorWorkspace', () => {
  it('creates the workspace: AGENTS.md, CLAUDE.md link, settings, skills, CLI', () => {
    const { dir, cli, changed } = bootstrap();
    expect(dir).toBe(path.join(dataDir, 'orchestrator'));
    expect(cli).toBe(path.join(dataDir, 'orchestrator-bin', 'orkumo'));
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(dir);
    expect(agents).toContain(cli);
    expect(agents).not.toContain('{{');
    expect(agents).toMatch(/German/);
    expect(fs.readlinkSync(path.join(dir, 'CLAUDE.md'))).toBe('AGENTS.md');

    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Bash(orkumo *)');
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Task', 'Agent']));
    expect(settings.hooks.PreToolUse[0].matcher).toMatch(/Edit/);
    expect(settings.hooks.PreToolUse[0].matcher).toMatch(/NotebookEdit/);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(`"${cli}" guard`);
    expect(settings.env.ORKUMO_CLI).toBe(cli);

    for (const root of ['.claude', '.omp']) {
      const skill = fs.readFileSync(path.join(dir, root, 'skills', SKILL_NAME, 'SKILL.md'), 'utf8');
      expect(skill).toMatch(/^---\nname: orkumo-orchestrator\ndescription: /);
      expect(skill).toContain('http://127.0.0.1:4555/api');
    }
    expect(fs.statSync(cli).mode & 0o111).toBeTruthy();
    expect(fs.readFileSync(path.join(dataDir, 'orchestrator-bin', 'orkumo.mjs'), 'utf8')).toBe(
      fs.readFileSync(path.join(templatesDir(), 'orkumo.mjs'), 'utf8')
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'orchestrator-bin', 'orkumo.json'), 'utf8'))
    ).toEqual({
      apiUrl: 'http://127.0.0.1:4555/api',
      tokenFile: path.join(dataDir, 'remote-token'),
      workspace: dir,
    });
    expect(changed).toEqual(
      expect.arrayContaining(['AGENTS.md', 'NOTES.md', 'orchestrator-bin/orkumo'])
    );
    for (const file of [
      'AGENTS.md',
      '.claude/settings.json',
      `.omp/skills/${SKILL_NAME}/SKILL.md`,
    ]) {
      expect(fs.statSync(path.join(dir, file)).mode & 0o777).toBe(0o444);
    }
    expect(fs.statSync(path.join(dataDir, 'orchestrator-bin', 'orkumo.json')).mode & 0o777).toBe(
      0o444
    );
    expect(fs.statSync(cli).mode & 0o777).toBe(0o555);
    expect(fs.statSync(path.join(dir, 'NOTES.md')).mode & 0o200).toBeTruthy();
    expect(fs.existsSync(path.join(dir, 'bin'))).toBe(false);
  });

  it("is idempotent and keeps the orchestrators' NOTES.md", () => {
    const { dir } = bootstrap();
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'my notes');
    const agentsMtime = fs.statSync(path.join(dir, 'AGENTS.md')).mtimeMs;
    expect(bootstrap().changed).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'NOTES.md'), 'utf8')).toBe('my notes');
    expect(fs.statSync(path.join(dir, 'AGENTS.md')).mtimeMs).toBe(agentsMtime);
  });

  it('restores generated files edited or removed by hand', () => {
    const { dir } = bootstrap();
    fs.chmodSync(path.join(dir, 'AGENTS.md'), 0o644);
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'tampered');
    fs.rmSync(path.join(dir, 'CLAUDE.md'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'a plain file');
    const { changed } = bootstrap();
    expect(changed).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(fs.readlinkSync(path.join(dir, 'CLAUDE.md'))).toBe('AGENTS.md');
  });

  it('moves the CLI out of an old workspace bin/ and stays idempotent', () => {
    const old = path.join(dataDir, 'orchestrator', 'bin');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'orkumo.json'), '{"apiUrl":"http://evil.example/api"}');
    const { dir } = bootstrap();
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.readdirSync(path.join(dataDir, 'orchestrator-bin')).sort()).toEqual([
      'orkumo',
      'orkumo.json',
      'orkumo.mjs',
    ]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      '.claude',
      '.omp',
      'AGENTS.md',
      'CLAUDE.md',
      'NOTES.md',
    ]);
    expect(bootstrap().changed).toEqual([]);
  });

  it('follows a new API address', () => {
    bootstrap();
    const { changed } = ensureOrchestratorWorkspace({
      apiUrl: 'http://127.0.0.1:4999/api',
      dataDir,
    });
    expect(changed).toEqual(
      expect.arrayContaining([
        'orchestrator-bin/orkumo.json',
        `.claude/skills/${SKILL_NAME}/SKILL.md`,
      ])
    );
  });
});

describe('orchestratorBriefing', () => {
  it('points to AGENTS.md and the CLI', () => {
    const text = orchestratorBriefing('/data/orchestrator');
    expect(text).toContain('/data/orchestrator/AGENTS.md');
    expect(text).toContain('"/data/orchestrator-bin/orkumo" agents');
  });
});

const NOW = Date.parse('2026-11-13T12:00:00Z');
const s = (partial) => ({
  id: 'job1',
  sessionId: 'uuid-1',
  kind: 'background',
  cwd: '/p/app',
  name: 'job',
  state: 'working',
  displayState: 'working',
  waitingFor: null,
  startedAt: NOW - 60_000,
  updatedAt: NOW - 10_000,
  links: [],
  paneId: null,
  ...partial,
});

describe('isOrchestratorSession', () => {
  it('matches by row id, transcript uuid or pane id', () => {
    expect(isOrchestratorSession(s({}), ['job1'])).toBe(true);
    expect(isOrchestratorSession(s({ id: 'interactive-9' }), ['uuid-1'])).toBe(true);
    expect(
      isOrchestratorSession(s({ id: 'x', sessionId: null, paneId: 'orch-1' }), ['orch-1'])
    ).toBe(true);
    expect(isOrchestratorSession(s({}), [])).toBe(false);
    expect(isOrchestratorSession(s({}), undefined)).toBe(false);
  });
});

describe('overview', () => {
  const ctx = {
    repo: { name: 'App', branch: 'feat/x' },
    pulls: {
      items: [
        { number: 7, url: 'https://gh/pr/7', title: 'X', headRef: 'feat/x', isDraft: true },
        { number: 8, url: 'https://gh/pr/8', title: 'Y', headRef: 'main' },
      ],
    },
  };

  it('describes an agent with project, branch, PRs and the orchestrator flag', () => {
    const agent = overviewAgent(s({ ptyCommand: 'omp', paneId: 'p1', pid: 42 }), ctx, {
      orchestrators: ['job1'],
      lastText: 'done',
    });
    expect(agent).toEqual({
      id: 'job1',
      sessionId: 'uuid-1',
      name: 'job',
      harness: 'omp',
      kind: 'background',
      cwd: '/p/app',
      project: 'App',
      branch: 'feat/x',
      state: 'working',
      displayState: 'working',
      waitingFor: null,
      lastActivity: new Date(NOW - 10_000).toISOString(),
      prs: [{ number: 7, url: 'https://gh/pr/7', state: 'draft', title: 'X' }],
      lastText: 'done',
      paneId: 'p1',
      pid: 42,
      orchestrator: true,
    });
  });

  it('prefers the PR links a job reports and names a worktree by its main repo', () => {
    const agent = overviewAgent(
      s({
        cwd: '/p/app/.claude/worktrees/fix',
        links: [
          { href: 'https://gh/pr/3', number: 3, state: 'open', title: 'T' },
          { href: 'https://gh/pr/2', number: 2, state: 'MERGED', title: 'Old' },
        ],
      }),
      undefined
    );
    expect(agent.prs).toEqual([{ number: 3, url: 'https://gh/pr/3', state: 'open', title: 'T' }]);
    expect(agent.project).toBe('app');
    expect(agent.harness).toBe('claude');
    expect(agent.orchestrator).toBe(false);
  });

  it('lists like the rail: no terminals outside Orkumo, no day-old finished agents', () => {
    expect(isListedAgent(s({}), NOW)).toBe(true);
    expect(isListedAgent(s({ kind: 'interactive' }), NOW)).toBe(false);
    expect(isListedAgent(s({ kind: 'interactive', paneId: 'p' }), NOW)).toBe(true);
    expect(isListedAgent(s({ state: 'done', updatedAt: NOW - 2 * 86400_000 }), NOW)).toBe(false);
    expect(isListedAgent(s({ state: 'done', updatedAt: NOW - 3600_000 }), NOW)).toBe(true);
  });

  it('builds newest first with last answers, and everything with all', async () => {
    const sessions = [
      s({ id: 'old', updatedAt: NOW - 50_000 }),
      s({ id: 'new', updatedAt: NOW - 1_000 }),
      s({ id: 'tty', kind: 'interactive' }),
    ];
    const readTranscript = vi.fn(async (session) => [
      { role: 'user', text: 'go' },
      { role: 'assistant', text: `answer of\n  ${session.id}` },
    ]);
    const data = await buildOverview({
      sessions,
      contexts: { new: ctx },
      orchestrators: ['old'],
      readTranscript,
      now: NOW,
      workspace: '/ws',
    });
    expect(data.generatedAt).toBe(new Date(NOW).toISOString());
    expect(data.workspace).toBe('/ws');
    expect(data.agents.map((a) => a.id)).toEqual(['new', 'old']);
    expect(data.agents[0]).toMatchObject({ lastText: 'answer of new', branch: 'feat/x' });
    expect(data.agents[1]).toMatchObject({ orchestrator: true });

    const all = await buildOverview({
      sessions,
      all: true,
      withText: false,
      readTranscript,
      now: NOW,
    });
    expect(all.agents.map((a) => a.id)).toEqual(['new', 'tty', 'old']);
    expect(sessions.map((x) => x.id)).toEqual(['old', 'new', 'tty']); // input left unsorted
    expect(all.agents.every((a) => a.lastText === null)).toBe(true);
    expect(readTranscript).toHaveBeenCalledTimes(2);
  });

  it('keeps an agent whose transcript cannot be read', async () => {
    const data = await buildOverview({
      sessions: [s({})],
      readTranscript: () => Promise.reject(new Error('gone')),
      now: NOW,
    });
    expect(data.agents[0].lastText).toBeNull();
  });

  it('shortens the last answer to one line', () => {
    expect(lastAssistantText([{ role: 'assistant', text: 'x'.repeat(400) }])).toHaveLength(280);
    expect(lastAssistantText([{ role: 'user', text: 'hi' }])).toBeNull();
  });
});

describe('readSessionTranscript', () => {
  const deps = (extra = {}) => ({
    getTranscriptTail: vi.fn(async () => ({ entries: [{ role: 'assistant', text: 'job' }] })),
    readTranscriptTail: vi.fn(async () => ({ entries: [{ role: 'assistant', text: 'tty' }] })),
    findOmpSessionFile: vi.fn(async () => '/omp/file.jsonl'),
    readOmpTranscriptTail: vi.fn(async () => [{ role: 'assistant', text: 'omp' }]),
    projectSlug: (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    projectsDir: dataDir,
    ...extra,
  });

  it('reads omp sessions from their store, jobs by id, Claude terminals by their file', async () => {
    const d = deps();
    expect(await readSessionTranscript(s({ id: 'omp-u1', sessionId: 'u1' }), 5, d)).toEqual([
      { role: 'assistant', text: 'omp' },
    ]);
    expect(d.findOmpSessionFile).toHaveBeenCalledWith('u1');
    expect(await readSessionTranscript(s({}), 5, d)).toEqual([{ role: 'assistant', text: 'job' }]);
    expect(d.getTranscriptTail).toHaveBeenCalledWith('job1', 5);

    const tty = s({ id: 'interactive-1', kind: 'interactive', sessionId: 'abc', cwd: '/p/app' });
    expect(await readSessionTranscript(tty, 5, d)).toEqual([]);
    fs.mkdirSync(path.join(dataDir, '-p-app'));
    fs.writeFileSync(path.join(dataDir, '-p-app', 'abc.jsonl'), '');
    expect(await readSessionTranscript(tty, 5, d)).toEqual([{ role: 'assistant', text: 'tty' }]);
    expect(d.readTranscriptTail).toHaveBeenCalledWith(path.join(dataDir, '-p-app', 'abc.jsonl'), 5);
  });

  it('finds sessions by row id, uuid or pane id', () => {
    const list = [s({}), s({ id: 'interactive-2', sessionId: 'u2', paneId: 'orch-9' })];
    expect(findSessionByRef(list, 'orch-9').id).toBe('interactive-2');
    expect(findSessionByRef(list, 'u2').id).toBe('interactive-2');
    expect(findSessionByRef(list, 'nope')).toBeNull();
  });
});

describe('projectList', () => {
  it('lists projects once, by name, with their listed agents', () => {
    const apps = [
      { id: 'b', name: 'Beta', path: '/p/beta' },
      { id: 'a', name: 'Alpha', path: '/p/alpha' },
      { id: 'a2', name: 'Alpha copy', path: '/p/alpha' },
      { id: 'x', name: 'No path', path: '' },
    ];
    const sessions = [
      s({ cwd: '/p/alpha' }),
      s({ cwd: '/p/alpha/.claude/worktrees/w' }),
      s({ cwd: '/p/alphabet' }),
      s({ cwd: '/p/alpha', kind: 'interactive' }),
    ];
    expect(projectList(apps, sessions, NOW)).toEqual([
      { name: 'Alpha', path: '/p/alpha', agents: 2 },
      { name: 'Beta', path: '/p/beta', agents: 0 },
    ]);
  });
});

describe('startAgentPane', () => {
  const paneDeps = () => ({
    workspace: '/data/orchestrator',
    openAgentPty: vi.fn(async () => ({ success: true })),
    killPanePtys: vi.fn(),
    resolveBinary: () => '/bin/omp',
    ompArgs: () => ['--config', 'x'],
    findOmpSession: vi.fn(async () => 'omp-uuid'),
  });

  it('starts an orchestrator in a held pane that finds the CLI on PATH', async () => {
    const deps = paneDeps();
    const result = await startAgentPane(
      { harness: 'claude', cwd: '/data/orchestrator', prompt: 'survey', orchestrator: true },
      deps
    );
    expect(result.paneId).toMatch(/^orch-/);
    const [ptyId, cwd, , , options] = deps.openAgentPty.mock.calls[0];
    expect(ptyId).toMatch(new RegExp(`^agent-${result.paneId}-\\d+$`));
    expect(cwd).toBe('/data/orchestrator');
    expect(options).toMatchObject({
      command: 'claude',
      detachOnClose: true,
      pathPrefix: ['/data/orchestrator-bin'],
      env: { ORKUMO_CLI: '/data/orchestrator-bin/orkumo', ORKUMO_WORKSPACE: '/data/orchestrator' },
    });
    expect(options.args).toEqual(['--session-id', result.sessionId, '--', 'survey']);
  });

  it('starts a worker omp pane in a project without orchestrator tooling', async () => {
    const deps = paneDeps();
    const result = await startAgentPane({ harness: 'omp', cwd: '/p/app', prompt: 'fix it' }, deps);
    expect(result).toMatchObject({ harness: 'omp', sessionId: 'omp-uuid', cwd: '/p/app' });
    expect(result.paneId).toMatch(/^work-/);
    const options = deps.openAgentPty.mock.calls[0][4];
    expect(options).toEqual({
      command: '/bin/omp',
      args: ['--config', 'x', '--', 'fix it'],
      detachOnClose: true,
    });
  });

  it('refuses harnesses whose sessions a pane cannot name', () => {
    expect(() => startAgentPane({ harness: 'codex', cwd: '/p', prompt: 'x' }, paneDeps())).toThrow(
      /Claude Code or Oh My Pi/
    );
  });
});
