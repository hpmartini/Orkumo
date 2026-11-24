import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_READERS } from '../server/services/chatTranscripts.js';

// A skill called with text, as Claude Code logs it (neutralised excerpt of a real transcript):
// the command record with `<command-args>`, then the skill's text as an isMeta record; after it
// a `/compact` without arguments and its `<local-command-stdout>`
const lines = fs
  .readFileSync(path.join(__dirname, 'fixtures', 'claude-skill-with-args.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean);

describe('slash commands in a Claude transcript', () => {
  it('a command with text is the user turn: `/command` and its text', () => {
    const users = TRANSCRIPT_READERS.claude
      .historyEvents(lines)
      .filter((e: { type: string }) => e.type === 'devorbit_user');
    expect(users).toEqual([
      {
        type: 'devorbit_user',
        text: '/demo-skills:retro Dann musst du das prüfen!!!! Und messen, ob die Hebel wirken.\n\nUnd du hast schon wieder vergessen, dass du delegierst!!!',
        history: true,
        ts: expect.any(Number),
      },
    ]);
  });
});
