import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  claudeChat,
  codexChat,
  createOrkumoChatScanner,
  ensureChatsDir,
  sessionChat,
} from '../server/services/orkumoChats.js';
import { createChatHistory } from '../server/services/chatHistoryService.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';
const jsonl = (...records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

const claudeLines = [
  { type: 'custom-title', customTitle: 'Brotrezept' },
  {
    type: 'user',
    timestamp: '2026-11-10T08:00:00Z',
    message: { role: 'user', content: 'Wie backe ich Sauerteigbrot?' },
  },
  { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
  { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
  {
    type: 'assistant',
    timestamp: '2026-11-10T08:00:05Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hm' },
        { type: 'text', text: 'Mit Anstellgut.' },
        { type: 'tool_use', name: 'Read', input: {} },
      ],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'file body' }] },
  },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Und Zeit.' }] } },
].map((r) => JSON.stringify(r));

describe('transcript readers (#19 AK-4)', () => {
  it('Claude: prompts and answer text only, an answer over several records is one message', () => {
    const chat = claudeChat(claudeLines);
    expect(chat.title).toBe('Brotrezept');
    expect(chat.createdAt).toBe(Date.parse('2026-11-10T08:00:00Z'));
    expect(chat.messages).toEqual([
      { role: 'user', text: 'Wie backe ich Sauerteigbrot?', at: Date.parse('2026-11-10T08:00:00Z') },
      {
        role: 'assistant',
        text: 'Mit Anstellgut.\n\nUnd Zeit.',
        at: Date.parse('2026-11-10T08:00:05Z'),
      },
    ]);
  });

  it('omp / pi: session record, title, no system reminders', () => {
    const chat = sessionChat(
      jsonl(
        { type: 'session', id: UUID_B, cwd: '/c', timestamp: '2026-11-11T09:00:00Z' },
        { type: 'title', title: 'Fahrrad' },
        {
          type: 'message',
          message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>x' }] },
        },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Kette?' }] } },
        {
          type: 'message',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Ölen.' }] },
        }
      ).split('\n')
    );
    expect(chat).toMatchObject({ id: UUID_B, cwd: '/c', title: 'Fahrrad' });
    expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Kette?'],
      ['assistant', 'Ölen.'],
    ]);
  });

  it('Codex: its own context messages are left out', () => {
    const chat = codexChat(
      jsonl(
        { type: 'session_meta', payload: { id: UUID_C, cwd: '/c', timestamp: '2026-11-12T10:00:00Z' } },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '# AGENTS.md instructions for /c' }],
          },
        },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '<environment_context>…' }],
          },
        },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hallo' }] },
        },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi!' }],
          },
        }
      ).split('\n')
    );
    expect(chat).toMatchObject({ id: UUID_C, cwd: '/c' });
    expect(chat.messages.map((m) => m.text)).toEqual(['Hallo', 'Hi!']);
  });
});

