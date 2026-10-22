/**
 * Pure helpers for the command palette: fuzzy matching, ranking and prefix modes.
 *
 * Prefix modes (like VS Code): no prefix searches everything, `>` only commands,
 * `@` only agents, `#` only projects.
 */

export type PaletteScope = 'command' | 'agent' | 'project';

export interface PaletteCommand {
  id: string;
  title: string;
  /** Section label shown next to the title, e.g. "View" or "Agent" */
  group: string;
  scope: PaletteScope;
  /** Extra search terms that are not part of the title */
  keywords?: string;
  /** Display string for an existing shortcut, e.g. "⌘P" */
  shortcut?: string;
  run: () => void;
  /** Offered as a trailing "<title>: <text>" row for free text that is not a prefix query */
  runWithText?: (text: string) => void;
}

export type PaletteMode = 'all' | PaletteScope;

export interface ParsedPaletteInput {
  mode: PaletteMode;
  query: string;
}

const PREFIX_MODES: Record<string, PaletteMode> = { '>': 'command', '@': 'agent', '#': 'project' };

export function parsePaletteInput(raw: string): ParsedPaletteInput {
  const mode = PREFIX_MODES[raw.charAt(0)];
  if (!mode) return { mode: 'all', query: raw.trim() };
  return { mode, query: raw.slice(1).trim() };
}

export interface FuzzyMatch {
  score: number;
  /** Indices of matched characters in the text, for highlighting */
  indices: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/.:]/.test(text[i - 1]);

/**
 * Case-insensitive subsequence match. A contiguous substring beats a scattered match;
 * word starts and early matches score higher.
 * shortcut: greedy leftmost subsequence, not optimal alignment - fine for short titles.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, indices: [] };

  const at = t.indexOf(q);
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, i) => at + i);
    // Prefer prefixes and word starts, then shorter texts
    const score = 1000 + (at === 0 ? 200 : isBoundary(t, at) ? 100 : 0) - at - t.length * 0.1;
    return { score, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found < 0) return null;
    if (indices.length && found === from) score += 15;
    if (isBoundary(t, found)) score += 10;
    score -= found - from;
    indices.push(found);
    from = found + 1;
  }
  return { score: score - t.length * 0.1, indices };
}

export interface RankedCommand {
  command: PaletteCommand;
  /** Title match indices, empty when matched via group/keywords or no query */
  indices: number[];
}

export function rankCommands(commands: PaletteCommand[], rawInput: string): RankedCommand[] {
  const { mode, query } = parsePaletteInput(rawInput);
  const pool = mode === 'all' ? commands : commands.filter((c) => c.scope === mode);
  if (!query) return pool.map((command) => ({ command, indices: [] }));

  const ranked: (RankedCommand & { score: number; order: number })[] = [];
  pool.forEach((command, order) => {
    const title = fuzzyMatch(query, command.title);
    if (title) {
      ranked.push({ command, indices: title.indices, score: title.score + 500, order });
      return;
    }
    const other = fuzzyMatch(query, `${command.group} ${command.keywords ?? ''}`);
    if (other) ranked.push({ command, indices: [], score: other.score, order });
  });
  return ranked.sort((a, b) => b.score - a.score || a.order - b.order);
}
