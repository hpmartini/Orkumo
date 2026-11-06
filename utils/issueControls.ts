/**
 * Issue modal (#104): the workflow provider's control labels as buttons, and comment quote/reply text.
 */
import type { IssueComment, StartResult, WorkflowControls } from '../types';

type Modes = NonNullable<WorkflowControls['modes']>;

/** Label names with `label` added or removed; the rest of the set stays as it is */
export function toggleLabel(names: string[], label: string, on: boolean): string[] {
  const rest = names.filter((n) => n !== label);
  return on ? [...rest, label] : rest;
}

/** Dialog/toast text for a start: started, queued, waiting for a free slot, or the provider's reason */
export function startText(s: StartResult): string {
  if (s.action === 'start' || s.action === 'resume') return 'gestartet';
  if (s.action === 'queued') return s.reason || 'startet später';
  if (s.full) return `${s.reason}, startet, sobald einer frei wird`;
  return s.reason || 'nicht gestartet';
}

/** Label of the active mode (null: default, no mode label set) */
export function currentMode(names: string[], modes: Modes): string | null {
  return modes.options.find((o) => o.label && names.includes(o.label))?.label ?? null;
}

/** Label names with exactly the mode label `mode` (none for null), dropped labels removed */
export function setMode(names: string[], modes: Modes, mode: string | null): string[] {
  const modeLabels = [
    ...modes.options.flatMap((o) => (o.label ? [o.label] : [])),
    ...(modes.drop ?? []),
  ];
  const rest = names.filter((n) => !modeLabels.includes(n));
  return mode ? [...rest, mode] : rest;
}

/** Markdown quote of a comment, attributed, followed by an empty line for the answer */
export function quoteComment(c: Pick<IssueComment, 'author' | 'body' | 'url'>): string {
  // HTML comments (workflow markers) are invisible on GitHub; quoting them would duplicate markers
  const quoted = c.body
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimEnd()
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
  return `> **@${c.author}** [schrieb](${c.url}):\n>\n${quoted}\n\n`;
}

/** GitHub has no threaded issue comments: a reply mentions the author and quotes the comment */
export function replyText(c: Pick<IssueComment, 'author' | 'body' | 'url'>): string {
  return `${quoteComment(c)}@${c.author} `;
}

/** Inserts `text` into a draft: appended after a blank line unless the draft is empty */
export function insertIntoDraft(draft: string, text: string): string {
  return draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text;
}
