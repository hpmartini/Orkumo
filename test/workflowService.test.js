import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractImages,
  findDocs,
  parseJournal,
  parseTrace,
  pendingApproval,
  pickLatestVersion,
} from '../server/services/workflowService.js';

describe('workflowService parsers', () => {
  it('pickLatestVersion compares numerically', () => {
    expect(pickLatestVersion(['6.9.0', '6.29.0', '6.27.0', 'tmp'])).toBe('6.29.0');
    expect(pickLatestVersion([])).toBeNull();
  });

  it('parseJournal keeps the newest run dir per session and skips broken lines', () => {
    const text = [
      JSON.stringify({ session: 's1', run_dir: '/a', repo_path: '/r' }),
      'not json',
      JSON.stringify({ session: 's1', run_dir: '/b', repo_path: '/r' }),
      JSON.stringify({ session: 's2', kind: 'decision' }),
    ].join('\n');
    const j = parseJournal(text);
    expect(j.get('s1')).toEqual({ runDir: '/b', repoPath: '/r' });
    expect(j.has('s2')).toBe(false);
  });

  it('parseTrace reads the issue number and phases in order', () => {
    const text = [
      JSON.stringify({ ts: 't1', issue: 4, phase: 'plan', result: 'passed', role: 'planner' }),
      JSON.stringify({ ts: 't2', issue: 4, phase: 'build', result: 'failed', model: 'm' }),
    ].join('\n');
    expect(parseTrace(text)).toEqual({
      issue: 4,
      phases: [
        { phase: 'plan', result: 'passed', at: 't1', role: 'planner', model: '' },
        { phase: 'build', result: 'failed', at: 't2', role: '', model: 'm' },
      ],
    });
  });

  it('pendingApproval: records without `by`, the latest stage wins', () => {
    expect(
      pendingApproval([
        { stage: 'plan', sha: 'a', by: 'hpmartini' },
        { stage: 'pr', sha: 'b' },
        null,
      ])
    ).toEqual({ stage: 'pr', sha: 'b' });
    expect(pendingApproval([{ stage: 'plan', sha: 'a', by: 'policy:auto.plan' }])).toBeNull();
  });

  it('extractImages finds markdown and html images once', () => {
    const a = 'https://github.com/user-attachments/assets/1.png';
    const b = 'https://example.com/2.png';
    expect(
      extractImages([`![shot](${a})`, `<img width="300" src="${b}">`, `![again](${a})`])
    ).toEqual([a, b]);
  });
});

describe('findDocs', () => {
  it('lists the marker briefing and doc files, never paths outside the checkout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-docs-'));
    fs.mkdirSync(path.join(dir, 'briefings'));
    fs.writeFileSync(path.join(dir, 'briefings/b.md'), '# B');
    fs.writeFileSync(path.join(dir, 'PLAN.md'), '# P');
    fs.writeFileSync(path.join(dir, 'README.md'), '# R');
    const docs = await findDocs([dir], 'briefings/b.md');
    expect(docs.map((d) => d.name).sort()).toEqual(['PLAN.md', 'briefings/b.md']);
    expect(await findDocs([dir], '../../etc/passwd')).toHaveLength(1);
  });
});
