/**
 * Models and effort levels for the model × effort picker, read from the installed CLIs:
 * omp lists its models with their thinking levels (`omp models --json`); Claude Code names its
 * aliases and effort levels in `claude --help`. Read once per server run, a failed read retries.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveClaudeBinary } from './agentService.js';
import { resolveHarnessBinary } from '../../config/harnesses.js';

const run = promisify(execFile);
const cache = new Map();

/** `omp models --json` → picker rows; models without thinking levels keep an empty list */
export function ompModels(json) {
  const models = JSON.parse(json)?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((m) => typeof m?.selector === 'string')
    .map((m) => ({
      id: m.selector,
      label: m.name || m.id || m.selector,
      group: m.provider || '',
      efforts: Array.isArray(m.thinking) ? m.thinking.filter((t) => typeof t === 'string') : [],
    }));
}

/** `claude --help` → its model aliases, each with every effort level the CLI takes */
export function claudeModels(help) {
  const effort = help.match(/--effort <level>[^(]*\(([^)]+)\)/);
  const efforts = effort
    ? effort[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const model = help.match(/--model <model>([\s\S]*?)\n\s*-/);
  const aliases = model ? [...model[1].matchAll(/'([a-z][\w-]*)'/g)].map((m) => m[1]) : [];
  return aliases.map((id) => ({ id, label: id, group: 'Claude', efforts }));
}

async function read(harness) {
  if (harness === 'omp') {
    const bin = resolveHarnessBinary('omp');
    if (!bin) return [];
    const { stdout } = await run(bin, ['models', '--json'], { timeout: 20_000, maxBuffer: 8e6 });
    return ompModels(stdout);
  }
  if (harness === 'claude') {
    const { stdout } = await run(resolveClaudeBinary(), ['--help'], { timeout: 20_000 });
    return claudeModels(stdout);
  }
  return [];
}

export function listHarnessModels(harness) {
  if (!cache.has(harness))
    cache.set(
      harness,
      read(harness).catch((error) => {
        cache.delete(harness);
        throw error;
      })
    );
  return cache.get(harness);
}
