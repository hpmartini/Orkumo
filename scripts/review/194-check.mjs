#!/usr/bin/env node
// #194 AC-4: compare the API's "working" agents with an independent count from the job files:
// tempo "active" and transcript written within the last WINDOW_MIN minutes.
// Usage: node scripts/review/194-check.mjs [apiBase]   (default http://localhost:3099)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] || 'http://localhost:3099';
const WINDOW_MIN = 5;
const jobsDir = path.join(os.homedir(), '.claude', 'jobs');

const res = await fetch(`${base}/api/agents`);
if (!res.ok) throw new Error(`GET /api/agents -> ${res.status}`);
const body = await res.json();
const sessions = Array.isArray(body) ? body : body.sessions || [];
const api = new Set(
  sessions.filter((s) => s.kind === 'background' && s.displayState === 'working').map((s) => s.id)
);

const independent = new Set();
for (const s of sessions) {
  if (s.kind !== 'background') continue;
  let job;
  try {
    job = JSON.parse(fs.readFileSync(path.join(jobsDir, s.id, 'state.json'), 'utf8'));
  } catch {
    continue;
  }
  const transcript = job.linkScanPath;
  if (!transcript || !fs.existsSync(transcript)) continue;
  const fresh = Date.now() - fs.statSync(transcript).mtimeMs < WINDOW_MIN * 60_000;
  if (job.state !== 'done' && job.tempo === 'active' && (fresh || pendingToolUse(transcript)))
    independent.add(s.id);
}

/** Last transcript entry is a tool call without result: a long foreground tool is running */
function pendingToolUse(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(size, 256 * 1024));
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').trim().split('\n').reverse();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' && entry.type !== 'user') continue;
    const content = entry.message?.content;
    return (
      entry.type === 'assistant' &&
      Array.isArray(content) &&
      content.some((c) => c.type === 'tool_use')
    );
  }
  return false;
}

const rawWorking = sessions.filter((s) => s.kind === 'background' && s.state === 'working').length;
const onlyApi = [...api].filter((id) => !independent.has(id));
const onlyIndependent = [...independent].filter((id) => !api.has(id));
console.log(`background sessions: ${sessions.filter((s) => s.kind === 'background').length}`);
console.log(`CLI state "working": ${rawWorking}`);
console.log(`API displayState "working": ${api.size} [${[...api].join(', ')}]`);
console.log(
  `independent (tempo active, transcript < ${WINDOW_MIN} min or open tool call): ${independent.size}`
);
if (onlyApi.length || onlyIndependent.length) {
  console.log(`MISMATCH only-api=[${onlyApi}] only-independent=[${onlyIndependent}]`);
  process.exit(1);
}
console.log('MATCH');
