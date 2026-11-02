import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractImages, findDocs } from '../server/services/workflowService.js';

describe('workflowService parsers', () => {
  it('extractImages finds GitHub-hosted markdown and html images once', () => {
    const a = 'https://github.com/user-attachments/assets/1.png';
    const b = 'https://user-images.githubusercontent.com/1/2.png';
    const foreign = 'https://tracker.example.com/pixel.png';
    expect(
      extractImages([
        `![shot](${a})`,
        `<img width="300" src="${b}">`,
        `![again](${a})`,
        `![x](${foreign})`,
      ])
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
