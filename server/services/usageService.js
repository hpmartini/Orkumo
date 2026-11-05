/**
 * Local token usage per subscription (Claude Code, MiniMax via Claude Code, Codex accounts).
 * Reads local transcripts and rate-limit snapshots. The only network call is Claude's plan
 * limits from the endpoint Claude Code itself uses with the subscription login - no API key.
 */
/* global AbortSignal */
import { execFile } from 'child_process';
import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const MAX_DAYS = 90;
const FIVE_HOUR_MIN = 300;
const WEEK_MIN = 10080;
const PARSE_CONCURRENCY = 16;
const NL = 10;
const fileCache = new Map(); // path -> { mtimeMs, size, kind, result }

const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** YYYY-MM-DD in the server's local time zone. */
export function localDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of the first day of a `days`-long window ending today. */
export function windowStart(now, days) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

/** Parse `Label=path,Label=path` into codex sources. */
export function parseCodexHomes(spec) {
  return String(spec || '')
    .split(',')
    .map((part) => part.split('='))
    .filter(([label, dir]) => label?.trim() && dir?.trim())
    .map(([label, dir]) => ({
      id: slug(label.trim()),
      label: label.trim(),
      kind: 'codex',
      dir: expandHome(dir.trim()),
    }));
}

export function defaultSources(env = process.env) {
  const home = os.homedir();
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return [
    {
      id: 'claude',
      label: 'Claude Code',
      kind: 'claude',
      dir: claudeDir,
      limitsFile: path.join(claudeDir, 'devorbit-rate-limits.json'),
      oauth: true,
      // Claude Code keeps .claude.json next to a custom config dir, else in $HOME.
      claudeJson: env.CLAUDE_CONFIG_DIR
        ? path.join(claudeDir, '.claude.json')
        : path.join(home, '.claude.json'),
    },
    {
      id: 'minimax',
      label: 'MiniMax',
      kind: 'claude',
      dir: env.MARTINI_MINIMAX_CONFIG_DIR || path.join(home, '.claude-minimax'),
    },
    ...parseCodexHomes(env.DEVORBIT_CODEX_HOMES || 'Codex A=~/.codex,Codex B=~/.codex-b'),
  ];
}

async function listFiles(root, match) {
  try {
    const names = await fsp.readdir(root, { recursive: true });
    return names.filter((n) => match(path.basename(n))).map((n) => path.join(root, n));
  } catch {
    return [];
  }
}

// Transcripts are GBs of tool output; JSON.parse only lines that can carry usage.
// Scans raw buffers (no per-line string decoding), in file order, streaming 1 MB chunks.
async function forEachJsonLine(file, wanted, fn) {
  const needles = wanted.map((w) => Buffer.from(w));
  let carry = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const complete = buf.lastIndexOf(NL) + 1;
    scanLines(buf.subarray(0, complete), needles, fn);
    carry = Buffer.from(buf.subarray(complete));
  }
  scanLines(carry, needles, fn);
}

function scanLines(buf, needles, fn) {
  let pos = 0;
  const next = needles.map(() => -2); // per-needle next hit; -1 = none left
  while (pos < buf.length) {
    let hit = -1;
    needles.forEach((n, k) => {
      if (next[k] !== -1 && next[k] < pos) next[k] = buf.indexOf(n, pos);
      if (next[k] !== -1 && (hit === -1 || next[k] < hit)) hit = next[k];
    });
    if (hit === -1) return;
    const start = buf.lastIndexOf(NL, hit) + 1;
    let end = buf.indexOf(NL, hit);
    if (end === -1) end = buf.length;
    try {
      fn(JSON.parse(buf.toString('utf8', start, end)));
    } catch {
      /* malformed line - skip */
    }
    pos = end + 1;
  }
}

