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

// A skill called without text (`/ping` from a throwaway `claude -p` run, neutralised): the
// command record carries `<command-message>` first and no `<command-args>`, then the isMeta skill
// text. A built-in without text (`/reload-plugins`) logs `<command-name>` first: no turn.
describe('a skill without text', () => {
  const bare = fs
    .readFileSync(path.join(__dirname, 'fixtures', 'claude-bare-skill.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean);

  it('is the user turn `/skill` (Claude); a built-in without text is not', () => {
    const users = TRANSCRIPT_READERS.claude
      .historyEvents(bare)
      .filter((e: { type: string }) => e.type === 'devorbit_user');
    expect(users).toEqual([
      {
        type: 'devorbit_user',
        text: '/ping',
        history: true,
        ts: Date.parse('2026-11-25T11:43:04.273Z'),
      },
    ]);
  });

  it("is the user turn as typed (omp's skill-prompt record, interactive)", () => {
    const rec = (o: object) => JSON.stringify(o);
    const lines = [
      rec({
        type: 'custom_message',
        customType: 'skill-prompt',
        content:
          '[IMPORTANT: User invoked the "ping" skill; follow its instructions.]\n\nReply pong.',
        display: true,
        details: {
          name: 'ping',
          path: '/tmp/demo/SKILL.md',
          args: 'now',
          prompt: '/skill:ping now',
        },
        attribution: 'user',
        id: 'c1',
        timestamp: '2026-11-25T11:43:18.790Z',
      }),
      rec({
        type: 'custom_message',
        customType: 'tool-roster-notice',
        content: '<system-notice>Tools changed</system-notice>',
        display: false,
        attribution: 'agent',
        id: 'c2',
        timestamp: '2026-11-25T11:43:19.000Z',
      }),
    ];
    const users = TRANSCRIPT_READERS.omp
      .historyEvents(lines)
      .filter((e: { type: string }) => e.type === 'devorbit_user');
    expect(users).toEqual([
      {
        type: 'devorbit_user',
        text: '/skill:ping now',
        history: true,
        ts: Date.parse('2026-11-25T11:43:18.790Z'),
      },
    ]);
  });
});
