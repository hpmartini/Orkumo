#!/usr/bin/env node
/**
 * Cross-check of server/services/usageService.js against a naive full scan.
 * The scan below shares no parsing code with the service: every line of every file is
 * JSON-parsed (no prefilter, no mtime skip, no cache). Only the provider list is imported.
 *
 * Usage: node scripts/verify-usage.mjs [--days 30] [--exclude-today]
 *   --exclude-today  skip today's rows on both sides (live sessions keep writing during the scan)
 * Exit 1 if any provider/day differs.
 */
import fs from 'fs';
import path from 'path';
import { getUsage, defaultSources } from '../server/services/usageService.js';

const argv = process.argv.slice(2);
const days = Number(argv[argv.indexOf('--days') + 1]) || 7;
const excludeToday = argv.includes('--exclude-today');

const ymd = (ms) => new Date(ms).toLocaleDateString('sv-SE'); // local YYYY-MM-DD
const start = new Date();
start.setDate(start.getDate() - days + 1);
const firstDay = ymd(start.getTime());
const today = ymd(Date.now());
const inWindow = (d) => d >= firstDay && d <= today && !(excludeToday && d === today);

function walk(dir, keep, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

async function* lines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // deleted mid-scan (worktree cleanup)
  }
  for (const l of text.split('\n')) {
    try {
      yield JSON.parse(l);
    } catch {
      /* skip */
    }
  }
}

const sum = (u) => u.input + u.output + u.cacheRead + u.cacheWrite;

async function scanClaude(dir, stats) {
  const best = new Map();
  for (const file of walk(path.join(dir, 'projects'), (n) => n.endsWith('.jsonl'))) {
    for await (const o of lines(file)) {
      if (o?.type !== 'assistant' || !o.message?.usage || o.message.model === '<synthetic>') continue;
      const u = o.message.usage;
      const rec = {
        at: Date.parse(o.timestamp),
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
      };
      const key = o.message.id ? o.message.id + ':' + o.requestId : 'uuid:' + o.uuid;
      const old = best.get(key);
      if (old) {
        stats.dupes++;
        if (old.output !== rec.output || old.input !== rec.input) stats.differingDupes++;
      }
      if (!old) {
        best.set(key, rec);
        continue;
      }
      // counts: largest output (earliest on a tie); day: earliest copy
      const better = rec.output > old.output || (rec.output === old.output && rec.at < old.at);
      best.set(key, { ...(better ? rec : old), at: Math.min(rec.at, old.at) });
    }
  }
  const perDay = new Map();
  for (const r of best.values()) {
    const day = ymd(r.at);
    if (inWindow(day)) perDay.set(day, (perDay.get(day) || 0) + sum(r));
  }
  return perDay;
}

async function scanCodex(dir, stats) {
  const perDay = new Map();
  const files = [
    ...walk(path.join(dir, 'sessions'), (n) => /^rollout-.*\.jsonl$/.test(n)),
    ...walk(path.join(dir, 'archived_sessions'), (n) => /^rollout-.*\.jsonl$/.test(n)),
  ];
  for (const file of files) {
    let prevTotal = null;
    for await (const o of lines(file)) {
      if (o?.type !== 'event_msg' || o.payload?.type !== 'token_count') continue;
      const info = o.payload.info;
      if (!info?.total_token_usage) continue;
      const t = info.total_token_usage;
      let d;
      if (prevTotal === null) {
        const l = info.last_token_usage;
        const resumed = l && l.total_tokens < t.total_tokens;
        if (resumed) stats.resumed++;
        d = resumed ? { ...l } : { ...t };
      } else {
        d = {};
        for (const k in t) d[k] = t[k] - (prevTotal[k] || 0);
      }
      prevTotal = t;
      if (!(d.total_tokens > 0)) continue;
      // input already contains cached tokens; output is billed separately
      const tokens = (d.input_tokens || 0) + (d.cache_write_input_tokens || 0) + (d.output_tokens || 0);
      const day = ymd(Date.parse(o.timestamp));
      if (inWindow(day)) perDay.set(day, (perDay.get(day) || 0) + tokens);
    }
  }
  return perDay;
}

const t0 = Date.now();
const sources = defaultSources();
const script = {};
const stats = {};
for (const s of sources) {
  stats[s.id] = { dupes: 0, differingDupes: 0, resumed: 0 };
  script[s.id] = s.kind === 'claude' ? await scanClaude(s.dir, stats[s.id]) : await scanCodex(s.dir, stats[s.id]);
}
const scanMs = Date.now() - t0;
const service = await getUsage({ days });

let bad = 0;
for (const p of service.providers) {
  const svc = new Map();
  for (const r of p.daily) if (inWindow(r.date)) svc.set(r.date, (svc.get(r.date) || 0) + sum(r));
  const mine = script[p.id] || new Map();
  const daysAll = [...new Set([...svc.keys(), ...mine.keys()])].sort();
  console.log(`\n## ${p.label} (${p.id})  ${JSON.stringify(stats[p.id])}`);
  console.log('date        script          service         diff');
  let ts = 0;
  let tv = 0;
  for (const d of daysAll) {
    const a = mine.get(d) || 0;
    const b = svc.get(d) || 0;
    ts += a;
    tv += b;
    if (a !== b) bad++;
    console.log(`${d}  ${String(a).padStart(14)}  ${String(b).padStart(14)}  ${String(a - b).padStart(8)}`);
  }
  console.log(`TOTAL       ${String(ts).padStart(14)}  ${String(tv).padStart(14)}  ${String(ts - tv).padStart(8)}`);
}
console.log(`\nwindow ${firstDay}..${today}${excludeToday ? ' (today excluded)' : ''}, scan ${scanMs} ms, mismatching rows: ${bad}`);
process.exit(bad ? 1 : 0);
