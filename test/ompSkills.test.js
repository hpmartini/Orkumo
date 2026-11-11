import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ompSkillsArgs, ompSkillsOverlay } from '../server/services/ompSkills.js';

describe('omp skills overlay', () => {
  it('opts in Claude user skills and plugins, keeping the user’s own providers', () => {
    expect(ompSkillsOverlay([])).toEqual({
      enabledProviders: ['claude-plugins'],
      skills: { enableClaudeUser: true },
    });
    expect(ompSkillsOverlay(['codex', 'claude-plugins']).enabledProviders).toEqual([
      'codex',
      'claude-plugins',
    ]);
  });

  it('writes the overlay file omp gets as --config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-skills-'));
    const args = ompSkillsArgs('/nonexistent/omp', dir, { dataDir: dir });
    expect(args).toEqual(['--config', path.join(dir, 'omp-skills.json')]);
    expect(JSON.parse(fs.readFileSync(args[1], 'utf8')).enabledProviders).toEqual([
      'claude-plugins',
    ]);
  });

  it('starts omp without an overlay when it cannot be written', () => {
    expect(ompSkillsArgs('/nonexistent/omp', '/', { dataDir: '/nonexistent' })).toEqual([]);
  });
});
