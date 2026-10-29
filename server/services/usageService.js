/**
 * Local token usage per subscription (Claude Code, MiniMax via Claude Code, Codex accounts).
 * Reads only local transcripts and rate-limit snapshots - no API calls, no keys.
 */
import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

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

/** Claude transcript -> Map(dedupeKey -> entry); whole file, window applied later. */
export async function parseClaudeFile(file) {
  const entries = new Map();
  await forEachJsonLine(file, ['"usage"'], (o) => {
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
  return entries;
}

// Streaming rewrites a message with growing output: tokens from the most complete copy,
// date from the earliest copy (re-written copies can cross midnight), so merge order never matters.
function pickEntry(a, b) {
  if (!a) return b;
  const tokens = b.output > a.output || (b.output === a.output && b.ms < a.ms) ? b : a;
  const first = b.ms < a.ms ? b : a;
  return tokens === first ? first : { ...tokens, ms: first.ms, date: first.date };
}

function rateWindow(raw, now) {
  if (!raw) return null;
  return {
    usedPercent: raw.resetsAt != null && raw.resetsAt < now ? null : raw.usedPercent,
    resetsAt: raw.resetsAt,
    ...(raw.windowMinutes ? { windowMinutes: raw.windowMinutes } : {}),
  };
}

/** Codex rollout -> { rows: Map(date|model -> tokens), limits: latest rate_limits snapshot }. */
export async function parseCodexFile(file) {
  const rows = new Map();
  let model = 'unknown';
  let prev = null;
  let limits = null;
  await forEachJsonLine(file, ['"token_count"', '"turn_context"', '"session_meta"'], (o) => {
    const p = o?.payload;
    if (o.type === 'session_meta' && p?.model && model === 'unknown') model = p.model;
    if (o.type === 'turn_context' && p?.model) model = p.model;
    if (o.type !== 'event_msg' || p?.type !== 'token_count') return;
    const ms = Date.parse(o.timestamp);
    if (p.rate_limits && Number.isFinite(ms)) limits = { asOf: ms, raw: p.rate_limits };
    const total = p.info?.total_token_usage;
    if (!total || !Number.isFinite(ms)) return;
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
  return { rows, limits };
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
    fiveHour: rateWindow(toWindow(windows.find((w) => w.window_minutes === FIVE_HOUR_MIN)), now),
    weekly: rateWindow(toWindow(windows.find((w) => w.window_minutes === WEEK_MIN)), now),
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

export async function claudeLimits(source, now) {
  const readJson = async (f) => JSON.parse(await fsp.readFile(f, 'utf8'));
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
      return {
        fiveHour: win(rl.five_hour, FIVE_HOUR_MIN),
        weekly: win(rl.seven_day, WEEK_MIN),
        source: 'statusline',
        asOf: snap.capturedAt ?? null,
      };
    } catch {
      /* no snapshot - fall back to Claude Code's own cache */
    }
  }
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
          asOf: stat.mtimeMs,
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
      for (const [key, e] of result) merged.set(key, pickEntry(merged.get(key), e));
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
    const newest = parsed.filter((p) => p.result.limits).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
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

export const usageRouter = express.Router();

usageRouter.get('/', async (req, res) => {
  const raw = req.query.days ?? '7';
  const days = Number(raw);
  if (!/^\d+$/.test(String(raw)) || days < 1 || days > MAX_DAYS) {
    return res.status(400).json({ error: `days must be an integer between 1 and ${MAX_DAYS}` });
  }
  try {
    res.json(await getUsage({ days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
