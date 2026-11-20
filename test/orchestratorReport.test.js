import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseReport, reportSchema } from '../server/services/orchestratorReport.js';
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
  ])('rejects %s', (_name, mutate, path) => {
    const report = clone();
    mutate(report);
    const result = parseReport(report);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(path);
  });
});

it('published JSON Schema matches the zod schema (run scripts/orchestrator-report-schema.mjs)', () => {
  expect({ ...published, $id: undefined, title: undefined }).toEqual({
    $id: undefined,
    title: undefined,
    ...JSON.parse(JSON.stringify(z.toJSONSchema(reportSchema, { io: 'input' }))),
  });
});
