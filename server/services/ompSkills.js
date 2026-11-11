/**
 * The user's Claude Code skills for Oh My Pi sessions Orkumo starts (chat and terminal panes).
 *
 * omp loads Claude's user-level sources only on opt-in, and most of the user's own skills live in
 * Claude marketplace plugins (`~/.claude/plugins`). This overlay opts in:
 * - `skills.enableClaudeUser`: the skills in `~/.claude/skills`
 * - `enabledProviders: claude-plugins`: the plugins Claude Code has enabled, as Claude loads them
 *   (namespaced skills, plugin commands, hooks and MCP servers), with omp's own plugin discovery
 * It does not opt in the `claude` source as a whole, so `~/.claude/CLAUDE.md`, user commands and
 * settings stay out. Passed as `omp --config <file>`; omp then lists the skills as `/skill:<name>`.
 *
 * Synchronous on purpose: chat drivers spawn synchronously, and the work is one fast
 * `omp config get` (~80 ms) and one small file write per started session.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDataPath } from './dataPath.js';

/** The user's own `enabledProviders` (omp's effective setting), so the overlay keeps them */
function userEnabledProviders(bin, cwd) {
  try {
    const out = execFileSync(bin, ['config', 'get', 'enabledProviders', '--json'], {
      cwd,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = JSON.parse(out).value;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Overlay content: the user's providers plus `claude-plugins`, and Claude's user skills */
export function ompSkillsOverlay(userProviders) {
  return {
    enabledProviders: userProviders.includes('claude-plugins')
      ? userProviders
      : [...userProviders, 'claude-plugins'],
    skills: { enableClaudeUser: true },
  };
}

/**
 * Writes the overlay and returns `['--config', <file>]` for the omp command line; `[]` when it
 * cannot be written (omp then starts with its own settings only).
 */
export function ompSkillsArgs(bin, cwd, { dataDir = getDataPath() } = {}) {
  try {
    const overlay = ompSkillsOverlay(userEnabledProviders(bin, cwd));
    const file = path.join(dataDir, 'omp-skills.json');
    // JSON is valid YAML. Rename makes the swap atomic: an omp starting meanwhile never reads a
    // half-written file
    const tmp = `${file}.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(overlay, null, 2));
    fs.renameSync(tmp, file);
    return ['--config', file];
  } catch {
    return [];
  }
}
