/**
 * CPU / memory of server processes (incl. their child process tree) for the Agents View.
 */
import { execFile } from 'child_process';

export const MAX_PIDS = 50;

/**
 * "1,2,3" -> [1,2,3]; null when any entry is not a positive integer or there are more than MAX_PIDS.
 */
export function parsePids(input) {
  const parts = String(input ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_PIDS) return null;
  const pids = parts.map((p) => (/^\d{1,10}$/.test(p) ? Number(p) : NaN));
  return pids.every((n) => Number.isSafeInteger(n) && n > 0) ? [...new Set(pids)] : null;
}

/**
 * Parse `ps -A -o pid=,ppid=,pcpu=,rss=` into rows (rss in KB).
 */
export function parsePs(output) {
  const rows = [];
  for (const line of String(output || '').split('\n')) {
    // pcpu uses the locale's decimal separator (de_DE: "3,0")
    const [pid, ppid, cpu, rss] = line
      .trim()
      .split(/\s+/)
      .map((v) => Number(v.replace(',', '.')));
    if (Number.isInteger(pid) && Number.isFinite(cpu) && Number.isFinite(rss)) {
      rows.push({ pid, ppid, cpu, rss });
    }
  }
  return rows;
}

/**
 * Sum cpu% and rss over each requested pid and all its descendants; vanished pids are omitted.
 */
export function aggregateStats(rows, pids) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const children = new Map();
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) || []), r.pid]);
  const stats = [];
  for (const pid of pids) {
    if (!byPid.has(pid)) continue;
    let cpu = 0;
    let rss = 0;
    const seen = new Set();
    const stack = [pid];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const row = byPid.get(id);
      cpu += row.cpu;
      rss += row.rss;
      stack.push(...(children.get(id) || []));
    }
    stats.push({ pid, cpu: Math.round(cpu * 10) / 10, memMb: Math.round(rss / 1024) });
  }
  return stats;
}

/**
 * @param {number[]} pids validated with parsePids
 * @returns {Promise<import('../../types').AgentServerStats[]>}
 */
export function getProcessStats(pids) {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,ppid=,pcpu=,rss='],
      { timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(aggregateStats(parsePs(stdout), pids)))
    );
  });
}
