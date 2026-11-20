// Orchestrator roles: Markdown files in <workspace>/roles, picked when a new orchestrator starts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureOrchestratorWorkspace,
  listRoles,
  assertRole,
  roleStartPrompt,
  roleBriefing,
  overviewAgent,
  startAgentPane,
} from '../server/services/orchestratorService.js';

let dataDir;
let dir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  ({ dir } = ensureOrchestratorWorkspace({ apiUrl: 'http://127.0.0.1:4555/api', dataDir }));
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const role = (name, text) => fs.writeFileSync(path.join(dir, 'roles', name), text);

describe('roles', () => {
  it('the workspace gets a roles folder, and a refresh never touches its files', () => {
    expect(fs.statSync(path.join(dir, 'roles')).isDirectory()).toBe(true);
    role('board-orchestrator.md', '# Rolle: Board\n\nText');
    ensureOrchestratorWorkspace({ apiUrl: 'http://127.0.0.1:4555/api', dataDir });
    expect(fs.readFileSync(path.join(dir, 'roles', 'board-orchestrator.md'), 'utf8')).toBe(
      '# Rolle: Board\n\nText'
    );
  });

  it('lists the Markdown files by name, titled by their first # heading', () => {
    role('board-orchestrator.md', 'intro\n## Sub\n# Rolle: Board (Issues)\n');
    role('review.md', 'no heading');
    role('notes.txt', '# not a role');
    role('.hidden.md', '# hidden');
    expect(listRoles(dir)).toEqual([
      { id: 'board-orchestrator', title: 'Rolle: Board (Issues)' },
      { id: 'review', title: 'review' },
    ]);
  });

  it('no roles folder: no roles', () => {
    fs.rmSync(path.join(dir, 'roles'), { recursive: true });
    expect(listRoles(dir)).toEqual([]);
  });

  it('accepts only existing role files, no paths', () => {
    role('board-orchestrator.md', '# Board');
    fs.writeFileSync(path.join(dir, 'AGENTS-copy.md'), '# outside');
    expect(assertRole('board-orchestrator', dir)).toBe('board-orchestrator');
    for (const bad of [
      'missing',
      '../AGENTS-copy',
      '..',
      'a/b',
      '/etc/passwd',
      '',
      '.hidden',
      42,
    ]) {
      expect(() => assertRole(bad, dir)).toThrow(/Unknown orchestrator role/);
    }
  });

  it('start prompt and briefing point to AGENTS.md and the role file', () => {
    const start = roleStartPrompt('board-orchestrator');
    expect(start).toContain('AGENTS.md');
    expect(start).toContain('roles/board-orchestrator.md');
    expect(start).toMatch(/in addition to AGENTS\.md/);
    expect(start).toMatch(/"Start"/);
    expect(roleBriefing('board-orchestrator', dir)).toContain(
      path.join(dir, 'roles', 'board-orchestrator.md')
    );
  });

  it('a Claude orchestrator with a role is named after it', async () => {
    const deps = {
      workspace: dir,
      openAgentPty: vi.fn(async () => ({ success: true })),
      killPanePtys: vi.fn(),
    };
    const result = await startAgentPane(
      { harness: 'claude', cwd: dir, prompt: 'go', orchestrator: true, name: 'board-orchestrator' },
      deps
    );
    expect(deps.openAgentPty.mock.calls[0][4].args).toEqual([
      '--session-id',
      result.sessionId,
      '--name',
      'board-orchestrator',
      '--remote-control',
      'board-orchestrator',
      '--',
      'go',
    ]);
  });

  it('the overview carries the role of a marked session', () => {
    const session = { id: 'interactive-1', sessionId: 'uuid-1', kind: 'interactive' };
    const roles = { 'uuid-1': 'board-orchestrator' };
    expect(
      overviewAgent(session, null, { orchestrators: ['uuid-1'], orchestratorRoles: roles }).role
    ).toBe('board-orchestrator');
    expect(overviewAgent(session, null, {}).role).toBeNull();
  });
});
