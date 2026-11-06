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

let provider = null;

const fail = (msg) => {
  throw new Error(`workflow: ${msg}`);
};
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isFn = (v) => typeof v === 'function';

function checkControl(c, where) {
  if (!c || !isStr(c.label) || !isStr(c.text)) fail(`${where} needs label and text`);
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
  for (const [name, argv] of Object.entries(wf.commands ?? {})) {
    if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) {
      fail(`commands.${name} must be a non-empty string array`);
    }
    for (const a of argv) {
      for (const [, p] of a.matchAll(PLACEHOLDER)) {
        if (!ALLOWED_PLACEHOLDERS.has(p)) fail(`commands.${name}: unknown placeholder {${p}}`);
      }
    }
    if (PLACEHOLDER.test(argv[0]))
      fail(`commands.${name}: the command itself takes no placeholder`);
    PLACEHOLDER.lastIndex = 0;
  }
  return wf;
}

/** Registers the provider of a loaded module; a second one is refused */
export function setProvider(wf) {
  if (provider && wf) fail(`a provider is already loaded (${provider.name})`);
  provider = wf ? validateProvider(wf) : null;
}

export const getProvider = () => provider;

/** What the client and modules learn about the provider (no functions, no commands) */
export function providerInfo() {
  if (!provider) return null;
  const { name, apiVersion, stages, controls = null, sessionName = null } = provider;
  return { name, apiVersion, stages, controls, sessionName };
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
    const plain = { ...item, comments };
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

/** Starts or wakes the issue now through the provider; the URL comes from the client */
export async function startIssue(url) {
  if (typeof url !== 'string' || !ISSUE_URL_RE.test(url)) {
    throw Object.assign(new Error('Keine GitHub-Issue-URL'), { status: 400 });
  }
  if (!provider?.start) throw notFound('Kein Workflow-Provider mit Start geladen');
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
      body: { error: 'Dieses GO ist nicht (mehr) offen', state: ctx.item.workflow?.state ?? null },
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