/** Claude transcript -> { entries: Map(dedupeKey -> entry), meta }; whole file, window applied later. */
export async function parseClaudeFile(file) {
  const entries = new Map();
  const meta = { cwd: null, title: null, branch: null };
  await forEachJsonLine(file, ['"usage"', '"customTitle"'], (o) => {
    if (o?.type === 'custom-title' && o.customTitle) meta.title = o.customTitle;
    if (o?.cwd && !meta.cwd) meta.cwd = o.cwd;
    if (o?.gitBranch) meta.branch = o.gitBranch;
    const msg = o?.message;
    const u = msg?.usage;
    if (o.type !== 'assistant' || !u || msg.model === '<synthetic>') return;
    const ms = Date.parse(o.timestamp);
    if (!Number.isFinite(ms)) return;
    const key = msg.id ? `${msg.id}:${o.requestId}` : `uuid:${o.uuid}`;
    const entry = {
      ms,
      date: localDate(ms),
      model: msg.model || 'unknown',
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
    };
    entries.set(key, pickEntry(entries.get(key), entry));
  });
  return { entries, meta };
}

// Streaming rewrites a message with growing output: tokens from the most complete copy,
// date from the earliest copy (re-written copies can cross midnight), so merge order never matters.
function pickEntry(a, b) {
  if (!a) return b;
  const tokens = b.output > a.output || (b.output === a.output && b.ms < a.ms) ? b : a;
  const first = b.ms < a.ms ? b : a;
  return tokens === first ? first : { ...tokens, ms: first.ms, date: first.date };
}

// `resetCounts`: the source sees every use (Codex writes a snapshot on each turn), so a window
// past its reset with no newer snapshot really is at 0 %. Claude's caches lag, so there it is unknown.
function rateWindow(raw, now, resetCounts = false) {
  if (!raw) return null;
  const expired = raw.resetsAt != null && raw.resetsAt < now;
  const extra = raw.windowMinutes ? { windowMinutes: raw.windowMinutes } : {};
  if (expired && resetCounts) return { usedPercent: 0, resetsAt: null, reset: true, ...extra };
  return { usedPercent: expired ? null : raw.usedPercent, resetsAt: raw.resetsAt, ...extra };
}

/** Codex rollout -> { rows: Map(date|model -> tokens), limits: latest rate_limits snapshot }. */
export async function parseCodexFile(file) {
  const rows = new Map();
  let model = 'unknown';
  let prev = null;
  let limits = null;
  const meta = { cwd: null, title: null, branch: null, firstMs: null, lastMs: null };
  await forEachJsonLine(file, ['"token_count"', '"turn_context"', '"session_meta"'], (o) => {
    const p = o?.payload;
    if (o.type === 'session_meta') {
      if (p?.model && model === 'unknown') model = p.model;
      meta.cwd ??= p?.cwd ?? null;
      meta.branch ??= p?.git?.branch ?? null;
    }
    if (o.type === 'turn_context' && p?.model) model = p.model;
    if (o.type !== 'event_msg' || p?.type !== 'token_count') return;
    const ms = Date.parse(o.timestamp);
    if (p.rate_limits && Number.isFinite(ms)) limits = { asOf: ms, raw: p.rate_limits };
    const total = p.info?.total_token_usage;
    if (!total || !Number.isFinite(ms)) return;
    meta.firstMs ??= ms;
    meta.lastMs = ms;
    let delta;
    if (prev) {
      delta = diffUsage(total, prev);
    } else {
      const last = p.info.last_token_usage;
      // Resumed session: the first total already holds the history from an older rollout.
      delta = last?.total_tokens < total.total_tokens ? last : total;
    }
    prev = total;
    if ((delta.total_tokens || 0) <= 0) return;
    const key = `${localDate(ms)}|${model}`;
    const row = rows.get(key) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const cached = delta.cached_input_tokens || 0;
    row.input += (delta.input_tokens || 0) - cached;
    row.cacheRead += cached;
    row.cacheWrite += delta.cache_write_input_tokens || 0;
    row.output += delta.output_tokens || 0;
    rows.set(key, row);
  });
  return { rows, limits, meta };
}

