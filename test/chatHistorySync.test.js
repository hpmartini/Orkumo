import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { createChatHistory } from '../server/services/chatHistoryService.js';
import { CHAT_INGEST_TYPE, createChatSync } from '../electron/chatSync.js';

// electron/chatSync.js over real HTTP: a fake claude.ai + chatgpt.com (one server, their paths do
// not overlap) and a store server with the two routes of server/index.js. Invented data only.
const TOKEN = 'secret-access-token-of-the-session';
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const iso = (n) => new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();

/** Provider data; `updated` in minutes after 2026-01-01, lists newest first */
function fakeProviders() {
  const claude = new Map();
  const chatgpt = new Map();
  const state = {
    claude,
    chatgpt,
    requests: [],
    claudeLogin: true,
    chatgptLogin: true,
    failDetail: new Set(),
    htmlFor: null,
  };
  const newest = (map) => [...map.values()].sort((a, b) => b.updated - a.updated);
  state.handler = (req, res) => {
    const url = new URL(req.url, 'http://x');
    state.requests.push({
      path: url.pathname,
      search: url.search,
      auth: req.headers.authorization,
    });
    const p = url.pathname;
    if (state.htmlFor && p.startsWith(state.htmlFor))
      return send(res, 200, '<html>Log in</html>', 'text/html');
    // claude.ai
    if (p.startsWith('/api/organizations')) {
      if (!state.claudeLogin) return send(res, 403, { type: 'error' });
      if (p === '/api/organizations')
        return send(res, 200, [
          { uuid: 'bbbbbbbb-0000-4000-8000-000000000009', name: 'API', capabilities: ['api'] },
          { uuid: ORG, name: 'Mine', capabilities: ['chat', 'claude_pro'] },
        ]);
      if (p === `/api/organizations/${ORG}/projects`)
        return send(res, 200, [{ uuid: 'p-1', name: 'Backstube' }]);
      if (p === `/api/organizations/${ORG}/chat_conversations`) {
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit'));
        return send(
          res,
          200,
          newest(claude)
            .slice(offset, offset + limit)
            .map((c) => ({ uuid: c.id, name: c.name, updated_at: iso(c.updated) }))
        );
      }
      const id = p.split('/').pop();
      const c = claude.get(id);
      if (!c || state.failDetail.has(id)) return send(res, 500, { error: 'boom' });
      return send(res, 200, {
        uuid: c.id,
        name: c.name,
        created_at: iso(0),
        updated_at: iso(c.updated),
        project_uuid: 'p-1',
        account: { email_address: 'someone@example.org' },
        chat_messages: [
          { uuid: 'm1', sender: 'human', text: `Frage ${c.name}`, created_at: iso(0) },
          { uuid: 'm2', sender: 'assistant', text: `Antwort v${c.updated}`, created_at: iso(1) },
        ],
      });
    }
    // chatgpt.com
    if (p === '/api/auth/session')
      return send(
        res,
        200,
        state.chatgptLogin ? { accessToken: TOKEN, user: { email: 'someone@example.org' } } : {}
      );
    if (p.startsWith('/backend-api/')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, {});
      if (p === '/backend-api/gizmos/snorlax/sidebar') return send(res, 200, { items: [] });
      if (p === '/backend-api/conversations') {
        const offset = Number(url.searchParams.get('offset'));
        // the real server caps pages below the asked limit: `total` must drive the paging
        const all = newest(chatgpt);
        return send(res, 200, {
          items: all
            .slice(offset, offset + 28)
            .map((c) => ({ id: c.id, title: c.name, update_time: iso(c.updated) })),
          total: all.length,
          limit: 28,
          offset,
        });
      }
      const id = p.split('/').pop();
      const c = chatgpt.get(id);
      if (!c) return send(res, 404, {});
      return send(res, 200, {
        conversation_id: c.id,
        title: c.name,
        create_time: Date.UTC(2026, 0, 1) / 1000,
        // float seconds here, ISO in the list: the same moment spelled differently
        update_time: (Date.UTC(2026, 0, 1) + c.updated * 60_000) / 1000 + 0.000123,
        current_node: 'a',
        mapping: {
          u: {
            parent: null,
            message: { author: { role: 'user' }, content: { parts: [`Q ${c.name}`] } },
          },
          a: { parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['A'] } } },
        },
      });
    }
    send(res, 404, {});
  };
  return state;
}

