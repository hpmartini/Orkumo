/**
 * Issue modal (#104): mw-board control labels as buttons and comment quote/reply text.
 */
import type { IssueComment } from '../types';
import { BUILD_LABEL, GO_LABEL, IMAGE_LABEL, NEED_INPUT_LABEL } from './workflowStage.js';

export { BUILD_LABEL, GO_LABEL, NEED_INPUT_LABEL };
export const DYNAMIC_LABEL = 'mw:dynamic';
export const DELEGATE_LABEL = 'mw:delegate';
export const REVIEW_LABEL = 'mw:review';
/** Mode labels are exclusive; none of them = default mode */
export const MODE_LABELS = { image: IMAGE_LABEL } as const;
/** mw 6 modes, a control error since mw 7 (#136): a mode change drops them */
const LEGACY_MODE_LABELS = ['mw:orchestrate', 'mw:pipeline'];
export type FlowMode = 'default' | keyof typeof MODE_LABELS;

/** Label names with `label` added or removed; the rest of the set stays as it is */
export function toggleLabel(names: string[], label: string, on: boolean): string[] {
  const rest = names.filter((n) => n !== label);
  return on ? [...rest, label] : rest;
}

export function currentMode(names: string[]): FlowMode {
  const hit = (Object.keys(MODE_LABELS) as (keyof typeof MODE_LABELS)[]).find((m) =>
    names.includes(MODE_LABELS[m])
  );
  return hit ?? 'default';
}

/** Label names with exactly the mode label of `mode` (none for default), legacy modes dropped */
export function setMode(names: string[], mode: FlowMode): string[] {
  const modeLabels: string[] = [...Object.values(MODE_LABELS), ...LEGACY_MODE_LABELS];
  const rest = names.filter((n) => !modeLabels.includes(n));
  return mode === 'default' ? rest : [...rest, MODE_LABELS[mode]];
}

/** Markdown quote of a comment, attributed, followed by an empty line for the answer */
export function quoteComment(c: Pick<IssueComment, 'author' | 'body' | 'url'>): string {
  // HTML comments (mw-board markers) are invisible on GitHub; quoting them would duplicate markers
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
