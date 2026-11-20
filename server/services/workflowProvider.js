/**
 * The workflow provider (docs/WORKFLOW_PROVIDER.md): at most one module declares `workflow`; the
 * host validates it, annotates board items with it and runs its declared host commands. Orkumo
 * knows no workflow tool itself; without a provider every item has `workflow: null`.
 */
import { runOnHost } from './agentService.js';
import { ISSUE_URL_RE } from '../../utils/issueUrl.js';

export const API_VERSION = 1;
const WAITING = new Set(['owner', 'agent', 'poll', null]);
const PLACEHOLDER = /\{(\w+)\}/g;
const ALLOWED_PLACEHOLDERS = new Set(['issue', 'uid']);
/** Operations a provider may declare under `control.ops` (docs/WORKFLOW_PROVIDER.md, "control") */
export const CONTROL_OPS = new Set([
  'status',
  'settings.get',
  'settings.set',
  'service.start',
  'service.stop',
  'issue.release',
  'issue.start',
  'issue.add',
  'session.end',
]);
const OPTION_KEY = /^[a-z][a-zA-Z0-9_-]{0,31}$/;
export const MAX_CONTROL_INPUT = 16 * 1024;
const CONTROL_TIMEOUT_MS = 60_000;

let provider = null;

const fail = (msg) => {
  throw new Error(`workflow: ${msg}`);
};
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isFn = (v) => typeof v === 'function';

function checkControl(c, where) {
  if (!c || !isStr(c.label) || !isStr(c.text)) fail(`${where} needs label and text`);
}

/** argv template of `commands` or `control.ops`: strings, known placeholders, {issue} whole */
function checkArgv(argv, where) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) {
    fail(`${where} must be a non-empty string array`);
  }
  for (const a of argv) {
    for (const [, p] of a.matchAll(PLACEHOLDER)) {
      if (!ALLOWED_PLACEHOLDERS.has(p)) fail(`${where}: unknown placeholder {${p}}`);
    }
    // pty-host matches the URL only as a whole argument (pty-host/execPolicy.js)
    if (a.includes('{issue}') && a !== '{issue}')
      fail(`${where}: {issue} must be a whole argument`);
  }
  // not PLACEHOLDER.test: a global regex keeps lastIndex across calls when this throws
  if (/\{\w+\}/.test(argv[0])) fail(`${where}: the command itself takes no placeholder`);
}

const isOptStr = (v) => v === undefined || isStr(v);

function checkControlOps(control) {
  if (!control || typeof control !== 'object') fail('control must be an object');
  const { ops } = control;
  if (!ops || typeof ops !== 'object' || Array.isArray(ops)) fail('control.ops must be an object');
  for (const [name, op] of Object.entries(ops)) {
    const where = `control.ops.${name}`;
    if (!CONTROL_OPS.has(name)) fail(`unknown control op "${name}"`);
    if (!op || typeof op !== 'object') fail(`${where} must be an object`);
    checkArgv(op.argv, `${where}.argv`);
    if (op.input !== undefined && typeof op.input !== 'boolean') {
      fail(`${where}.input must be a boolean`);
    }
    if (!isOptStr(op.label) || !isOptStr(op.hint)) fail(`${where}: label and hint must be strings`);
    if (op.options === undefined) continue;
    if (!Array.isArray(op.options)) fail(`${where}.options must be an array`);
    const keys = op.options.map((o) => o?.key);
    for (const o of op.options) {
      if (!o || typeof o.key !== 'string' || !OPTION_KEY.test(o.key)) {
        fail(`${where}.options[].key must match ${OPTION_KEY}`);
      }
      if (!isStr(o.label) || !isOptStr(o.hint)) {
        fail(`${where}.options[] needs a label (hint optional)`);
      }
    }
    if (new Set(keys).size !== keys.length) fail(`${where}.options keys must be unique`);
  }
}