describe('scanner and /chats list (#19 AK-4)', () => {
  let root;
  let chats;
  let other;
  let homes;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-chats-')));
    chats = ensureChatsDir(path.join(root, 'data', 'chats'));
    other = path.join(root, 'project');
    homes = {
      claudeDir: path.join(root, 'claude', 'projects', 'slug'),
      ompDir: path.join(root, 'omp'),
      piDir: path.join(root, 'pi'),
      codexDir: path.join(root, 'codex'),
    };
    fs.mkdirSync(homes.claudeDir, { recursive: true });
    fs.writeFileSync(path.join(homes.claudeDir, `${UUID_A}.jsonl`), claudeLines.join('\n'));
    // omp: one session in the chats folder, one in a project
    const ompSession = (id, cwd, text) =>
      jsonl(
        { type: 'session', id, cwd, timestamp: '2026-11-11T09:00:00Z' },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } },
        { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
      );
    fs.mkdirSync(path.join(homes.ompDir, '--chats--'), { recursive: true });
    fs.writeFileSync(
      path.join(homes.ompDir, '--chats--', `1_${UUID_B}.jsonl`),
      ompSession(UUID_B, chats, 'Kette ölen?')
    );
    fs.mkdirSync(path.join(homes.ompDir, '--project--'), { recursive: true });
    fs.writeFileSync(
      path.join(homes.ompDir, '--project--', `1_${UUID_D}.jsonl`),
      ompSession(UUID_D, other, 'Projektarbeit')
    );
    // codex: filed by date (today), one in the chats folder, one elsewhere
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = path.join(
      homes.codexDir,
      String(now.getFullYear()),
      pad(now.getMonth() + 1),
      pad(now.getDate())
    );
    fs.mkdirSync(day, { recursive: true });
    const rollout = (id, cwd, text) =>
      jsonl(
        { type: 'session_meta', payload: { id, cwd, timestamp: now.toISOString() } },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
        }
      );
    fs.writeFileSync(path.join(day, `rollout-a-${UUID_C}.jsonl`), rollout(UUID_C, chats, 'Steuer'));
    fs.writeFileSync(path.join(day, `rollout-b-${UUID_D}.jsonl`), rollout(UUID_D, other, 'Fremd'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds the sessions of every harness that ran in the chats folder, only those', async () => {
    const scanner = createOrkumoChatScanner({ dir: chats, ...homes });
    const found = await scanner.scan();
    expect(found.map((c) => c.id).sort()).toEqual([
      `orkumo:claude:${UUID_A}`,
      `orkumo:codex:${UUID_C}`,
      `orkumo:omp:${UUID_B}`,
    ]);
    const claude = found.find((c) => c.harness === 'claude');
    expect(claude).toMatchObject({
      provider: 'orkumo',
      sessionId: UUID_A,
      cwd: chats,
      title: 'Brotrezept',
      messages: [{ text: 'Wie backe ich Sauerteigbrot?' }, { text: 'Mit Anstellgut.\n\nUnd Zeit.' }],
    });
    // nothing changed: nothing to store again
    expect(await scanner.scan()).toEqual([]);
    fs.appendFileSync(
      path.join(homes.claudeDir, `${UUID_A}.jsonl`),
      `\n${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Und Roggen?' } })}\n`
    );
    const again = await scanner.scan();
    expect(again.map((c) => c.id)).toEqual([`orkumo:claude:${UUID_A}`]);
    expect(again[0].messages.at(-1).text).toBe('Und Roggen?');
  });

  it('/chats lists them with source Orkumo next to the history; search covers both', async () => {
    const scanner = createOrkumoChatScanner({ dir: chats, ...homes });
    const history = createChatHistory(path.join(root, 'data', 'chat-history'), {
      scanLocal: scanner.scan,
    });
    await history.upsert([
      {
        id: 'claude:web-1',
        provider: 'claude',
        title: 'Sauerteig im Winter',
        createdAt: 1,
        updatedAt: 2,
        project: null,
        projectName: null,
        messages: [{ role: 'user', text: 'Brot backen bei Kälte', at: null }],
      },
    ]);
    const all = await history.list();
    expect(all.counts).toEqual({ claude: 1, chatgpt: 0, orkumo: 3 });
    const orkumo = all.items.find((i) => i.id === `orkumo:claude:${UUID_A}`);
    expect(orkumo).toMatchObject({ provider: 'orkumo', harness: 'claude', sessionId: UUID_A });

    // a word from an answer of the Orkumo chat and from the title of the imported one
    expect((await history.list({ q: 'anstellgut' })).items.map((i) => i.id)).toEqual([
      `orkumo:claude:${UUID_A}`,
    ]);
    expect((await history.list({ q: 'sauerteig' })).items.map((i) => i.id).sort()).toEqual([
      'claude:web-1',
      `orkumo:claude:${UUID_A}`,
    ]);
    expect((await history.list({ provider: 'orkumo' })).total).toBe(3);
    const opened = await history.get(`orkumo:omp:${UUID_B}`);
    expect(opened.messages.map((m) => m.text)).toEqual(['Kette ölen?', 'ok']);
  });
});
