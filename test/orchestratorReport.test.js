import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  PROJECT_ID_HINT,
  parseReport,
  reportSchema,
} from '../server/services/orchestratorReport.js';
import published from '../server/orchestrator/report.schema.json';
import example from '../server/orchestrator/report.example.json';

const clone = () => structuredClone(example);

describe('orchestrator report schema', () => {
  it('accepts the published example', () => {
    expect(parseReport(example)).toMatchObject({ ok: true });
  });

  it.each(['constructor', '__proto__', 'toString'])('rejects the reserved entry id %s', (bad) => {
    const r = structuredClone(example);
    r.inbox[0].id = bad;
    expect(parseReport(r)).toMatchObject({ ok: false });
  });

  it.each([
    ['missing orchestrator id', (r) => delete r.orchestrator.id, 'orchestrator.id'],
    [
      'unknown task state',
      (r) => (r.projects[0].tasks[0].state = 'blocked'),
      'projects.0.tasks.0.state',
    ],
    ['wrong schema version', (r) => (r.schemaVersion = 2), 'schemaVersion'],
    [
      'recommendation not an option',
      (r) => (r.inbox[0].recommendation = 'x'),
      'inbox.0.recommendation',
    ],
    ['approval without pr', (r) => delete r.inbox[1].pr, 'inbox.1.pr'],
    ['unknown top-level field', (r) => (r.extra = 1), '(root)'],
    ['extension key without x-', (r) => (r.extensions = { foo: 1 }), 'extensions'],
    [
      'description over 20 000 characters',
      (r) => (r.inbox[0].description = 'x'.repeat(20001)),
      'inbox.0.description',
    ],
  ])('rejects %s', (_name, mutate, path) => {
    const report = clone();
    mutate(report);
    const result = parseReport(report);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(path);
  });

  // AC-14: the hint tells the orchestrator what to do, word for word
  it.each([
    ['without', (r) => delete r.inbox[2].projectId],
    ['with an unknown', (r) => (r.inbox[2].projectId = 'nowhere')],
  ])('refuses an inbox entry %s projectId with the hint', (_name, mutate) => {
    const report = clone();
    mutate(report);
    expect(parseReport(report)).toEqual({
      ok: false,
      errors: [`inbox.2.projectId: ${PROJECT_ID_HINT}`],
    });
  });

  it('accepts a project "general" for items without a project', () => {
    const report = clone();
    report.projects.push({ id: 'general', name: 'General', tasks: [] });
    report.inbox[2].projectId = 'general';
    expect(parseReport(report)).toMatchObject({ ok: true });
  });
});

it('published JSON Schema keeps projectId required', () => {
  for (const entry of published.properties.inbox.items.oneOf ??
    published.properties.inbox.items.anyOf)
    expect(entry.required).toContain('projectId');
});

it('published JSON Schema matches the zod schema (run scripts/orchestrator-report-schema.mjs)', () => {
  expect({ ...published, $id: undefined, title: undefined }).toEqual({
    $id: undefined,
    title: undefined,
    ...JSON.parse(JSON.stringify(z.toJSONSchema(reportSchema, { io: 'input' }))),
  });
});