/** Throws with the first contract violation of a module's `workflow` declaration */
export function validateProvider(wf) {
  if (!wf || typeof wf !== 'object') fail('must be an object');
  if (wf.apiVersion !== API_VERSION) {
    fail(`apiVersion ${JSON.stringify(wf.apiVersion)} not supported (host speaks ${API_VERSION})`);
  }
  if (!isStr(wf.name)) fail('name must be a string');
  if (!Array.isArray(wf.stages) || !wf.stages.length) fail('stages must be a non-empty array');
  const ids = wf.stages.map((s) => s?.id);
  if (ids.some((id) => !isStr(id)) || new Set(ids).size !== ids.length) {
    fail('stage ids must be unique strings');
  }
  if (wf.stages.some((s) => !isStr(s.label))) fail('every stage needs a label');
  if (!isFn(wf.annotate)) fail('annotate must be a function');
  for (const k of ['start', 'go'])
    if (wf[k] !== undefined && !isFn(wf[k])) fail(`${k} must be a function`);
  if (wf.sessionName !== undefined) {
    if (typeof wf.sessionName !== 'string') fail('sessionName must be a regex source string');
    new RegExp(wf.sessionName); // throws on an invalid pattern
  }
  const c = wf.controls;
  if (c !== undefined) {
    if (!c || typeof c !== 'object') fail('controls must be an object');
    (c.toggles ?? []).forEach((t) => checkControl(t, 'controls.toggles[]'));
    (c.feedback ?? []).forEach((t) => checkControl(t, 'controls.feedback[]'));
    if (c.start) checkControl(c.start, 'controls.start');
    if (c.waiting) checkControl(c.waiting, 'controls.waiting');
    if (c.modes && !Array.isArray(c.modes.options)) fail('controls.modes.options must be an array');
  }
  for (const [name, argv] of Object.entries(wf.commands ?? {})) checkArgv(argv, `commands.${name}`);
  if (wf.control !== undefined) checkControlOps(wf.control);
  return wf;
}

/** Registers the provider of a loaded module; a second one is refused */
export function setProvider(wf) {
  if (provider && wf) fail(`a provider is already loaded (${provider.name})`);
  provider = wf ? validateProvider(wf) : null;
}

export const getProvider = () => provider;

/** What the client learns about the provider (no functions, no commands): GET /api/workflow */
export function providerInfo() {
  if (!provider) return null;
  const { name, apiVersion, stages, controls = null, sessionName = null } = provider;
  return { name, apiVersion, stages, controls, sessionName };
}

/** What modules learn (ctx.services.workflow.provider()): providerInfo plus `control` without argv */
export function moduleProviderInfo() {
  const info = providerInfo();
  return info && { ...info, control: controlInfo() };
}

/** `control` without argv: what a UI needs to label its buttons */
function controlInfo() {
  if (!provider.control) return null;
  const ops = {};
  for (const [name, { label, hint, input, options }] of Object.entries(provider.control.ops)) {
    ops[name] = {
      ...(label !== undefined && { label }),
      ...(hint !== undefined && { hint }),
      ...(input === true && { input: true }),
      ...(options !== undefined && {
        options: options.map(({ key, label: l, hint: h }) => ({
          key,
          label: l,
          ...(h && { hint: h }),
        })),
      }),
    };
  }
  return { ops };
}

/** Checks one annotate() result; a broken one is logged and treated as "not a workflow item" */
function checkAnnotation(a) {
  if (a === null || a === undefined) return null;
  const s = a.state;
  if (!s || !provider.stages.some((st) => st.id === s.stage)) fail(`unknown stage ${s?.stage}`);
  if (!WAITING.has(s.waitingOn ?? null)) fail(`invalid waitingOn ${s.waitingOn}`);
  if (typeof s.reason !== 'string') fail('state.reason must be a string');
  if (s.go && (!isStr(s.go.kind) || !isStr(s.go.text))) fail('state.go needs kind and text');
  const sessionIds = Array.isArray(a.sessionIds) ? a.sessionIds.filter(isStr) : [];
  return {
    state: { since: null, go: null, error: null, ...s, waitingOn: s.waitingOn ?? null },
    sessionIds,
  };
}

/**
 * `item.workflow` of one board item. `comments` must already be limited to trusted authors: the
 * host decides whose comments count, never the provider.
 * @param {object} item board item without `workflow`
 * @param {{ body: string, createdAt: string }[]} comments
 * @param {string | null} statusName
 */
export function annotateItem(item, comments, statusName) {
  if (!provider || item.type !== 'Issue') return null;
  try {
    const plain = structuredClone({ ...item, comments }); // provider cannot touch the cached item
    delete plain.workflow;
    return checkAnnotation(provider.annotate(plain, statusName ?? null));
  } catch (error) {
    console.warn(`[workflow] annotate failed for ${item.repo}#${item.number}:`, error.message);
    return null;
  }
}

