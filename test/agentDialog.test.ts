import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dialogKeys, parseAgentDialog, type AgentDialog } from '../utils/agentDialog';

/** A screen captured from the real TUI, as `paneScreen(id, 40)` hands it over (blank lines dropped) */
const screen = (name: string) =>
  fs
    .readFileSync(path.join(__dirname, 'fixtures', 'agentDialogs', `${name}.txt`), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .slice(-40)
    .join('\n');

const parse = (name: string) => {
  const dialog = parseAgentDialog(screen(name));
  if (!dialog) throw new Error(`no dialog in ${name}`);
  return dialog;
};
const labels = (d: AgentDialog) => d.options.map((o) => `${o.role}:${o.label}`);

const UP = '\x1b[A';
const DOWN = '\x1b[B';

describe('parseAgentDialog: Claude AskUserQuestion', () => {
  it('one question: options with descriptions, free text, no chat row', () => {
    const d = parse('claude-question-single');
    expect(d).toMatchObject({ kind: 'question', harness: 'claude', multi: false, cursor: 0 });
    expect(d.question).toBe('Wohin deployen?');
    expect(d.tabs).toEqual([{ label: 'Ziel', done: false }]);
    expect(labels(d)).toEqual(['option:Staging', 'option:Prod', 'other:Type something.']);
    expect(d.options[0].description).toBe('Testumgebung');
  });

  it('a digit picks an option; free text goes to the free row, then Enter', () => {
    const d = parse('claude-question-single');
    expect(dialogKeys(d, { type: 'pick', row: 1 })).toBe('2');
    expect(dialogKeys(d, { type: 'text', row: 2, text: 'Version 2\nauf eu-1' })).toBe(
      `${DOWN}${DOWN}Version 2 auf eu-1\r`
    );
  });

  it('several questions: tabs with their state, the current question only', () => {
    const d = parse('claude-question-tabs');
    expect(d.tabs).toEqual([
      { label: 'Farbe', done: false },
      { label: 'Extras', done: false },
    ]);
    expect(d.question).toBe('Welche Farbe?');
    expect(labels(d)).toEqual(['option:Rot (warm)', 'option:Blau (kalt)', 'other:Type something.']);
  });

  it('multi select: checkbox state, a submit row; digits toggle, Submit moves there and confirms', () => {
    const d = parse('claude-question-tabs-multi');
    expect(d.tabs[0]).toEqual({ label: 'Farbe', done: true });
    expect(d.multi).toBe(true);
    expect(labels(d)).toEqual([
      'option:Käse',
      'option:Salat',
      'other:Type something',
      'submit:Submit',
    ]);
    expect(d.options.map((o) => o.checked)).toEqual([false, false, false, undefined]);
    expect(dialogKeys(d, { type: 'pick', row: 1 })).toBe('2');
    expect(dialogKeys(d, { type: 'pick', row: 3 })).toBe(`${DOWN.repeat(3)}\r`);
    // typing on the free row checks it; no Enter, the user submits when done
    expect(dialogKeys(d, { type: 'text', row: 2, text: 'Deno' })).toBe(`${DOWN.repeat(2)}Deno`);
  });

  it('multi select of a single question', () => {
    const d = parse('claude-question-multi');
    expect(d.multi).toBe(true);
    expect(d.question).toBe('Welche Tools?');
    expect(d.options.at(-1)?.role).toBe('submit');
  });

  it('review step: numbered answers to submit or cancel', () => {
    const d = parse('claude-question-review');
    expect(d.kind).toBe('review');
    expect(d.detail).toContain('Bun, Deno 2');
    expect(labels(d)).toEqual(['option:Submit answers', 'option:Cancel']);
    expect(dialogKeys(d, { type: 'pick', row: 0 })).toBe('1');
  });
});

describe('parseAgentDialog: Claude permission', () => {
  it('Bash: tool, command, options by label, No takes a reason', () => {
    const d = parse('claude-permission-bash');
    expect(d).toMatchObject({ kind: 'permission', title: 'Bash command' });
    expect(d.detail).toContain('echo 42 > b.txt');
    expect(d.detail).not.toContain('Tip:');
    expect(d.question).toBe('Do you want to proceed?');
    expect(labels(d)[0]).toBe('option:Yes');
    expect(labels(d).at(-1)).toBe('deny:No');
    expect(dialogKeys(d, { type: 'pick', row: 0 })).toBe('1');
    expect(dialogKeys(d, { type: 'text', row: 3, text: 'nimm echo' })).toBe(
      `${DOWN.repeat(3)}\tnimm echo\r`
    );
  });

  it('Edit: file and diff, a wrapped option label joined', () => {
    const d = parse('claude-permission-edit');
    expect(d.title).toBe('Edit file');
    expect(d.detail).toContain('a.txt');
    expect(d.question).toBe('Do you want to make this edit to a.txt?');
    expect(d.options[1].label).toBe(
      'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)'
    );
    expect(d.options.map((o) => o.role)).toEqual(['option', 'option', 'deny']);
  });
});

describe('parseAgentDialog: omp ask', () => {
  it('radio: the live box, not the collapsed one above; arrows and Enter', () => {
    const d = parse('omp-ask-radio');
    expect(d).toMatchObject({ kind: 'question', harness: 'omp', multi: false, cursor: 0 });
    expect(d.question).toBe('Wohin?');
    expect(labels(d)).toEqual(['option:Staging', 'option:Prod', 'other:Other', 'submit:Submit']);
    // radio buttons are plain options in the card, not checkboxes
    expect(d.options.every((o) => o.checked === undefined)).toBe(true);
    expect(dialogKeys(d, { type: 'pick', row: 1 })).toBe(`${DOWN}\r`);
    expect(dialogKeys(d, { type: 'text', row: 2, text: 'eu 1' })).toBe(`${DOWN.repeat(2)}eu 1\r`);
    expect(dialogKeys(d, { type: 'pick', row: 3 })).toBe(`${DOWN.repeat(3)}\r`);
  });

  it('radio: the picked option is marked', () => {
    const picked = parseAgentDialog(screen('omp-ask-radio').replace('│   ○ Prod', '│   ◉ Prod'));
    expect(picked?.options.map((o) => !!o.selected)).toEqual([false, true, false, false]);
  });

  it('checkbox: Space toggles', () => {
    const d = parse('omp-ask-checkbox');
    expect(d.multi).toBe(true);
    expect(d.options.map((o) => o.checked)).toEqual([false, false, false, false, undefined]);
    expect(dialogKeys({ ...d, cursor: 2 }, { type: 'pick', row: 0 })).toBe(`${UP}${UP} `);
  });
});

describe('parseAgentDialog: no dialog', () => {
  it('an answer ending in a numbered list is no question', () => {
    expect(
      parseAgentDialog('⏺ Next steps:\n  1. Build\n  2. Test\n✻ Cooked for 3s\n❯ \n──────')
    ).toBeNull();
  });

  it('an omp screen without an ask box', () => {
    expect(parseAgentDialog('╭── π > Opus\n╰─ ⇧⇥ to change thinking effort ─╯')).toBeNull();
  });
});