let dir;
let providers;
let fake;
let store;
let history;
let posted;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-sync-'));
  history = createChatHistory(dir);
  posted = [];
  providers = fakeProviders();
  for (let n = 1; n <= 120; n++)
    providers.claude.set(`c-${n}`, { id: `c-${n}`, name: `Claude ${n}`, updated: n });
  for (let n = 1; n <= 70; n++)
    providers.chatgpt.set(`g-${n}`, { id: `g-${n}`, name: `GPT ${n}`, updated: n });
  fake = await listen((req, res) => providers.handler(req, res));
  // the two routes of server/index.js, same contract
  store = await listen(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/chat-history/sync-state')
      return send(res, 200, await history.syncState());
    if (req.method === 'POST' && req.url === '/api/chat-history/ingest') {
      if (req.headers['content-type'] !== CHAT_INGEST_TYPE) return send(res, 415, {});
      let body = '';
      for await (const chunk of req) body += chunk;
      posted.push(body);
      return send(res, 200, await history.ingest(JSON.parse(body)));
    }
    send(res, 404, {});
  });
});

afterEach(async () => {
  await new Promise((r) => fake.close(r));
  await new Promise((r) => store.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const syncer = (extra = {}) => {
  const seen = [];
  const sync = createChatSync({
    providerFetch: (url, init) => {
      seen.push(init);
      return fetch(url, init);
    },
    serverUrl: urlOf(store),
    bases: { claude: urlOf(fake), chatgpt: urlOf(fake) },
    pauseMs: 0,
    ...extra,
  });
  return { ...sync, seen };
};
const claudeDetails = () =>
  providers.requests.filter((r) => /chat_conversations\/[^/]+$/.test(r.path));
const gptDetails = () =>
  providers.requests.filter((r) => r.path.startsWith('/backend-api/conversation/'));
const claudePages = () => providers.requests.filter((r) => r.path.endsWith('/chat_conversations'));
const gptPages = () => providers.requests.filter((r) => r.path === '/backend-api/conversations');

describe('electron/chatSync.js against fake providers (#280)', () => {
  it('first run: pages both lists to the end, fetches every detail, ingests in batches', async () => {
    const progress = [];
    const result = await syncer({ onProgress: (p, s) => progress.push([p, s.status]) }).sync();
    expect(result.claude).toMatchObject({ status: 'ok', added: 120, updated: 0 });
    expect(result.chatgpt).toMatchObject({ status: 'ok', added: 70, updated: 0 });
    expect(claudePages().map((r) => r.search)).toEqual([
      '?limit=50&offset=0',
      '?limit=50&offset=50',
      '?limit=50&offset=100',
    ]);
    expect(gptPages()).toHaveLength(3); // 28 + 28 + 14, from `total`
    expect(claudeDetails()).toHaveLength(120);
    expect(gptDetails()).toHaveLength(70);
    // the org with chat, not the first one
    expect(claudePages()[0].path).toContain(ORG);
    expect(posted.length).toBeGreaterThanOrEqual(19); // batches of ≤10 + the closing state
    expect(posted.every((b) => JSON.parse(b).conversations.length <= 10)).toBe(true);

    const list = await history.list({ limit: 1000 });
    expect(list.counts).toEqual({ claude: 120, chatgpt: 70, orkumo: 0 });
    expect((await history.get('claude:c-7')).projectName).toBe('Backstube');
    const state = await history.syncState();
    expect(state.claude).toMatchObject({ lastUpdatedAt: Date.parse(iso(120)), orgId: ORG });
    expect(state.chatgpt.lastUpdatedAt).toBe(Date.parse(iso(70)));
    expect(progress).toContainEqual(['claude', 'syncing']);
    expect(progress.at(-1)).toEqual(['chatgpt', 'ok']);
  });

  it('next run: stops at the first unchanged conversation, fetches only what changed', async () => {
    await syncer().sync();
    providers.requests.length = 0;
    providers.claude.get('c-5').updated = 500; // edited: jumps to the top
    providers.claude.set('c-new', { id: 'c-new', name: 'Neu', updated: 501 });
    providers.chatgpt.get('g-3').updated = 300;

    const result = await syncer().sync();
    expect(result.claude).toMatchObject({ status: 'ok', added: 1, updated: 1 });
    expect(result.chatgpt).toMatchObject({ status: 'ok', added: 0, updated: 1 });
    expect(claudePages()).toHaveLength(1);
    expect(gptPages()).toHaveLength(1);
    expect(
      claudeDetails()
        .map((r) => r.path.split('/').pop())
        .sort()
    ).toEqual(['c-5', 'c-new']);
    expect(gptDetails().map((r) => r.path.split('/').pop())).toEqual(['g-3']);
    expect((await history.get('claude:c-5')).messages[1].text).toBe('Antwort v500');

    providers.requests.length = 0;
    const idle = await syncer().sync();
    expect(idle.claude).toMatchObject({ status: 'ok', added: 0, updated: 0 });
    expect(claudeDetails()).toHaveLength(0);
    expect(gptDetails()).toHaveLength(0);
  });

  it('conversations already imported with the same last activity are not fetched again', async () => {
    await history.ingest({
      provider: 'claude',
      conversations: [
        {
          uuid: 'c-120',
          name: 'Claude 120 (export)',
          updated_at: iso(120),
          chat_messages: [{ sender: 'human', text: 'aus dem Export' }],
        },
      ],
    });
    await syncer().sync();
    expect(claudeDetails().map((r) => r.path.split('/').pop())).not.toContain('c-120');
    expect((await history.get('claude:c-120')).title).toBe('Claude 120 (export)');
    expect((await history.list({ provider: 'claude' })).total).toBe(120);
  });

  it('needs-login: 403, an empty session, a login page instead of JSON; nothing stored', async () => {
    providers.claudeLogin = false;
    providers.chatgptLogin = false;
    const result = await syncer().sync();
    expect(result.claude).toMatchObject({ status: 'needs-login' });
    expect(result.claude.reason).toContain('claude.ai');
    expect(result.chatgpt).toMatchObject({ status: 'needs-login' });
    expect(gptPages()).toHaveLength(0);

    providers.claudeLogin = true;
    providers.htmlFor = '/api/organizations';
    expect((await syncer().sync()).claude.status).toBe('needs-login');
    expect((await history.list()).total).toBe(0);
  });

  it('a lost detail keeps the stop mark: the next run fetches it again', async () => {
    providers.failDetail.add('c-60');
    const first = await syncer().sync();
    expect(first.claude).toMatchObject({ status: 'error', added: 119 });
    expect(first.claude.reason).toMatch(/1 conversation could not be read \(.*HTTP 500\)/);
    expect((await history.syncState()).claude).toMatchObject({ lastUpdatedAt: null, orgId: ORG });

    providers.failDetail.clear();
    providers.requests.length = 0;
    const second = await syncer().sync();
    expect(second.claude).toMatchObject({ status: 'ok', added: 1 });
    expect(claudeDetails().map((r) => r.path.split('/').pop())).toEqual(['c-60']);
  });

  it('refuses ids that would leave the allowlisted paths', async () => {
    providers.claude.set('../../x', { id: '../../x', name: 'Böse', updated: 999 });
    const result = await syncer().sync();
    expect(result.claude.status).toBe('error');
    expect(result.claude.reason).toContain('outside the allowlist');
    expect(result.claude.added).toBe(120);
    expect(providers.requests.some((r) => r.path.includes('%2F') || r.path.endsWith('/x'))).toBe(
      false
    );
  });

  it('the login stays with the provider requests: never in what reaches the server', async () => {
    const { seen, sync } = syncer();
    await sync();
    expect(seen.every((init) => init.credentials === 'include')).toBe(true);
    expect(gptDetails().every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    const sent = posted.join('\n');
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain('someone@example.org');
    expect(fs.readFileSync(path.join(dir, 'conversations.jsonl'), 'utf8')).not.toContain(TOKEN);
    expect(fs.readFileSync(path.join(dir, 'sync-state.json'), 'utf8')).not.toContain(TOKEN);
  });

  it('one run at a time: a second call shares the running one', async () => {
    const sync = syncer();
    const [a, b] = await Promise.all([sync.sync(), sync.sync()]);
    expect(a).toBe(b);
    expect(claudeDetails()).toHaveLength(120);
  });

  it('server down: both providers report it, no provider request is made', async () => {
    const sync = createChatSync({
      providerFetch: fetch,
      serverUrl: 'http://127.0.0.1:1',
      bases: { claude: urlOf(fake), chatgpt: urlOf(fake) },
      pauseMs: 0,
    });
    const result = await sync.sync();
    expect(result.claude).toMatchObject({ status: 'error', reason: 'Orkumo server not reachable' });
    expect(providers.requests).toHaveLength(0);
  });
});
