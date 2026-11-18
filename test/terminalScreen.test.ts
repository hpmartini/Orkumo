import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Terminal } from '@xterm/xterm';
import { promptSuggestion, renderTerminalScreen } from '../utils/terminalScreen';
import { extractNumberedChoices, stripAnsi } from '../utils/agentInput';

// Real `claude logs <id>` streams (Claude Code v2.1.318), see #178
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const table = fixture('claude-logs-table.txt');
const question = fixture('claude-logs-question.txt');

describe('renderTerminalScreen', () => {
  it('AC-1: restores spaces that the TUI encodes as cursor jumps', async () => {
    const sentence = 'Die verschleppten Favoriten sind aus settings.json entfernt';
    const glued = sentence.replace(/ /g, '');
    expect(stripAnsi(table)).toContain(glued); // the old path, as seen in the issue screenshot
    const screen = await renderTerminalScreen(table);
    expect(screen).toContain(`  ${sentence}`);
    expect(screen).not.toContain(glued);
    // overwritten spinner frames do not survive on the final screen
    expect(stripAnsi(table)).toContain('Razzle-dazzling…');
    expect(screen).not.toContain('Razzle-dazzling');
  });

  it('AC-2: keeps a box-drawing table on aligned, unbroken lines', async () => {
    const lines = (await renderTerminalScreen(table)).split('\n');
    const start = lines.findIndex((l) => l.includes('┌'));
    const end = lines.findIndex((l) => l.includes('┘'));
    expect(end - start).toBe(8);
    const rows = lines.slice(start, end + 1).map((l) => l.trimEnd());
    expect(rows).toContain('  │ Agentic Workflow │ Agent f44e021a │ -        │');
    expect(rows).toContain('  │ Websites         │ -              │ 82fd11a4 │');
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });

  it('AC-3: numbered choices come out as separate, readable options', async () => {
    expect(extractNumberedChoices(await renderTerminalScreen(question))).toEqual([
      { number: 1, label: 'Backup behalten' },
      { number: 2, label: 'Backup löschen' },
      { number: 3, label: 'Später entscheiden' },
      { number: 4, label: 'Type something.' },
      { number: 5, label: 'Chat about this' },
    ]);
  });

  it('interprets a 20 kB stream fast enough for the 4 s poll', async () => {
    const started = Date.now();
    await renderTerminalScreen(table);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('passes plain text through unchanged', async () => {
    expect(await renderTerminalScreen('hello\r\nworld')).toBe('hello\nworld');
  });
});

describe('promptSuggestion', () => {
  // SGR as Claude Code v2.1.327 draws its input box: marker plain, ghost text dim, typed text white
  const screen = async (input: string) => {
    const term = new Terminal({ cols: 60, rows: 8, allowProposedApi: true });
    const raw = [
      '\x1b[38;2;153;153;153m❯\x1b[39m Nenne zwei Namen',
      '⏺ Willst du A oder B?',
      '─'.repeat(60),
      input,
      '─'.repeat(60),
      '  ⏵⏵ auto mode on',
    ].join('\r\n');
    await new Promise<void>((resolve) => term.write(raw, resolve));
    return term;
  };

  it('reads the dim ghost text of the input line, not an earlier prompt', async () => {
    const term = await screen('❯\xa0\x1b[2mJa, leg test_probe.txt an.\x1b[22m');
    expect(promptSuggestion(term)).toEqual({
      text: 'Ja, leg test_probe.txt an.',
      truncated: false,
    });
  });

  it('none once the user typed, for an empty line or the start hint', async () => {
    expect(promptSuggestion(await screen('❯ \x1b[38;2;255;255;255mmein Text\x1b[39m'))).toBeNull();
    expect(promptSuggestion(await screen('❯\xa0'))).toBeNull();
    expect(promptSuggestion(await screen('❯ \x1b[2mTry "fix lint errors"\x1b[22m'))).toBeNull();
  });

  it('marks a suggestion the TUI cut at the pane width', async () => {
    const term = await screen('❯ \x1b[2mUmsetzen und danach die Tests laufen lass…\x1b[22m');
    expect(promptSuggestion(term)).toEqual({
      text: 'Umsetzen und danach die Tests laufen lass',
      truncated: true,
    });
  });
});