/** argv of a declared command with {issue} and {uid} filled in */
export function fillCommand(argv, { issue, uid }) {
  return argv.map((a) => a.replace(PLACEHOLDER, (_m, p) => String(p === 'issue' ? issue : uid)));
}

const hostUid = () => process.env.HOST_UID || process.getuid?.() || '';

/** `host` handed to start(): runs a declared command for exactly this issue URL */
function hostFor(url) {
  return {
    async exec(name) {
      const argv = provider.commands?.[name];
      if (!argv) throw new Error(`workflow: no command "${name}" declared`);
      const [command, ...args] = fillCommand(argv, { issue: url, uid: hostUid() });
      return runOnHost(command, args, { timeout: 60_000 });
    },
  };
}

const notFound = (msg) => Object.assign(new Error(msg), { status: 404 });
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Last non-empty stdout line as a JSON object, else null */
function lastJsonLine(stdout) {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  try {
    const data = JSON.parse(line);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Runs control op `op` of the provider (docs/WORKFLOW_PROVIDER.md, "control"). `issue` only fills
 * `{issue}`; `input` goes JSON-serialized to stdin, only for ops declaring `input: true`.
 * @param {string} op
 * @param {{ issue?: string, input?: unknown }} [args]
 * @returns {Promise<{ code: number, data: object | null, stderr: string }>}
 * @throws Error with `.status` 404 (no provider, op not declared) or 400 (bad issue or input)
 */
export async function runControl(op, { issue, input } = {}) {
  const spec = CONTROL_OPS.has(op) ? provider?.control?.ops[op] : undefined;
  if (!spec) throw notFound(`No workflow provider with control op "${op}" loaded`);
  const takesIssue = spec.argv.includes('{issue}');
  if (takesIssue && (typeof issue !== 'string' || !ISSUE_URL_RE.test(issue))) {
    throw badRequest('Not a GitHub issue URL');
  }
  if (!takesIssue && issue !== undefined) throw badRequest(`Control op "${op}" takes no issue`);
  let stdin = '';
  if (input !== undefined) {
    if (spec.input !== true) throw badRequest(`Control op "${op}" takes no input`);
    stdin = JSON.stringify(input);
    if (stdin === undefined) throw badRequest('input must be JSON');
    if (Buffer.byteLength(stdin) > MAX_CONTROL_INPUT) {
      throw badRequest(`input exceeds ${MAX_CONTROL_INPUT} bytes`);
    }
  }
  const [command, ...rest] = fillCommand(spec.argv, { issue, uid: hostUid() });
  // stdin is closed right away without input, so a tool reading it never waits
  const { code, stdout, stderr } = await runOnHost(command, rest, {
    timeout: CONTROL_TIMEOUT_MS,
    input: stdin,
  });
  return { code, data: lastJsonLine(stdout), stderr };
}

/** Starts or wakes the issue now through the provider; the URL comes from the client */
export async function startIssue(url) {
  if (typeof url !== 'string' || !ISSUE_URL_RE.test(url)) {
    throw Object.assign(new Error('Not a GitHub issue URL'), { status: 400 });
  }
  if (!provider?.start) throw notFound('No workflow provider with start loaded');
  return provider.start(url, hostFor(url));
}

/**
 * Applies `go` if it is exactly the GO the fresh state `ctx` offers; `{ status, body }` for the route.
 * @param {{ source: unknown, item: { itemId: string, url: string, labels: { name: string }[], workflow: any } }} ctx
 * @param {{ kind: string }} go
 * @param {{ updateIssue: (source: unknown, itemId: string, patch: { labels: string[] }) => Promise<unknown> }} deps
 */
export async function applyGo(ctx, go, { updateIssue }) {
  const offered = ctx.item.workflow?.state.go;
  if (!provider || !offered || offered.kind !== go?.kind) {
    return {
      status: 409,
      body: { error: 'This GO is no longer open', state: ctx.item.workflow?.state ?? null },
    };
  }
  const start = () => startIssue(ctx.item.url);
  const result = provider.go
    ? await provider.go(go.kind, {
        item: ctx.item,
        setLabels: (labels) => updateIssue(ctx.source, ctx.item.itemId, { labels }),
        start,
      })
    : { start: await start() };
  return { status: 200, body: { ok: true, ...result } };
}
