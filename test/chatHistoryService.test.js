import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assignTopics,
  createChatHistory,
  detectExport,
  parseExport,
  NO_TOPIC,
} from '../server/services/chatHistoryService.js';

// Invented data in the shape of the official exports; no real conversation, account or project
const FIXTURES = path.join(__dirname, 'fixtures/chat-exports');
const json = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));

let dir;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-history-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('parseExport', () => {
  it('tells the two exports apart by content', () => {
    expect(detectExport(json('claude/conversations.json'))).toBe('claude');
    expect(detectExport(json('chatgpt/conversations.json'))).toBe('chatgpt');
    expect(detectExport(json('claude/projects.json'))).toBe('claude-projects');
    expect(detectExport(json('claude/users.json'))).toBeNull();
    expect(detectExport({ nope: 1 })).toBeNull();
  });

  it('reads a claude.ai export: text blocks, attachments, project, current branch', () => {
    const names = new Map([['22222222-0000-4000-8000-000000000001', 'Backstube']]);
    const result = parseExport(json('claude/conversations.json'), names);
    expect(result).toMatchObject({ provider: 'claude', found: 4 });
    expect(result.skipped).toEqual({ 'no messages': 1 });
    const [bread, bike, branch] = result.conversations;
    expect(bread).toMatchObject({
      id: 'claude:11111111-0000-4000-8000-000000000001',
      title: 'Sauerteig Brot backen',
      projectName: 'Backstube',
      updatedAt: Date.parse('2026-01-05T08:10:00Z'),
    });
    // thinking blocks are not part of the answer
    expect(bread.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Wie lange muss ein Sauerteig Brot gehen?'],
      ['assistant', 'Etwa zwölf Stunden bei Raumtemperatur, das Stichwort ist Stockgare.'],
    ]);
    expect(bike.project).toBeNull();
    expect(bike.messages[0].text).toContain('[File: kette.txt]');
    // untitled: first line; the discarded branch is not shown
    expect(branch.title).toBe('Nenne eine Brot Sorte aus Norddeutschland');
    expect(branch.messages.map((m) => m.text).join(' ')).not.toContain('Pumpernickel');
    expect(branch.messages).toHaveLength(2);
  });

  it('reads a ChatGPT export: current path of the tree, no system / tool / hidden turns', () => {
    const result = parseExport(json('chatgpt/conversations.json'));
    expect(result).toMatchObject({ provider: 'chatgpt', found: 4 });
    expect(result.skipped).toEqual({ 'no messages': 1 });
    const [bread, bike, zebra] = result.conversations;
    expect(bread.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Geht Brot auch ohne Hefe?'],
      ['assistant', 'Ja, mit Backpulver oder Sauerteig; Stichwort Sodabrot.'],
    ]);
    expect(bread.updatedAt).toBe((1767600000 + 600) * 1000);
    expect(bike.project).toBe('g-p-0123456789abcdef0123456789abcdef');
    expect(bike.messages.map((m) => m.text)).toEqual([
      'Wie flicke ich einen Reifen am Fahrrad?',
      'Loch suchen, anrauen, Flicken aufkleben.',
    ]);
    // no title, no update time, an image part
    expect(zebra.title).toBe('Zeig mir ein Bild von einem Zebra');
    expect(zebra.updatedAt).toBe((1767600000 + 172800) * 1000);
    expect(zebra.messages[1].text).toBe('[image_asset_pointer]\nHier ist das Zebra.');
  });

  it('survives garbage', () => {
    expect(parseExport(null).conversations).toEqual([]);
    expect(parseExport([{ chat_messages: 'x' }, null, { uuid: 5 }]).skipped).toEqual({
      'no id': 3,
    });
    expect(parseExport([{ mapping: {}, id: 'a', current_node: 'gone' }]).skipped).toEqual({
      'no messages': 1,
    });
  });
});

describe('assignTopics (AC-4)', () => {
  const entries = [
    { title: 'Sauerteig Brot backen', firstMessage: '' },
    { title: 'Brot ohne Hefe', firstMessage: '' },
    { title: 'Fahrrad Kette wechseln', firstMessage: '' },
    { title: 'Neuer Chat', firstMessage: 'Wie flicke ich einen Reifen am Fahrrad?' },
    { title: 'Zebra', firstMessage: 'Zeig mir ein Zebra' },
  ];
  it('groups by the shared word of the title, else of the first message', () => {
    expect(assignTopics(entries)).toEqual(['brot', 'brot', 'fahrrad', 'fahrrad', NO_TOPIC]);
  });
  it('in a larger history a word nearly every chat shares is no topic', () => {
    const many = Array.from({ length: 40 }, (_, n) => ({
      title: `Verlauf ${n % 2 ? 'Fahrrad' : 'Brot'} ${n < 8 ? 'Zebra' : ''}`,
      firstMessage: '',
    }));
    expect(new Set(assignTopics(many))).toEqual(new Set(['zebra', NO_TOPIC]));
  });
  it('runs locally: no network call of any kind', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    assignTopics(entries);
    expect(fetchSpy).not.toHaveBeenCalled();
    const source = fs.readFileSync(
      path.join(__dirname, '../server/services/chatHistoryService.js'),
      'utf8'
    );
    expect(source).not.toMatch(/from '(node:)?(https?|net|tls|dgram|child_process)'|fetch\(/);
    fetchSpy.mockRestore();
  });
});