function diffUsage(cur, prev) {
  const out = {};
  for (const k of Object.keys(cur)) out[k] = (cur[k] || 0) - (prev[k] || 0);
  return out;
}

export function codexLimits(snapshot, now) {
  if (!snapshot) return null;
  const { raw, asOf } = snapshot;
  const windows = [raw.primary, raw.secondary].filter(Boolean);
  const toWindow = (w) =>
    w && {
      usedPercent: w.used_percent ?? null,
      resetsAt: w.resets_at != null ? w.resets_at * 1000 : null,
      windowMinutes: w.window_minutes,
    };
  return {
    fiveHour: rateWindow(
      toWindow(windows.find((w) => w.window_minutes === FIVE_HOUR_MIN)),
      now,
      true
    ),
    weekly: rateWindow(toWindow(windows.find((w) => w.window_minutes === WEEK_MIN)), now, true),
    source: 'rollout',
    asOf,
    ...(raw.plan_type ? { plan: raw.plan_type } : {}),
  };
}

// resets_at arrives as epoch seconds, epoch ms or ISO string depending on the source.
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

const execFileP = promisify(execFile);
const OAUTH_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_FRESH_MS = 60 * 60 * 1000;
let oauthMemo = { at: 0, value: null };

/** Claude Code's subscription login: macOS keychain, else the credentials file. Never logged. */
export async function readClaudeOauth(claudeDir) {
  let raw;
  // A custom config dir has its own keychain entry (hashed suffix); only its credentials file is safe to read.
  if (process.platform === 'darwin' && !process.env.CLAUDE_CONFIG_DIR) {
    try {
      ({ stdout: raw } = await execFileP(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 5000 }
      ));
    } catch {
      /* not in the keychain - try the file */
    }
  }
  raw ??= await fsp.readFile(path.join(claudeDir, '.credentials.json'), 'utf8').catch(() => null);
  try {
    return JSON.parse(raw)?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

/** Live limits from the endpoint Claude Code's /usage calls with the subscription login (no API key). */
export async function claudeOauthLimits(
  source,
  now,
  { readOauth = readClaudeOauth, fetchFn = fetch } = {}
) {
  const oauth = await readOauth(source.dir);
  // shortcut: an expired token is not refreshed here (would rotate Claude Code's own login); Claude Code refreshes it on its next run
  if (!oauth?.accessToken || (oauth.expiresAt && oauth.expiresAt < now)) return null;
  const res = await fetchFn('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  // Neither window present = unknown response shape, not "no 5h plan": let the other sources answer.
  if (!body?.five_hour && !body?.seven_day) return null;
  const win = (w, minutes) =>
    w
      ? rateWindow(
          {
            usedPercent: w.utilization ?? null,
            resetsAt: toMs(w.resets_at),
            windowMinutes: minutes,
          },
          now
        )
      : null;
  return {
    fiveHour: win(body.five_hour, FIVE_HOUR_MIN),
    weekly: win(body.seven_day, WEEK_MIN),
    source: 'oauth',
    asOf: now,
    ...(oauth.subscriptionType ? { plan: oauth.subscriptionType } : {}),
  };
}

async function cachedOauthLimits(source, now) {
  if (now - oauthMemo.at < OAUTH_TTL_MS) return oauthMemo.value;
  const value = await claudeOauthLimits(source, now).catch(() => null);
  oauthMemo = { at: now, value };
  return value;
}

export async function claudeLimits(source, now) {
  const readJson = async (f) => JSON.parse(await fsp.readFile(f, 'utf8'));
  let snapshot = null;
  if (source.limitsFile) {
    try {
      const snap = await readJson(source.limitsFile);
      const rl = snap.rate_limits || {};
      const win = (w, minutes) =>
        w
          ? rateWindow(
              {
                usedPercent: w.used_percentage ?? null,
                resetsAt: toMs(w.resets_at),
                windowMinutes: minutes,
              },
              now
            )
          : null;
      snapshot = {
        fiveHour: win(rl.five_hour, FIVE_HOUR_MIN),
        weekly: win(rl.seven_day, WEEK_MIN),
        source: 'statusline',
        asOf: snap.capturedAt ?? null,
      };
    } catch {
      /* no snapshot - fall back to the endpoint or Claude Code's own cache */
    }
  }
  if (snapshot && now - (snapshot.asOf ?? 0) < SNAPSHOT_FRESH_MS) return snapshot;
  if (source.oauth) {
    const live = await cachedOauthLimits(source, now);
    if (live) return live;
  }
  if (snapshot) return snapshot;
  if (source.claudeJson) {
    try {
      const [json, stat] = await Promise.all([
        readJson(source.claudeJson),
        fsp.stat(source.claudeJson),
      ]);
      const util = json.cachedUsageUtilization?.utilization;
      if (util) {
        const win = (w, minutes) =>
          w
            ? rateWindow(
                {
                  usedPercent: w.utilization ?? null,
                  resetsAt: toMs(w.resets_at),
                  windowMinutes: minutes,
                },
                now
              )
            : null;
        return {
          fiveHour: win(util.five_hour, FIVE_HOUR_MIN),
          weekly: win(util.seven_day, WEEK_MIN),
          source: 'claude-cache',
          asOf: json.cachedUsageUtilization.fetchedAtMs ?? stat.mtimeMs,
        };
      }
    } catch {
      /* unreadable or missing */
    }
  }
  return null;
}

/** Parse each file once per mtime+size; returns [{ file, mtimeMs, result }]. */
async function parseCached(files, since, parse) {
  const out = [];
  await mapLimit(files, PARSE_CONCURRENCY, async (file) => {
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return;
    }
    // A file last written before the window cannot hold lines inside it.
    if (st.mtimeMs < since) return;
    const hit = fileCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      out.push({ file, mtimeMs: st.mtimeMs, result: hit.result });
      return;
    }
    try {
      const result = await parse(file);
      fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, result });
      out.push({ file, mtimeMs: st.mtimeMs, result });
    } catch {
      /* unreadable file - skip */
    }
  });
  return out;
}

