/**
 * Dialogs an agent waits on in its terminal (Claude Code's AskUserQuestion, permission and other
 * numbered choices, omp's ask box), read from the pane's screen and answered with keys.
 *
 * The screen, not the transcript: Claude logs a pending AskUserQuestion only once it is answered.
 * Each parse mirrors the dialog's current step (one tab, one review); the TUI moves on after a key
 * and the next poll shows the next step. Keys follow what the TUIs do (checked in tmux, v2.1.326
 * and omp 18.21): a digit picks a numbered option (or toggles it in a multi select), arrows move
 * the cursor, typing on the free-text row fills it, Tab on a permission's "No" asks for a reason.
 */
import { stripAnsi } from './agentInput';

export type DialogRole = 'option' | 'other' | 'submit' | 'deny';

export interface DialogOption {
  label: string;
  description?: string;
  role: DialogRole;
  /** Checkbox state in a multi select; undefined for plain options and the submit row */
  checked?: boolean;
  /** omp radio: the option picked so far (the box waits on Submit) */
  selected?: boolean;
  /** Digit that picks it (Claude), null where only arrows reach it */
  number: number | null;
}

export interface AgentDialog {
  kind: 'question' | 'permission' | 'review' | 'choice';
  harness: 'claude' | 'omp';
  /** Question tabs (Claude): header and whether answered */
  tabs: { label: string; done: boolean }[];
  /** Permission: the tool ("Bash command", "Edit file") */
  title: string;
  /** Permission: command, file, diff; review: the answers */
  detail: string;
  question: string;
  multi: boolean;
  /** Options in cursor order: arrows move along this list */
  options: DialogOption[];
  /** Row the cursor is on */
  cursor: number;
}

export type DialogAnswer =
  | { type: 'pick'; row: number }
  | { type: 'text'; row: number; text: string };

const OPTION_RE = /^\s*(❯\s*)?(\d+)\.\s(.*)$/;
const RULE_RE = /^\s*─{10,}/;
const HINT_RE = /esc to cancel|enter to (select|confirm)/i;
const TAB_LINE_RE = /^\s*(←\s*)?[☐☒]\s/;
const TAB_RE = /([☐☒✔])\s+(.+?)(?=\s{2,}|\s*[☐☒✔→]|$)/g;

/** The dialog an agent's screen waits on, or null (no dialog, or one this parser does not know) */
export function parseAgentDialog(screen: string): AgentDialog | null {
  const lines = stripAnsi(screen)
    .split(/\r?\n/)
    .map((l) => l.trimEnd());
  return parseOmpAsk(lines) ?? parseClaude(lines);
}

function parseClaude(lines: string[]): AgentDialog | null {
  // Bottom up: a numbered list in the agent's answer above the dialog must not shadow it
  let anchor = -1;
  for (let i = lines.length - 1; i >= 0 && anchor < 0; i--)
    if (OPTION_RE.test(lines[i])) anchor = i;
  if (anchor < 0) return null;
  const waiting =
    lines.slice(anchor + 1).some((l) => HINT_RE.test(l)) ||
    lines.some((l) => /^\s*❯\s*\d+\.\s/.test(l));
  if (!waiting) return null;

  const raw: { n: number; text: string; more: string[]; cursor: boolean }[] = [];
  let more: string[] = [];
  let top = anchor;
  for (; top >= 0; top--) {
    const line = lines[top];
    const m = OPTION_RE.exec(line);
    if (m) {
      raw.unshift({ n: Number(m[2]), text: m[3].trim(), more, cursor: !!m[1] });
      more = [];
      if (m[2] === '1') break;
    } else if (!RULE_RE.test(line)) more.unshift(line.trim());
  }
  if (top < 0 || raw.some((o, i) => o.n !== i + 1) || raw.length < 2) return null;

  const header: string[] = [];
  for (let i = top - 1; i >= 0 && header.length < 15 && !RULE_RE.test(lines[i]); i--)
    header.unshift(lines[i].replace(/^\s*│\s?/, '').trim());

  const items = raw.filter((o) => o.text !== 'Chat about this');
  const isReview = header.some((l) => /^Review your answers/.test(l));
  const isQuestion = !isReview && header.some((l) => TAB_LINE_RE.test(l));
  const options: DialogOption[] = [];
  let cursor = 0;
  items.forEach((o, i) => {
    const box = /^\[(.)\]\s*/.exec(o.text);
    const label = box ? o.text.slice(box[0].length) : o.text;
    const submitAt = o.more.findIndex((l) => /^(❯\s*)?Submit$/.test(l));
    const extra = (submitAt < 0 ? o.more : o.more.slice(0, submitAt)).join(' ').trim();
    if (o.cursor) cursor = options.length;
    const role: DialogRole =
      isQuestion && i === items.length - 1
        ? 'other'
        : !isQuestion && !isReview && /^No\b/.test(label)
          ? 'deny'
          : 'option';
    options.push({
      label: isQuestion ? label : `${label} ${extra}`.trim(),
      ...(isQuestion && extra ? { description: extra } : {}),
      role,
      ...(box ? { checked: box[1] !== ' ' } : {}),
      number: o.n,
    });
    if (submitAt >= 0) {
      if (o.more[submitAt].startsWith('❯')) cursor = options.length;
      options.push({ label: 'Submit', role: 'submit', number: null });
    }
  });

  const tabs: AgentDialog['tabs'] = [];
  const text: string[] = [];
  for (const line of header) {
    if (!TAB_LINE_RE.test(line)) {
      if (line && !/^Tip:/.test(line) && !/^╌+$/.test(line)) text.push(line);
      continue;
    }
    for (const [, mark, label] of line.matchAll(TAB_RE))
      if (label.trim() !== 'Submit') tabs.push({ label: label.trim(), done: mark === '☒' });
  }
  const base = {
    harness: 'claude' as const,
    tabs,
    multi: options.some((o) => o.checked !== undefined),
    options,
    cursor,
  };
  if (isQuestion)
    return { ...base, kind: 'question', title: '', detail: '', question: text.join(' ') };
  if (isReview)
    return {
      ...base,
      kind: 'review',
      title: '',
      detail: text.filter((l) => !/^(Review your answers|Ready to submit)/.test(l)).join('\n'),
      question: text.find((l) => /^Ready to submit/.test(l)) ?? 'Submit your answers?',
    };
  const asks = text.length > 0 && text[text.length - 1].endsWith('?');
  const question = asks ? text[text.length - 1] : '';
  const rest = asks ? text.slice(0, -1) : text;
  const permission = /^Do you want/.test(question);
  return {
    ...base,
    kind: permission ? 'permission' : 'choice',
    title: permission ? (rest[0] ?? '') : '',
    detail: (permission ? rest.slice(1) : rest).join('\n'),
    question,
  };
}

