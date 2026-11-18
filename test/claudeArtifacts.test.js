// Claude artifacts: pages on claude.ai the Artifact tool published, read, or the agent linked to
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createArtifactLog,
  logArtifactEvent,
  claudeArtifacts,
  pageType,
} from '../server/services/chatArtifacts.js';

const URL_A = 'https://claude.ai/artifact/AaaAaa111';
const URL_B = 'https://claude.ai/artifact/BbbBbb222';

const use = (id, input) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'Artifact', input }] },
});
const result = (id, text, isError = false) => ({
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
  },
});
const text = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
const published = (file, url, version, epoch) =>
  `Published ${file} at ${url} (Version ${version}, version id ${epoch}-ab12)`;

const run = (events) => {
  const log = createArtifactLog();
  for (const e of events) logArtifactEvent(log, e);
  return claudeArtifacts(log);
};

let tmp;
afterEach(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }));

describe('claude artifacts', () => {
  it('a publish is one artifact; the URL comes from the result, not the input', () => {
    const list = run([
      use('p1', {
        file_path: '/w/report.html',
        label: 'First draft',
        description: 'Weekly report',
      }),
      result('p1', published('/w/report.html', URL_A, 1, 1794504144)),
    ]);
    expect(list).toEqual([
      {
        url: URL_A,
        source: 'published',
        title: null,
        label: 'First draft',
        description: 'Weekly report',
        version: 1,
        updatedAt: 1794504144000,
        file: '/w/report.html',
        type: 'Document',
      },
    ]);
  });

  it('several publishes of one URL are one entry with the newest version; label and description carry over', () => {
    const list = run([
      use('p1', { file_path: '/w/kpi.html', label: 'KPI board', description: 'Team metrics' }),
      result('p1', published('/w/kpi.html', URL_A, 48, 1794504144)),
      use('p2', { file_path: '/w/kpi.html', url: URL_A }),
      result('p2', published('/w/kpi.html', URL_A, 49, 1794507018)),
      use('p3', { file_path: '/w/kpi.html', url: URL_A, label: 'Colors fixed' }),
      result(
        'p3',
        'Updated the Artifact at ' + URL_A + ' (Version 50, version id 1794507971-7d29)'
      ),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      version: 50,
      label: 'Colors fixed',
      description: 'Team metrics',
      updatedAt: 1794507971000,
      file: '/w/kpi.html',
    });
  });

  it('a read is no artifact of its own, only marked as read', () => {
    const list = run([use('r1', { action: 'read', url: URL_B }), result('r1', '<page>')]);
    expect(list).toEqual([expect.objectContaining({ url: URL_B, source: 'read', version: null })]);
    // read, then published in the session: one published entry
    const both = run([
      use('r1', { action: 'read', url: URL_A }),
      result('r1', '<page>'),
      use('p1', { file_path: '/w/a.html', url: URL_A }),
      result('p1', published('/w/a.html', URL_A, 3, 1794504144)),
    ]);
    expect(both.map((a) => [a.url, a.source])).toEqual([[URL_A, 'published']]);
  });

  it('failed publishes and asset uploads are no artifact', () => {
    expect(
      run([
        use('p1', { file_path: '/w/a.html' }),
        result('p1', 'Publish refused', true),
        use('p2', { file_path: '/w/logo.png', url: URL_A, asset: true }),
        result('p2', published('/w/logo.png', URL_A, 1, 1794504144)),
      ])
    ).toEqual([]);
  });

  it('links in the agent text count, links inside tool results do not', () => {
    const list = run([
      text(`The page is at ${URL_B}. Also see ${URL_B}, and the plan.`),
      use('r1', { action: 'read', url: URL_A }),
      result('r1', `someone else's page links to https://claude.ai/artifact/Foreign999`),
    ]);
    expect(list.map((a) => [a.url, a.source])).toEqual([
      [URL_B, 'linked'],
      [URL_A, 'read'],
    ]);
  });

  it('the type comes from label and description, then file name, then the source head', () => {
    expect(pageType({ label: 'Q3 Slides' })).toBe('Slides');
    expect(pageType({ description: 'Sales KPI dashboard' })).toBe('Dashboard');
    expect(pageType({ label: 'Onboarding mockup' })).toBe('Design');
    expect(pageType({ label: 'Gesamtjournal' })).toBe('Document');
    expect(pageType({ file: '/w/pitch-deck.html' })).toBe('Slides');
    expect(pageType({ file: '/w/x.html' }, '<section class="slide">')).toBe('Slides');
    expect(pageType({ label: 'Hello' }, '<p>hi</p>')).toBe('Page');
  });

  it('the page title comes from the local source', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-artifacts-'));
    const file = path.join(tmp, 'page.html');
    fs.writeFileSync(file, '<html><head><title> Pricing Mockup </title></head></html>');
    const [page] = run([
      use('p1', { file_path: file }),
      result('p1', published(file, URL_A, 1, 1)),
    ]);
    expect(page).toMatchObject({ title: 'Pricing Mockup', type: 'Design' });
  });

  it('omp sessions: no publish tool, links in its text still count', () => {
    // omp's events arrive in the same assistant/text shape (chatTranscripts)
    expect(run([text(`done: ${URL_A}`)])).toEqual([
      expect.objectContaining({ url: URL_A, source: 'linked', type: 'Page' }),
    ]);
  });
});
