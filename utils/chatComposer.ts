/**
 * Chat composer editing rules (#189 follow-up): pure functions of text + caret, so ChatPane only
 * applies the result. Each returns null when the key keeps its native behavior.
 */

export interface Edit {
  value: string;
  caret: number;
}

const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl;
};

const BULLET = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

/** Home: start of the line; already there → start of the line above. Never leaves the text. */
export function homeKey(text: string, caret: number): number | null {
  if (caret === 0) return null;
  const start = lineStart(text, caret);
  return caret > start ? start : lineStart(text, caret - 1);
}

/** End: end of the line; already there → end of the line below. Never leaves the text. */
export function endKey(text: string, caret: number): number | null {
  const end = lineEnd(text, caret);
  if (caret < end) return end;
  return end === text.length ? null : lineEnd(text, caret + 1);
}

/** Newline inside a list item: continue the bullet; on an empty item end the list instead */
export function continueList(text: string, caret: number): Edit | null {
  const start = lineStart(text, caret);
  const line = text.slice(start, caret);
  const m = line.match(BULLET);
  if (!m) return null;
  const [marker, indent, sym, gap, box] = m;
  if (line.trim() === marker.trim() && text.slice(caret, lineEnd(text, caret)).trim() === '') {
    // Empty item: drop the marker, leave a blank line
    return { value: text.slice(0, start) + text.slice(caret), caret: start };
  }
  const num = sym.match(/^(\d+)([.)])$/);
  const next = num ? `${Number(num[1]) + 1}${num[2]}` : sym;
  const insert = `\n${indent}${next}${gap}${box ? '[ ] ' : ''}`;
  return { value: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}

/** Tab / Shift+Tab on a list line: indent by 2 / outdent by up to 2. Other lines keep Tab (focus). */
export function indentList(text: string, caret: number, outdent: boolean): Edit | null {
  const start = lineStart(text, caret);
  if (!BULLET.test(text.slice(start, lineEnd(text, caret)))) return null;
  if (!outdent) return { value: `${text.slice(0, start)}  ${text.slice(start)}`, caret: caret + 2 };
  const spaces = text.slice(start).match(/^ {0,2}/)![0].length;
  if (spaces === 0) return { value: text, caret };
  return {
    value: text.slice(0, start) + text.slice(start + spaces),
    caret: Math.max(start, caret - spaces),
  };
}

/** Arrow up/down walks earlier messages only while the caret is on the first / last line */
export function historyStep(text: string, caret: number, direction: 'up' | 'down'): boolean {
  return direction === 'up'
    ? !text.slice(0, caret).includes('\n')
    : !text.slice(caret).includes('\n');
}

/**
 * Message history cursor. `index` -1 = the draft; 0 = newest sent message.
 * Returns the new index and text, or null at either end.
 */
export function browseHistory(
  history: string[],
  index: number,
  draft: string,
  direction: 'up' | 'down'
): { index: number; text: string } | null {
  const next = direction === 'up' ? index + 1 : index - 1;
  if (next >= history.length || next < -1) return null;
  return { index: next, text: next === -1 ? draft : history[history.length - 1 - next] };
}

export interface ChatSuggestion {
  kind: 'command' | 'agent' | 'file';
  label: string;
  insert: string;
  description: string;
  hint: string;
}

export interface SuggestionContext {
  commands: { name: string; description: string; argumentHint?: string; builtin?: boolean }[];
  agents: { name: string; description: string }[];
  files: string[];
}

/** Token at the caret that opens the picker: `/cmd` at line start, `@x` anywhere */
export function suggestionQuery(
  text: string,
  caret: number
): { trigger: '/' | '@'; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const slash = before.match(/(?:^|\s)\/([^\s/]*)$/);
  if (slash) return { trigger: '/', query: slash[1], start: caret - slash[1].length - 1 };
  const at = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (at) return { trigger: '@', query: at[1], start: caret - at[1].length - 1 };
  return null;
}

/** Prefix matches first, then substring matches (name before description) */
function rank<T>(items: T[], query: string, name: (t: T) => string, desc: (t: T) => string): T[] {
  const q = query.toLowerCase();
  if (!q) return items;
  const score = (t: T) => {
    const n = name(t).toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    if (desc(t).toLowerCase().includes(q)) return 2;
    return 3;
  };
  return items
    .map((t) => [t, score(t)] as const)
    .filter(([, s]) => s < 3)
    .sort((a, b) => a[1] - b[1])
    .map(([t]) => t);
}

export function chatSuggestions(
  trigger: '/' | '@',
  query: string,
  ctx: SuggestionContext,
  limit = 50
): ChatSuggestion[] {
  if (trigger === '/') {
    return rank(
      ctx.commands,
      query,
      (c) => c.name,
      (c) => c.description
    )
      .slice(0, limit)
      .map((c) => ({
        kind: 'command',
        label: `/${c.name}`,
        insert: `/${c.name} `,
        description: c.description,
        hint: c.argumentHint || '',
      }));
  }
  // `@agent-rev` and `@rev` both find the agent `reviewer`
  const agents = rank(
    ctx.agents,
    query.replace(/^agent-/i, ''),
    (a) => a.name,
    (a) => a.description
  ).map(
    (a): ChatSuggestion => ({
      kind: 'agent',
      label: `@agent-${a.name}`,
      insert: `@agent-${a.name} `,
      description: a.description,
      hint: '',
    })
  );
  const files = rank(
    ctx.files,
    query,
    (f) => f,
    () => ''
  ).map(
    (f): ChatSuggestion => ({
      kind: 'file',
      label: `@${f}`,
      insert: `@${f} `,
      description: f,
      hint: '',
    })
  );
  // Agents are few, so they lead; otherwise thousands of path matches bury them
  return [...agents, ...files].slice(0, limit);
}

/** `[Image: /path]` lines the composer appends → image paths + the text without them */
export function splitImages(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const rest = text
    .split('\n')
    .filter((line) => {
      const m = line.match(/^\[Image: (.+)\]$/);
      if (m) images.push(m[1]);
      return !m;
    })
    .join('\n');
  return { text: rest.trim(), images };
}