const OMP_BOX_RE = /^\s*╭─ Ask /;
const OMP_OPTION_RE = /^(❯\s+)?\s*([○◉☐☑])\s+(.*)$/;

function parseOmpAsk(lines: string[]): AgentDialog | null {
  let start = -1;
  for (let i = lines.length - 1; i >= 0 && start < 0; i--) if (OMP_BOX_RE.test(lines[i])) start = i;
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*├/.test(l));
  if (end < 0 || !/⎋ cancel/.test(lines[end + 1] ?? '')) return null;

  const box = lines.slice(start + 1, end);
  const multi = box.some((l) => /[☐☑]/.test(l));
  const options: DialogOption[] = [];
  const question: string[] = [];
  let cursor = 0;
  for (const line of box) {
    const inner = line.replace(/^\s*│\s?/, '').replace(/\s*│\s*$/, '');
    const m = OMP_OPTION_RE.exec(inner);
    const submit = /^(❯\s+)?\s*Submit$/.exec(inner);
    if ((m?.[1] ?? submit?.[1]) !== undefined) cursor = options.length;
    if (m) {
      const other = /^Other:\s*(.*)$/.exec(m[3]);
      const typed = other?.[1].trim();
      options.push({
        label: other ? 'Other' : m[3].trim(),
        ...(typed && typed !== 'type your own' ? { description: typed } : {}),
        role: other ? 'other' : 'option',
        // a radio's dot is the pick so far (it waits on Submit), not a checkbox
        ...(multi ? { checked: m[2] === '☑' } : m[2] === '◉' ? { selected: true } : {}),
        number: null,
      });
    } else if (submit) options.push({ label: 'Submit', role: 'submit', number: null });
    else if (inner.trim() && options.length === 0) question.push(inner.trim());
  }
  if (options.length < 2) return null;
  return {
    kind: 'question',
    harness: 'omp',
    tabs: [],
    title: '',
    detail: '',
    question: question.join(' '),
    multi,
    options,
    cursor,
  };
}

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const move = (from: number, to: number) => (to > from ? DOWN : UP).repeat(Math.abs(to - from));
/** Text typed into a one-line field: a newline would submit early */
const oneLine = (text: string) => text.replace(/\s*\r?\n\s*/g, ' ').trim();

/** Keys that give `answer` to `dialog`, from where its cursor is */
export function dialogKeys(dialog: AgentDialog, answer: DialogAnswer): string {
  const option = dialog.options[answer.row];
  if (!option) return '';
  const to = move(dialog.cursor, answer.row);
  if (answer.type === 'text') {
    const text = oneLine(answer.text);
    if (option.role === 'deny') return `${to}\t${text}\r`;
    // Claude's multi select checks the typed row itself and waits for Submit
    return dialog.harness === 'claude' && dialog.multi ? `${to}${text}` : `${to}${text}\r`;
  }
  if (option.role === 'submit') return `${to}\r`;
  if (dialog.harness === 'claude' && option.number !== null) return String(option.number);
  return dialog.multi ? `${to} ` : `${to}\r`;
}
