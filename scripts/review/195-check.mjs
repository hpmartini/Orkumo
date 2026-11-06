// Review #195: drives a running server (SERVER_PORT, SERVER_PID, PROJECT_DIR) through the real
// paths: settings API (AC-2), /api/pty rejections (AC-3), one start per harness with cwd proof
// (AC-4) and no leftover process after the pane closes (AC-9). Exits non-zero on any failure.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import WebSocket from 'ws';

const { SERVER_PORT, SERVER_PID, PROJECT_DIR } = process.env;
const api = `http://localhost:${SERVER_PORT}/api`;
const PROMPT = 'Reply with OK only. 50% of a check (#195)'; // `%` guards against double decoding
let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** pids of all processes below the given pids */
function descendantsOf(roots) {
  const rows = descendants();
  const out = [];
  const walk = (parent) =>
    rows.filter((r) => r.ppid === parent).forEach((r) => (out.push(r.pid), walk(r.pid)));
  roots.forEach(walk);
  return out;
}

/** All descendants of the server process: [{pid, ppid, command}] */
function descendants() {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid, ppid, command }));
  const out = [];
  const walk = (parent) =>
    rows.filter((r) => r.ppid === parent).forEach((r) => (out.push(r), walk(r.pid)));
  walk(String(SERVER_PID));
  return out;
}
// `/bin/pi …` at spawn, plain `pi` once pi has set its process title
const harnessProcs = (bin) =>
  descendants().filter((p) => new RegExp(`(^|/)${bin}(\\s|$)`).test(p.command));
// pi rewrites its process title, so leftovers are checked by pid, children included
const alive = (pids) => {
  const now = new Map(descendants().map((p) => [p.pid, p]));
  return pids.filter((pid) => now.has(pid));
};
const cwdOf = (pid) =>
  execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
    .split('\n')
    .find((l) => l.startsWith('n'))
    ?.slice(1);

function openPty(command, args, cwd = PROJECT_DIR) {
  const q = new URLSearchParams({
    sessionId: `review-195-${command}-${Date.now()}`,
    cwd,
    cols: '120',
    rows: '30',
    command,
  });
  if (args) q.set('args', JSON.stringify(args));
  const ws = new WebSocket(`ws://localhost:${SERVER_PORT}/api/pty?${q}`);
  const result = { ws, errors: [], output: '', closed: false };
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'error') result.errors.push(msg.message);
      if (msg.type === 'output' || msg.type === 'data') result.output += msg.data ?? '';
    } catch {
      result.output += raw.toString();
    }
  });
  ws.on('close', () => (result.closed = true));
  ws.on('error', (e) => result.errors.push(e.message));
  return result;
}
async function rejected(label, command, args, cwd) {
  const r = openPty(command, args, cwd);
  for (let i = 0; i < 30 && !r.closed; i++) await sleep(100);
  check(r.closed && r.errors.length > 0, `AC-3 ${label} → rejected (${r.errors[0] ?? 'no error'})`);
}

// ---- AC-7 only (`--missing <id>`): the server runs with that CLI hidden
const missingAt = process.argv.indexOf('--missing');
if (missingAt !== -1) {
  const id = process.argv[missingAt + 1];
  const list = await (await fetch(`${api}/agents/harnesses`)).json();
  check(
    list.find((h) => h.id === id)?.installed === false,
    `AC-7 GET /api/agents/harnesses: ${id} installed=false`
  );
  const r = openPty(id, []);
  for (let i = 0; i < 30 && !r.closed; i++) await sleep(100);
  check(
    r.closed && r.errors.some((e) => /not installed/.test(e)),
    `AC-7 start ${id} → "${r.errors[0]}"`
  );
  process.exit(failed ? 1 : 0);
}

// ---- AC-2: default harness setting
const put = (body) =>
  fetch(`${api}/settings/agent-view`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
for (const bad of ['bash', 'Codex', '']) {
  const res = await put({ dispatch: { harness: bad } });
  check(res.status === 400, `AC-2 PUT dispatch.harness=${JSON.stringify(bad)} → ${res.status}`);
}
const ok = await put({ dispatch: { harness: process.env.REVIEW_DEFAULT_HARNESS || 'codex' } });
check(ok.status === 200, `AC-2 PUT dispatch.harness=codex → ${ok.status}`);
const now = await (await fetch(`${api}/settings/agent-view`)).json();
check(now.dispatch?.harness === 'codex', `AC-2 GET dispatch.harness = ${now.dispatch?.harness}`);

// ---- installed CLIs
const harnesses = await (await fetch(`${api}/agents/harnesses`)).json();
console.log('      GET /api/agents/harnesses', JSON.stringify(harnesses));

// ---- AC-3: rejections, nothing spawned
const before = descendants().length;
await rejected('unlisted binary (bash)', 'bash', []);
await rejected('unlisted flag (codex --config x)', 'codex', ['--config', 'x']);
await rejected('prompt without -- (pi "hi")', 'pi', ['hi']);
await rejected('opencode with a prompt', 'opencode', ['--', 'hi']);
await rejected('cwd outside the project dirs (/tmp)', 'omp', [], '/tmp');
await sleep(500);
check(
  descendants().length === before,
  `AC-3 no process spawned by the rejections (${descendants().length} descendants)`
);

// ---- AC-4 + AC-9: each installed harness starts in the project dir, and is gone after close
const project = realpathSync(PROJECT_DIR);
for (const { id, installed } of harnesses) {
  if (id === 'claude') continue;
  if (installed === false) {
    const r = openPty(id, []);
    for (let i = 0; i < 30 && !r.closed; i++) await sleep(100);
    check(
      r.errors.some((e) => /not installed/.test(e)),
      `AC-7 ${id} not installed → "${r.errors[0]}"`
    );
    continue;
  }
  const r = openPty(id, id === 'opencode' ? [] : ['--', PROMPT]);
  let procs = [];
  for (let i = 0; i < 50 && !procs.length; i++) {
    await sleep(200);
    procs = harnessProcs(id);
  }
  const cwd = procs[0] && cwdOf(procs[0].pid);
  check(
    procs.length > 0 && !r.errors.length,
    `AC-4 ${id} running: pid ${procs[0]?.pid ?? '-'} ${r.errors[0] ?? ''}`
  );
  check(cwd === project, `AC-4 ${id} cwd = ${cwd}`);
  if (id !== 'opencode') {
    const argv = procs.map((p) => p.command).join(' | ');
    check(argv.includes(PROMPT), `AC-4 ${id} argv carries the prompt`);
  }
  await sleep(1500); // let the CLI spawn its own children before taking the pid set
  const tracked = [
    ...new Set([...procs.map((p) => p.pid), ...descendantsOf(procs.map((p) => p.pid))]),
  ];
  r.ws.close();
  let left = tracked;
  for (let i = 0; i < 50 && left.length; i++) {
    await sleep(200);
    left = alive(tracked);
  }
  check(left.length === 0, `AC-9 ${id} after pane close: ${left.length} process(es) left`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