async function newestFile(files) {
  let best = null;
  await mapLimit(files, PARSE_CONCURRENCY, async (file) => {
    try {
      const { mtimeMs } = await fsp.stat(file);
      if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
    } catch {
      /* vanished */
    }
  });
  return best?.file;
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const emptyTotals = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function addRow(daily, date, model, t) {
  const key = `${date}|${model}`;
  const row = daily.get(key) || { date, model, ...emptyTotals() };
  row.input += t.input;
  row.output += t.output;
  row.cacheRead += t.cacheRead;
  row.cacheWrite += t.cacheWrite;
  daily.set(key, row);
}

async function providerUsage(source, { since, firstDate, now }) {
  const available = fs.existsSync(source.dir);
  const daily = new Map();
  let limits = null;

  if (source.kind === 'claude') {
    const files = await listFiles(path.join(source.dir, 'projects'), (n) => n.endsWith('.jsonl'));
    const parsed = await parseCached(files, since, parseClaudeFile);
    const merged = new Map();
    for (const { result } of parsed)
      for (const [key, e] of result.entries) merged.set(key, pickEntry(merged.get(key), e));
    for (const e of merged.values()) if (e.date >= firstDate) addRow(daily, e.date, e.model, e);
    limits = await claudeLimits(source, now);
  } else {
    const isRollout = (n) => n.startsWith('rollout-') && n.endsWith('.jsonl');
    const files = [
      ...(await listFiles(path.join(source.dir, 'sessions'), isRollout)),
      ...(await listFiles(path.join(source.dir, 'archived_sessions'), isRollout)),
    ];
    const parsed = await parseCached(files, since, parseCodexFile);
    for (const { result } of parsed)
      for (const [key, t] of result.rows) {
        const [date, model] = key.split('|');
        if (date >= firstDate) addRow(daily, date, model, t);
      }
    let newest = parsed.filter((p) => p.result.limits).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    // Idle account: no rollout in the window, but its last snapshot still says where it stands.
    if (!newest) newest = (await parseCached([await newestFile(files)], 0, parseCodexFile))[0];
    limits = codexLimits(newest?.result.limits, now);
  }

  const rows = [...daily.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)
  );
  const totals = rows.reduce((t, r) => {
    t.input += r.input;
    t.output += r.output;
    t.cacheRead += r.cacheRead;
    t.cacheWrite += r.cacheWrite;
    return t;
  }, emptyTotals());
  totals.total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  const promptSide = totals.input + totals.cacheRead + totals.cacheWrite;
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    available,
    limits,
    totals,
    cacheHitRate: promptSide ? totals.cacheRead / promptSide : null,
    daily: rows,
  };
}

