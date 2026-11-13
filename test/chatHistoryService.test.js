import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assignTopics,
  createChatHistory,
  detectExport,
  parseAs,
  parseExport,
  NO_TOPIC,
} from '../server/services/chatHistoryService.js';
import { gizmoProjects, stripChatgpt, stripClaude } from '../electron/chatSync.js';

// Invented data in the shape of the official exports; no real conversation, account or project
const FIXTURES = path.join(__dirname, 'fixtures/chat-exports');
const json = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
// Invented data in the shape of the providers' web API detail responses (electron/chatSync.js)
const api = (file) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chat-api', file), 'utf8'));

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

describe('desktop sync: API responses and ingest (#280)', () => {
  const CLAUDE_ID = 'claude:11111111-0000-4000-8000-000000000002';
  const GPT_ID = 'chatgpt:33333333-0000-4000-8000-000000000002';
  const lines = () =>
    fs.readFileSync(path.join(dir, 'conversations.jsonl'), 'utf8').split('\n').filter(Boolean);

  it('reads a claude.ai detail response: current branch, files, no tool blocks', () => {
    const raw = api('claude-conversation.json');
    for (const input of [raw, stripClaude(raw)]) {
      const { conversations, skipped } = parseAs('claude', [input]);
      expect(skipped).toEqual({});
      expect(conversations[0]).toMatchObject({
        id: CLAUDE_ID,
        title: 'Fahrrad Kette wechseln',
        updatedAt: Date.parse('2026-04-02T10:00:00Z'),
        project: '22222222-0000-4000-8000-000000000002',
      });
      expect(conversations[0].messages.map((m) => [m.role, m.text])).toEqual([
        ['user', 'Wie wechsle ich die Kette am Fahrrad?\n[File: kette.jpg]'],
        ['assistant', 'Mit einem Kettennieter: Glied öffnen, neue Kette einfädeln.'],
        ['user', 'Und wie lang muss die neue Kette sein?\n[File: notiz.txt]'],
        ['assistant', 'Großes Blatt, größtes Ritzel, plus zwei Glieder.'],
      ]);
    }
    // only what the parser reads goes to the server
    expect(JSON.stringify(stripClaude(raw))).not.toMatch(/preview_url|extracted_content|thinking/);
  });

  it('reads a ChatGPT detail response: shown path, no tool calls, project name from the sidebar', () => {
    const raw = api('chatgpt-conversation.json');
    const projects = gizmoProjects(api('chatgpt-sidebar.json'));
    expect(projects).toEqual([{ id: 'g-p-0123456789abcdef0123456789abcdef', name: 'Werkstatt' }]);
    const names = new Map(projects.map((p) => [p.id, p.name]));
    for (const input of [raw, stripChatgpt(raw)]) {
      const [conversation] = parseAs('chatgpt', [input], names).conversations;
      expect(conversation).toMatchObject({
        id: GPT_ID,
        updatedAt: 1775120400123,
        projectName: 'Werkstatt',
      });
      expect(conversation.messages.map((m) => m.text)).toEqual([
        'Wie flicke ich einen Reifen?',
        'Loch suchen, anrauen, Flicken drauf.',
        '[image_asset_pointer]\nHier ein Foto vom Ventil',
        'Ein Sclaverand-Ventil: Mutter oben aufdrehen.',
      ]);
    }
    expect(JSON.stringify(stripChatgpt(raw))).not.toMatch(/safe_urls|file-service|request_id/);
  });

  it('a synced conversation replaces the imported one with the same id', async () => {
    const history = createChatHistory(dir);
    await history.importFrom(FIXTURES);
    const result = await history.ingest({
      provider: 'claude',
      conversations: [stripClaude(api('claude-conversation.json'))],
      projects: [{ id: '22222222-0000-4000-8000-000000000002', name: 'Werkstatt' }],
    });
    expect(result).toMatchObject({
      found: 1,
      added: 0,
      updated: 1,
      counts: { claude: 3, chatgpt: 3 },
    });
    const merged = await history.get(CLAUDE_ID);
    expect(merged.messages).toHaveLength(4);
    expect(merged.projectName).toBe('Werkstatt');
    // newest first: the synced change moved it to the top
    expect((await history.list()).items[0].id).toBe(CLAUDE_ID);

    // after a restart the last line of an id wins
    const reread = createChatHistory(dir);
    expect((await reread.list()).total).toBe(6);
    expect((await reread.get(CLAUDE_ID)).messages).toHaveLength(4);
  });

  it('keeps a project name the replacement lacks; appends, compacts once stale outweighs live', async () => {
    const history = createChatHistory(dir);
    const chat = (n, patch = {}) => ({
      id: `claude:c${n}`,
      provider: 'claude',
      title: `Chat ${n}`,
      createdAt: 1,
      updatedAt: 1000 + n,
      project: 'p1',
      projectName: 'Backstube',
      messages: [{ role: 'user', text: `Frage ${n}`, at: null }],
      ...patch,
    });
    expect(await history.upsert([chat(1), chat(2), chat(3)])).toEqual({ added: 3, updated: 0 });
    expect(await history.upsert([chat(1, { projectName: null, updatedAt: 5000 })])).toEqual({
      added: 0,
      updated: 1,
    });
    expect((await history.get('claude:c1')).projectName).toBe('Backstube');
    expect(lines()).toHaveLength(4); // appended, the old line of c1 is stale

    await history.upsert([chat(2, { title: 'Neu 2' }), chat(3, { title: 'Neu 3' })]);
    // 3 stale vs 3 live: rewritten with the live lines only, still readable
    expect(lines()).toHaveLength(3);
    expect((await history.get('claude:c2')).title).toBe('Neu 2');
    expect((await history.get('claude:c1')).messages[0].text).toBe('Frage 1');
    expect((await createChatHistory(dir).list()).items.map((i) => i.id)).toEqual([
      'claude:c1',
      'claude:c3',
      'claude:c2',
    ]);
  });

  it('serialises concurrent writers', async () => {
    const history = createChatHistory(dir);
    const one = (n) => ({
      id: `chatgpt:x${n}`,
      provider: 'chatgpt',
      title: `T${n}`,
      createdAt: n,
      updatedAt: n,
      project: null,
      projectName: null,
      messages: [{ role: 'user', text: `m${n}`, at: null }],
    });
    await Promise.all(Array.from({ length: 20 }, (_, n) => history.upsert([one(n)])));
    const fresh = createChatHistory(dir);
    expect((await fresh.list()).total).toBe(20);
    for (let n = 0; n < 20; n++) expect((await fresh.get(`chatgpt:x${n}`)).title).toBe(`T${n}`);
  });

  it('sync state: stop mark and org per provider, last activity of every stored conversation', async () => {
    const history = createChatHistory(dir);
    await history.importFrom(FIXTURES);
    const before = await history.syncState();
    expect(before.claude.lastUpdatedAt).toBeNull();
    expect(before.claude.known['11111111-0000-4000-8000-000000000001']).toBe(
      Date.parse('2026-01-05T08:10:00Z')
    );
    expect(before.chatgpt.known['33333333-0000-4000-8000-000000000001']).toBe(1767600600000);
    expect(Object.keys(before.chatgpt.known)).toHaveLength(3);

    await history.ingest({
      provider: 'claude',
      conversations: [],
      state: { lastUpdatedAt: 42, orgId: 'org-1' },
    });
    await history.ingest({ provider: 'claude', conversations: [], state: { lastUpdatedAt: 43 } });
    const after = await createChatHistory(dir).syncState();
    expect(after.claude).toMatchObject({ lastUpdatedAt: 43, orgId: 'org-1' });
    expect(after.chatgpt.lastUpdatedAt).toBeNull();
  });
});