describe('store', () => {
  it('imports both exports from one folder and counts what it found (AC-1)', async () => {
    const history = createChatHistory(dir);
    const report = await history.importFrom(FIXTURES);
    expect(report.files).toEqual([
      {
        file: 'conversations.json',
        provider: 'chatgpt',
        found: 4,
        imported: 3,
        skipped: { 'no messages': 1 },
      },
      {
        file: 'conversations.json',
        provider: 'claude',
        found: 4,
        imported: 3,
        skipped: { 'no messages': 1 },
      },
    ]);
    expect(report.counts).toEqual({ claude: 3, chatgpt: 3 });
  });

  it('lists by last activity; filters provider, period, project, topic (AC-3)', async () => {
    const history = createChatHistory(dir);
    await history.importFrom(FIXTURES);
    const all = await history.list();
    expect(all.total).toBe(6);
    const times = all.items.map((i) => i.updatedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(all.items[0]).not.toHaveProperty('hay');

    expect((await history.list({ provider: 'claude' })).items.map((i) => i.provider)).toEqual([
      'claude',
      'claude',
      'claude',
    ]);
    const february = await history.list({
      from: Date.parse('2026-02-01'),
      to: Date.parse('2026-02-28'),
    });
    expect(february.items.map((i) => i.title)).toEqual(['Fahrrad Kette wechseln']);
    expect(all.projects).toEqual([
      { id: '22222222-0000-4000-8000-000000000001', name: 'Backstube', count: 1 },
      { id: 'g-p-0123456789abcdef0123456789abcdef', name: 'Project 01234567', count: 1 },
    ]);
    const project = await history.list({ project: '22222222-0000-4000-8000-000000000001' });
    expect(project.items.map((i) => i.title)).toEqual(['Sauerteig Brot backen']);
    expect(all.topics.slice(0, 2)).toEqual([
      { id: 'brot', name: 'brot', count: 3 },
      { id: 'fahrrad', name: 'fahrrad', count: 2 },
    ]);
    expect((await history.list({ topic: 'fahrrad' })).total).toBe(2);
  });

  it('finds a word from a message, any case, with the words around it', async () => {
    const history = createChatHistory(dir);
    await history.importFrom(FIXTURES);
    const hit = await history.list({ q: 'STOCKGARE' });
    expect(hit.items.map((i) => i.title)).toEqual(['Sauerteig Brot backen']);
    expect(hit.items[0].snippet).toContain('das Stichwort ist Stockgare');
    expect((await history.list({ q: 'brot sodabrot' })).total).toBe(1);
    expect((await history.list({ q: 'pumpernickel' })).total).toBe(0);
  });

  it('opens a conversation, survives a restart and replaces on re-import', async () => {
    await createChatHistory(dir).importFrom(path.join(FIXTURES, 'claude'));
    const history = createChatHistory(dir); // as after a restart: read back from disk
    const id = 'claude:11111111-0000-4000-8000-000000000002';
    expect((await history.get(id)).messages).toHaveLength(2);
    expect(await history.get('claude:nope')).toBeNull();

    const changed = json('claude/conversations.json').slice(1, 2);
    changed[0].name = 'Umbenannt';
    fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify(changed));
    const report = await history.importFrom(path.join(dir, 'conversations.json'));
    expect(report.counts).toEqual({ claude: 3, chatgpt: 0 });
    expect((await history.get(id)).title).toBe('Umbenannt');
    expect((await createChatHistory(dir).list()).total).toBe(3);
  });

  it('says what is wrong with a path', async () => {
    const history = createChatHistory(dir);
    await expect(history.importFrom(path.join(dir, 'missing'))).rejects.toThrow('not found');
    await expect(history.importFrom(dir)).rejects.toThrow('No conversations.json');
    fs.writeFileSync(path.join(dir, 'export.zip'), '');
    await expect(history.importFrom(path.join(dir, 'export.zip'))).rejects.toThrow('Unpack');
    fs.writeFileSync(path.join(dir, 'conversations.json'), '{broken');
    expect((await history.importFrom(dir)).files[0].skipped).toEqual({ 'not valid JSON': 1 });
  });

  it('AC-2: a word from one message among 5 000 conversations in under a second', async () => {
    const filler = 'lorem ipsum dolor sit amet consetetur sadipscing elitr sed diam nonumy '.repeat(
      40
    );
    const big = Array.from({ length: 5000 }, (_, n) => ({
      uuid: `u${n}`,
      name: `Verlauf ${n}`,
      updated_at: new Date(1.7e12 + n * 60000).toISOString(),
      chat_messages: Array.from({ length: 6 }, (_, m) => ({
        sender: m % 2 ? 'assistant' : 'human',
        text: filler + (n === 3210 && m === 5 ? ' quittenmarmelade' : ''),
      })),
    }));
    fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify(big));
    await createChatHistory(dir).importFrom(dir);
    const history = createChatHistory(dir);
    const cold = Date.now();
    const hit = await history.list({ q: 'quittenmarmelade' });
    const coldMs = Date.now() - cold;
    const warm = Date.now();
    await history.list({ q: 'quittenmarmelade' });
    const warmMs = Date.now() - warm;
    const bytes = fs.statSync(path.join(dir, 'conversations.jsonl')).size;
    console.log(
      `AC-2: 5000 conversations, ${(bytes / 1e6).toFixed(1)} MB; search cold (incl. loading the store) ${coldMs} ms, warm ${warmMs} ms`
    );
    expect(hit.items.map((i) => i.title)).toEqual(['Verlauf 3210']);
    expect(warmMs).toBeLessThan(1000);
  }, 60000);
});