/** Aggregated usage for the last `days` days (today inclusive). */
export async function getUsage({ days = 7, now = Date.now(), sources } = {}) {
  const since = windowStart(now, days);
  const ctx = { since, firstDate: localDate(since), now };
  const providers = await Promise.all(
    (sources || defaultSources()).map((s) => providerUsage(s, ctx))
  );
  return { generatedAt: now, days, providers };
}

const tokenSum = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** One session row: tokens over the whole transcript, duration = first to last usage line. */
export function sessionRow(source, file, meta, parts) {
  return {
    id: `${source.id}:${path.basename(file, '.jsonl')}`,
    providerId: source.id,
    provider: source.label,
    title: meta.title,
    cwd: meta.cwd,
    branch: meta.branch,
    firstMs: meta.firstMs,
    lastMs: meta.lastMs,
    tokens: parts.reduce((n, t) => n + tokenSum(t), 0),
  };
}

/** Sessions with activity in the last `days` days, all providers (#184 sessions card). */
export async function getSessions({ days = 7, now = Date.now(), sources } = {}) {
  const since = windowStart(now, days);
  const perSource = await Promise.all(
    (sources || defaultSources()).map(async (source) => {
      if (source.kind === 'claude') {
        // Subagent transcripts are part of their parent session, not sessions of their own.
        const files = (
          await listFiles(path.join(source.dir, 'projects'), (n) => n.endsWith('.jsonl'))
        ).filter((f) => !f.split(path.sep).includes('subagents'));
        return (await parseCached(files, since, parseClaudeFile))
          .filter(({ result }) => result.entries.size)
          .map(({ file, result }) => {
            const list = [...result.entries.values()];
            // reduce, not Math.min(...): spread overflows the stack on huge transcripts
            const firstMs = list.reduce((m, e) => Math.min(m, e.ms), Infinity);
            const lastMs = list.reduce((m, e) => Math.max(m, e.ms), -Infinity);
            const meta = { ...result.meta, firstMs, lastMs };
            return sessionRow(source, file, meta, list);
          });
      }
      const isRollout = (n) => n.startsWith('rollout-') && n.endsWith('.jsonl');
      const files = [
        ...(await listFiles(path.join(source.dir, 'sessions'), isRollout)),
        ...(await listFiles(path.join(source.dir, 'archived_sessions'), isRollout)),
      ];
      return (await parseCached(files, since, parseCodexFile))
        .filter(({ result }) => result.meta.lastMs != null)
        .map(({ file, result }) =>
          sessionRow(source, file, result.meta, [...result.rows.values()])
        );
    })
  );
  const sessions = perSource.flat().filter((s) => s.lastMs >= since);
  return { generatedAt: now, days, sessions };
}

export const usageRouter = express.Router();

const withDays = (load) => async (req, res) => {
  const raw = req.query.days ?? '7';
  const days = Number(raw);
  if (!/^\d+$/.test(String(raw)) || days < 1 || days > MAX_DAYS) {
    return res.status(400).json({ error: `days must be an integer between 1 and ${MAX_DAYS}` });
  }
  try {
    res.json(await load({ days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

usageRouter.get('/', withDays(getUsage));
usageRouter.get('/sessions', withDays(getSessions));
