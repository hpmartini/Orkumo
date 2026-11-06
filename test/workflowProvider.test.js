import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import {
  validateProvider,
  setProvider,
  annotateItem,
  applyGo,
  providerInfo,
} from '../server/services/workflowProvider.js';
import { createModuleHost } from '../server/services/moduleLoader.js';
import { mapItem, withWorkflow } from '../server/services/boardService.js';

/**
 * Conformance of the workflow provider contract (docs/WORKFLOW_PROVIDER.md) through
 * scripts/workflow-conformance.mjs (plain node: providers may live outside this repo). Runs against
 * the examples and, with WORKFLOW_PROVIDER_DIR=<module dir>, e.g. mw's plugins/mw/orkumo.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'examples');

const ITEM = {
  itemId: 'PVTI_1',
  type: 'Issue',
  repo: 'o/r',
  number: 1,
  url: 'https://github.com/o/r/issues/1',
  state: 'OPEN',
  closedAt: null,
  labels: [],
  pullRequests: [],
  subIssues: { total: 0, completed: 0 },
};

afterEach(() => setProvider(null));

describe.each([EXAMPLES, process.env.WORKFLOW_PROVIDER_DIR].filter(Boolean))(
  'conformance: %s',
  (dir) => {
    it('every provider validates as v1 and annotates within the contract', () => {
      const r = spawnSync(process.execPath, ['scripts/workflow-conformance.mjs', dir], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      console.log(r.stdout);
      expect(r.stdout).toMatch(/^ok /m);
      expect(r.status, r.stdout + r.stderr).toBe(0);
    });

    it('the script fails a broken provider', () => {
      const r = spawnSync(
        process.execPath,
        ['scripts/workflow-conformance.mjs', path.join(ROOT, 'test/fixtures/workflow/broken')],
        { cwd: ROOT, encoding: 'utf8' }
      );
      expect(r.stdout).toMatch(/^FAIL .*apiVersion/m);
      expect(r.status).toBe(1);
    });
  }
);

describe('validateProvider', () => {
  const ok = { apiVersion: 1, name: 'X', stages: [{ id: 'a', label: 'A' }], annotate: () => null };
  it.each([
    ['unknown apiVersion', { ...ok, apiVersion: 2 }, /apiVersion 2 not supported/],
    ['no stages', { ...ok, stages: [] }, /stages/],
    [
      'duplicate stage ids',
      {
        ...ok,
        stages: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ],
      },
      /unique/,
    ],
    ['annotate missing', { ...ok, annotate: undefined }, /annotate/],
    ['unknown placeholder', { ...ok, commands: { go: ['t', '{cmd}'] } }, /unknown placeholder/],
    ['placeholder as command', { ...ok, commands: { go: ['{issue}'] } }, /command itself/],
    ['non-string argv', { ...ok, commands: { go: ['t', 1] } }, /string array/],
    ['bad sessionName', { ...ok, sessionName: '(' }, /Invalid regular expression|Unterminated/],
  ])('refuses %s', (_l, wf, err) => {
    expect(() => validateProvider(wf)).toThrow(err);
  });

  it('accepts the minimal provider; providerInfo hides functions and commands', () => {
    setProvider({ ...ok, commands: { go: ['t', '{issue}'] }, start: async () => ({}) });
    expect(providerInfo()).toEqual({
      name: 'X',
      apiVersion: 1,
      stages: ok.stages,
      controls: null,
      sessionName: null,
    });
  });

  it('refuses a second provider', () => {
    setProvider(ok);
    expect(() => setProvider(ok)).toThrow(/already loaded/);
  });
});

describe('annotation by the host', () => {
  // marker-reading provider: whatever comments it sees move the stage
  const reader = {
    apiVersion: 1,
    name: 'Reader',
    stages: [
      { id: 'idle', label: 'Idle' },
      { id: 'started', label: 'Started' },
    ],
    annotate: (item) => ({
      state: {
        stage: item.comments.some((c) => c.body.includes('<!-- start -->')) ? 'started' : 'idle',
        waitingOn: null,
        reason: '',
      },
      sessionIds: [],
    }),
  };
  const node = (comments) => ({
    id: 'PVTI_n',
    content: {
      __typename: 'Issue',
      id: 'I_1',
      number: 1,
      url: ITEM.url,
      comments: { nodes: comments },
    },
  });

  it('no provider: workflow is null', () => {
    expect(withWorkflow(mapItem(node([]), ['owner'])).workflow).toBeNull();
  });

  it('markers count only from trusted authors (AC-8)', () => {
    setProvider(reader);
    const foreign = node([
      { body: '<!-- start -->', createdAt: 't', author: { login: 'stranger' } },
    ]);
    expect(withWorkflow(mapItem(foreign, ['owner'])).workflow.state.stage).toBe('idle');
    const own = node([{ body: '<!-- start -->', createdAt: 't', author: { login: 'owner' } }]);
    expect(withWorkflow(mapItem(own, ['owner'])).workflow.state.stage).toBe('started');
  });

  it('raw comments never reach the client item', () => {
    setProvider(reader);
    const item = withWorkflow(
      mapItem(node([{ body: 'x', createdAt: 't', author: { login: 'owner' } }]), ['owner'])
    );
    expect(item).not.toHaveProperty('comments');
    expect(JSON.stringify(item)).not.toContain('"body"');
  });

  it('a throwing or contract-breaking annotate becomes null, not a crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setProvider({
      ...reader,
      annotate: () => {
        throw new Error('boom');
      },
    });
    expect(annotateItem(ITEM, [], null)).toBeNull();
    setProvider(null);
    setProvider({ ...reader, annotate: () => ({ state: { stage: 'nope', reason: '' } }) });
    expect(annotateItem(ITEM, [], null)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('applyGo', () => {
  const ctx = (go) => ({
    source: {},
    item: { ...ITEM, itemId: 'PVTI_1', workflow: { state: { go }, sessionIds: [] } },
  });

  it('409 unless the kind is the GO the fresh state offers; nothing runs', async () => {
    const go = vi.fn();
    setProvider({
      apiVersion: 1,
      name: 'G',
      stages: [{ id: 'a', label: 'A' }],
      annotate: () => null,
      go,
    });
    const updateIssue = vi.fn();
    expect(
      (await applyGo(ctx({ kind: 'build', text: 'GO' }), { kind: 'poll' }, { updateIssue })).status
    ).toBe(409);
    expect((await applyGo(ctx(null), { kind: 'build' }, { updateIssue })).status).toBe(409);
    expect(go).not.toHaveBeenCalled();
  });

  it('runs the provider go with setLabels bound to the item', async () => {
    const example = (
      await import(pathToFileURL(path.join(EXAMPLES, 'workflow-provider-labels/index.js')).href)
    ).default;
    setProvider(example.workflow);
    const updateIssue = vi.fn(async () => ({ itemId: 'PVTI_1' }));
    const c = ctx({ kind: 'doing', text: 'Starten' });
    c.item.labels = [{ name: 'wf:todo' }, { name: 'bug' }];
    const r = await applyGo(c, { kind: 'doing' }, { updateIssue });
    expect(r.status).toBe(200);
    expect(updateIssue).toHaveBeenCalledWith({}, 'PVTI_1', { labels: ['bug', 'wf:doing'] });
    expect(r.body.note).toBe('wf:doing gesetzt');
  });
});

describe('module loader with providers', () => {
  it('loads a path list and registers exactly one provider', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const host = createModuleHost({ services: {}, logger });
    const fixtures = path.join(ROOT, 'test/fixtures/workflow/cli');
    const loaded = await host.load([EXAMPLES, fixtures].join(path.delimiter));
    expect(loaded.map((m) => m.id)).toEqual(['workflow-labels']);
    expect(providerInfo().name).toBe('Label Workflow');
    expect(String(logger.error.mock.calls[0]?.[1])).toMatch(/already loaded/);
  });
});
