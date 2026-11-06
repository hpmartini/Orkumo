#!/usr/bin/env node
/**
 * Conformance check of workflow providers (docs/WORKFLOW_PROVIDER.md):
 *   node scripts/workflow-conformance.mjs <module dir> [<module dir> …]
 * A module dir holds one subdirectory per module (like DEVHUB_PREMIUM_DIR). Every module with a
 * `workflow` must validate as v1 and annotate a sweep of item shapes within the contract.
 * Exit 0 = all conform; prints one line per provider.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  annotateItem,
  fillCommand,
  setProvider,
  validateProvider,
} from '../server/services/workflowProvider.js';

const ITEM = {
  itemId: 'PVTI_1',
  type: 'Issue',
  repo: 'o/r',
  number: 1,
  url: 'https://github.com/o/r/issues/1',
  closedAt: null,
  pullRequests: [],
  subIssues: { total: 0, completed: 0 },
};
const STATUSES = [null, 'Backlog', 'Todo', 'Briefed', 'In Progress', 'to Review', 'Done'];
const BASE_LABELS = [[], ['wf:todo'], ['wf:doing'], ['wf:done']];
const COMMENTS = [[], [{ body: 'plain comment', createdAt: '2026-01-01T00:00:00Z' }]];

async function check(file) {
  const mod = (await import(pathToFileURL(file).href)).default;
  if (mod?.workflow === undefined) return null;
  validateProvider(mod.workflow);
  setProvider(null);
  setProvider(mod.workflow);
  const ids = mod.workflow.stages.map((s) => s.id);
  // the provider's own control labels, alone and with each other one, besides generic ones
  const c = mod.workflow.controls ?? {};
  const own = [...(c.toggles ?? []), c.start, ...(c.feedback ?? []), c.waiting]
    .filter(Boolean)
    .map((t) => t.label)
    .concat((c.modes?.options ?? []).map((o) => o.label).filter(Boolean));
  const LABELS = [...BASE_LABELS, ...own.map((l) => [l]), ...own.map((l) => [own[0], l])];
  let annotated = 0;
  const warn = console.warn;
  console.warn = (...a) => assert.fail(`annotate threw or broke the contract: ${a.join(' ')}`);
  try {
    for (const status of STATUSES)
      for (const names of LABELS)
        for (const comments of COMMENTS)
          for (const state of ['OPEN', 'CLOSED']) {
            const labels = names.map((name) => ({ name, color: '' }));
            const a = annotateItem({ ...ITEM, state, labels }, comments, status);
            if (a === null) continue;
            annotated++;
            assert.ok(ids.includes(a.state.stage), `stage ${a.state.stage}`);
            assert.ok(['owner', 'agent', 'poll', null].includes(a.state.waitingOn));
            assert.equal(typeof a.state.reason, 'string');
            if (a.state.go) assert.equal(typeof a.state.go.text, 'string');
            assert.ok(Array.isArray(a.sessionIds));
          }
  } finally {
    console.warn = warn;
  }
  for (const argv of Object.values(mod.workflow.commands ?? {})) {
    assert.doesNotMatch(fillCommand(argv, { issue: ITEM.url, uid: 501 }).join(' '), /\{\w+\}/);
  }
  return `${mod.workflow.name}: v${mod.workflow.apiVersion}, ${ids.length} stages, ${annotated} annotated items ok`;
}

let failed = false;
for (const dir of process.argv.slice(2)) {
  for (const entry of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, entry, 'index.js');
    if (!fs.existsSync(file)) continue;
    try {
      const line = await check(file);
      if (line) console.log(`ok   ${line} (${file})`);
    } catch (error) {
      failed = true;
      console.log(`FAIL ${file}: ${error.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
