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
  moduleProviderInfo,
  runControl,
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
    [
      '{issue} inside an argument',
      { ...ok, commands: { go: ['t', '--issue={issue}'] } },
      /whole argument/,
    ],
    ['bad sessionName', { ...ok, sessionName: '(' }, /Invalid regular expression|Unterminated/],
    [
      'unknown control op',
      { ...ok, control: { ops: { 'issue.delete': { argv: ['t'] } } } },
      /unknown control op/,
    ],
    ['control without ops', { ...ok, control: {} }, /control.ops/],
    [
      'control argv with {issue} inside an argument',
      { ...ok, control: { ops: { 'issue.add': { argv: ['t', '--url={issue}'] } } } },
      /whole argument/,
    ],
    [
      'control argv with an unknown placeholder',
      { ...ok, control: { ops: { status: { argv: ['t', '{input}'] } } } },
      /unknown placeholder/,
    ],
    ['empty control argv', { ...ok, control: { ops: { status: { argv: [] } } } }, /string array/],
    [
      'non-boolean input',
      { ...ok, control: { ops: { 'settings.set': { argv: ['t'], input: 'yes' } } } },
      /input must be a boolean/,
    ],
    [
      'non-string label',
      { ...ok, control: { ops: { status: { argv: ['t'], label: 3 } } } },
      /label and hint/,
    ],
    [
      'an option key that is no identifier',
      {
        ...ok,
        control: {
          ops: { 'issue.add': { argv: ['t'], options: [{ key: 'Run fast', label: 'x' }] } },
        },
      },
      /options\[\]\.key/,
    ],
    [
      'an option without label',
      { ...ok, control: { ops: { 'issue.add': { argv: ['t'], options: [{ key: 'fast' }] } } } },
      /needs a label/,
    ],
    [
      'duplicate option keys',
      {
        ...ok,
        control: {
          ops: {
            'issue.add': {
              argv: ['t'],
              options: [
                { key: 'fast', label: 'a' },
                { key: 'fast', label: 'b' },
              ],
            },
          },
        },
      },
      /unique/,
    ],
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
    expect(moduleProviderInfo()).toEqual({ ...providerInfo(), control: null });
  });

  it('modules see control ops without argv; the client sees no control', () => {
    setProvider({
      ...ok,
      control: {
        ops: {
          status: { argv: ['t', 'status'] },
          'issue.add': {
            argv: ['t', 'add', '{issue}'],
            input: true,
            label: 'Add',
            hint: 'Adds it',
            options: [
              { key: 'fast', label: 'Fast', hint: 'Quicker' },
              { key: 'slow', label: 'Slow' },
            ],
          },
        },
      },
    });
    expect(providerInfo()).not.toHaveProperty('control');
    expect(moduleProviderInfo().control).toEqual({
      ops: {
        status: {},
        'issue.add': {
          label: 'Add',
          hint: 'Adds it',
          input: true,
          options: [
            { key: 'fast', label: 'Fast', hint: 'Quicker' },
            { key: 'slow', label: 'Slow' },
          ],
        },
      },
    });
    expect(JSON.stringify(moduleProviderInfo())).not.toContain('argv');
  });

  it('refuses a second provider', () => {
    setProvider(ok);
    expect(() => setProvider(ok)).toThrow(/already loaded/);
  });
});

describe('runControl', () => {
  const base = {
    apiVersion: 1,
    name: 'X',
    stages: [{ id: 'a', label: 'A' }],
    annotate: () => null,
  };
  // A fake tool: echoes its arguments and stdin as the last stdout line, after a noise line
  const ECHO = [
    process.execPath,
    '-e',
    "let d='';process.stdin.on('data',(c)=>(d+=c));process.stdin.on('end',()=>" +
      "console.log('working...\\n'+JSON.stringify({ok:true,args:process.argv.slice(1),stdin:d})))",
  ];
  const URL = 'https://github.com/acme/site/issues/12';
  const load = () =>
    setProvider({
      ...base,
      control: {
        ops: {
          status: { argv: [...ECHO, 'status'] },
          'settings.set': { argv: [...ECHO, 'set'], input: true },
          'issue.release': { argv: [...ECHO, 'release', '{issue}'] },
          'service.stop': {
            argv: [process.execPath, '-e', "console.log('plain');process.exit(3)"],
          },
        },
      },
    });

  it('404 without provider, without control or for an undeclared op', async () => {
    await expect(runControl('status')).rejects.toMatchObject({ status: 404 });
    setProvider(base);
    await expect(runControl('status')).rejects.toMatchObject({ status: 404 });
    setProvider(null);
    load();
    await expect(runControl('session.end')).rejects.toMatchObject({ status: 404 });
    await expect(runControl('constructor')).rejects.toMatchObject({ status: 404 });
  });

  it('runs the declared argv; stdin closed and empty without input; data is the last line', async () => {
    load();
    expect(await runControl('status')).toEqual({
      code: 0,
      data: { ok: true, args: ['status'], stdin: '' },
      stderr: '',
    });
  });

  it('fills {issue} with a checked URL only', async () => {
    load();
    const r = await runControl('issue.release', { issue: URL });
    expect(r.data.args).toEqual(['release', URL]);
    for (const issue of [undefined, 'https://github.com/acme/site/pull/12', `${URL} --all`]) {
      await expect(runControl('issue.release', { issue })).rejects.toMatchObject({ status: 400 });
    }
    await expect(runControl('status', { issue: URL })).rejects.toMatchObject({ status: 400 });
  });

  it('passes input as JSON on stdin, only for input ops, at most 16 KB', async () => {
    load();
    const r = await runControl('settings.set', { input: { values: { 'a.b': 4 } } });
    expect(JSON.parse(r.data.stdin)).toEqual({ values: { 'a.b': 4 } });
    expect(r.data.args).toEqual(['set']);
    await expect(runControl('status', { input: {} })).rejects.toMatchObject({ status: 400 });
    await expect(
      runControl('settings.set', { input: { v: 'x'.repeat(16 * 1024) } })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('an unparsable last line gives data null with the exit code', async () => {
    load();
    expect(await runControl('service.stop')).toEqual({ code: 3, data: null, stderr: '' });
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
