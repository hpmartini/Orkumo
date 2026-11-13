/**
 * Chats mode sync (#280): the user's claude.ai and ChatGPT conversations, read through the login
 * of Orkumo's built-in browser (partition `persist:browser-preview`) and handed to the server's
 * chat history (`POST /api/chat-history/ingest`). Neither desktop app keeps its chats on disk in
 * a readable form, so the providers' web APIs are the only automatic source.
 *
 * Runs in the Electron main process because only it holds that browser session: requests go
 * through Chromium's network stack with the profile's cookies, which never leave this process.
 * What goes to the server is conversation data only, stripped to the fields the parser reads
 * (server/services/chatHistoryService.js); tokens are kept in local variables and never logged.
 *
 * Undocumented endpoints, called at a low rate (one request at a time, `pauseMs` apart) and
 * only the ones on the allowlist below. Incremental: the list is read newest first and stops at
 * the first conversation not newer than where the last complete sync stopped; a conversation
 * already stored with the same last activity is not fetched again (imported ones included).
 */

/** Media type of an ingest batch; the server accepts it on that one route (server/index.js) */
export const CHAT_INGEST_TYPE = 'application/vnd.orkumo.chats+json';

export const PROVIDER_BASE = { claude: 'https://claude.ai', chatgpt: 'https://chatgpt.com' };

const LABEL = { claude: 'claude.ai', chatgpt: 'chatgpt.com' };

/** Paths per provider this module may GET; anything else is refused before it is sent */
const ALLOWED = {
  claude: [
    /^\/api\/organizations$/,
    /^\/api\/organizations\/[\w-]+\/projects$/,
    /^\/api\/organizations\/[\w-]+\/chat_conversations$/,
    /^\/api\/organizations\/[\w-]+\/chat_conversations\/[\w-]+$/,
  ],
  chatgpt: [
    /^\/api\/auth\/session$/,
    /^\/backend-api\/conversations$/,
    /^\/backend-api\/conversation\/[\w-]+$/,
    /^\/backend-api\/gizmos\/snorlax\/sidebar$/,
  ],
};

const PAGE = { claude: 50, chatgpt: 100 };
// A list page is cheap, a conversation can be MBs: batches stay well below the route's cap
const BATCH_COUNT = 10;
const BATCH_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 200;
// List and detail may spell the same time differently (ISO vs float seconds); below this a
// conversation counts as unchanged instead of being fetched on every sync
const SAME_TIME_MS = 1000;

/** Seconds (ChatGPT) or ISO strings (Claude, some ChatGPT lists) as ms, like the server's parser */
export const ms = (value) => {
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value ?? '');
  return Number.isFinite(time) ? Math.round(time) : null;
};

/** Why a provider's sync stopped; `fatal` ends that provider's run, else one conversation is lost */
export class SyncStop extends Error {
  /** @param {'needs-login'|'error'} status */
  constructor(status, reason, fatal = status === 'needs-login') {
    super(reason);
    this.status = status;
    this.fatal = fatal;
  }
}

const pick = (obj, keys) =>
  obj && typeof obj === 'object'
    ? Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]))
    : undefined;

const fileNames = (list) =>
  Array.isArray(list)
    ? list.map((f) => ({ file_name: f?.file_name })).filter((f) => typeof f.file_name === 'string')
    : [];

/** A claude.ai detail response reduced to what the parser reads */
export function stripClaude(raw) {
  return {
    ...pick(raw, [
      'uuid',
      'name',
      'created_at',
      'updated_at',
      'project_uuid',
      'current_leaf_message_uuid',
    ]),
    ...(raw?.project ? { project: pick(raw.project, ['uuid', 'name']) } : {}),
    chat_messages: (Array.isArray(raw?.chat_messages) ? raw.chat_messages : []).map((m) => ({
      ...pick(m, ['uuid', 'parent_message_uuid', 'sender', 'text', 'created_at']),
      content: Array.isArray(m?.content)
        ? m.content.filter((b) => b?.type === 'text').map((b) => pick(b, ['type', 'text']))
        : undefined,
      attachments: fileNames(m?.attachments),
      files: fileNames(m?.files),
    })),
  };
}

/** A ChatGPT detail response reduced to what the parser reads (tree, roles, text parts) */
export function stripChatgpt(raw) {
  const mapping = {};
  for (const [key, node] of Object.entries(raw?.mapping ?? {})) {
    const m = node?.message;
    mapping[key] = {
      parent: node?.parent ?? null,
      message: m
        ? {
            author: pick(m.author, ['role']),
            content: m.content && {
              ...pick(m.content, ['content_type', 'text']),
              ...(Array.isArray(m.content.parts)
                ? {
                    parts: m.content.parts.map((p) =>
                      typeof p === 'string' ? p : pick(p, ['content_type', 'text'])
                    ),
                  }
                : {}),
            },
            create_time: m.create_time,
            recipient: m.recipient,
            metadata: m.metadata?.is_visually_hidden_from_conversation
              ? { is_visually_hidden_from_conversation: true }
              : undefined,
          }
        : null,
    };
  }
  return {
    ...pick(raw, [
      'conversation_id',
      'id',
      'title',
      'create_time',
      'update_time',
      'gizmo_id',
      'current_node',
    ]),
    mapping,
  };
}

/** Project names (`g-p-…`) anywhere in the ChatGPT sidebar response; its shape is not known well */
export function gizmoProjects(json) {
  const found = new Map();
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (
      typeof value.id === 'string' &&
      value.id.startsWith('g-p-') &&
      typeof value.display?.name === 'string'
    )
      found.set(value.id, value.display.name);
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, depth + 1);
  };
  walk(json, 0);
  return [...found].map(([id, name]) => ({ id, name }));
}

/**
 * @param {object} options
 * @param {(url: string, init: object) => Promise<Response>} options.providerFetch the built-in
 *   browser session's fetch (cookies of claude.ai / chatgpt.com)
 * @param {string} options.serverUrl Orkumo server on loopback
 * @param {(url: string, init?: object) => Promise<Response>} [options.serverFetch]
 * @param {Record<'claude'|'chatgpt', string>} [options.bases] provider origins (tests: a fake server)
 * @param {number} [options.pauseMs] gap between two provider requests
 * @param {(provider: string, progress: object) => void} [options.onProgress]
 */
export function createChatSync({
  providerFetch,
  serverUrl,
  serverFetch = fetch,
  bases = PROVIDER_BASE,
  pauseMs = 1200,
  onProgress = () => {},
}) {
  let lastRequest = 0;

  async function get(provider, pathAndQuery, headers = {}) {
    const url = new URL(pathAndQuery, bases[provider]);
    if (
      url.origin !== new URL(bases[provider]).origin ||
      !ALLOWED[provider].some((re) => re.test(url.pathname))
    )
      // not fatal: an odd conversation id costs that conversation, not the run
      throw new SyncStop('error', `Refused a request outside the allowlist: ${url.pathname}`);
    const wait = lastRequest + pauseMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    let res;
    try {
      res = await providerFetch(url.href, {
        headers: { accept: 'application/json', ...headers },
        credentials: 'include',
      });
    } catch {
      throw new SyncStop('error', `${LABEL[provider]} not reachable`, true);
    }
    if (res.status === 401 || res.status === 403)
      throw new SyncStop('needs-login', `Log in to ${LABEL[provider]} in the built-in browser`);
    if (res.status === 429)
      throw new SyncStop(
        'error',
        `${LABEL[provider]} asks to slow down; next try in a few minutes`,
        true
      );
    if (!res.ok) throw new SyncStop('error', `${LABEL[provider]} answered HTTP ${res.status}`);
    // a login or challenge page instead of data: the browser has to pass it
    if (!(res.headers.get('content-type') ?? '').includes('json'))
      throw new SyncStop('needs-login', `Log in to ${LABEL[provider]} in the built-in browser`);
    return res.json();
  }

  async function server(path, batch) {
    let res;
    try {
      res = await serverFetch(
        `${serverUrl}${path}`,
        batch
          ? {
              method: 'POST',
              headers: { 'content-type': CHAT_INGEST_TYPE },
              body: JSON.stringify(batch),
            }
          : undefined
      );
    } catch {
      throw new SyncStop('error', 'Orkumo server not reachable', true);
    }
    if (!res.ok)
      throw new SyncStop('error', `Orkumo server refused the chats (HTTP ${res.status})`, true);
    return res.json();
  }

  async function claudeSource(state) {
    const orgs = await get('claude', '/api/organizations');
    const usable = Array.isArray(orgs) ? orgs.filter((o) => typeof o?.uuid === 'string') : [];
    if (usable.length === 0)
      throw new SyncStop('needs-login', 'Log in to claude.ai in the built-in browser');
    const org =
      usable.find((o) => o.uuid === state.orgId) ??
      usable.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) ??
      usable[0];
    const base = `/api/organizations/${encodeURIComponent(org.uuid)}`;
    let projects = [];
    try {
      const list = await get('claude', `${base}/projects`);
      if (Array.isArray(list))
        projects = list
          .filter((p) => typeof p?.uuid === 'string' && typeof p?.name === 'string')
          .map((p) => ({ id: p.uuid, name: p.name }));
    } catch (e) {
      // names are a nicety; a missing login is not
      if (e.status === 'needs-login') throw e;
    }
    return {
      projects,
      state: { orgId: org.uuid },
      async page(offset) {
        const list = await get(
          'claude',
          `${base}/chat_conversations?limit=${PAGE.claude}&offset=${offset}`
        );
        if (!Array.isArray(list))
          throw new SyncStop('error', 'claude.ai sent the chat list in an unknown shape', true);
        return {
          items: list
            .filter((c) => typeof c?.uuid === 'string')
            .map((c) => ({ id: c.uuid, updatedAt: ms(c.updated_at) })),
          read: list.length,
          more: list.length >= PAGE.claude,
        };
      },
      detail: (id) =>
        get(
          'claude',
          `${base}/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages&render_all_tools=true`
        ),
      strip: stripClaude,
    };
  }

  async function chatgptSource() {
    const session = await get('chatgpt', '/api/auth/session');
    const token = session?.accessToken;
    if (typeof token !== 'string' || !token)
      throw new SyncStop('needs-login', 'Log in to chatgpt.com in the built-in browser');
    const headers = { authorization: `Bearer ${token}` };
    if (typeof session.account?.id === 'string' && session.account.structure === 'workspace')
      headers['chatgpt-account-id'] = session.account.id;
    let projects = [];
    try {
      projects = gizmoProjects(
        await get('chatgpt', '/backend-api/gizmos/snorlax/sidebar', headers)
      );
    } catch (e) {
      if (e.status === 'needs-login') throw e;
    }
    return {
      projects,
      state: {},
      async page(offset) {
        const data = await get(
          'chatgpt',
          `/backend-api/conversations?offset=${offset}&limit=${PAGE.chatgpt}&order=updated`,
          headers
        );
        const list = data?.items;
        if (!Array.isArray(list))
          throw new SyncStop('error', 'chatgpt.com sent the chat list in an unknown shape', true);
        return {
          items: list
            .filter((c) => typeof c?.id === 'string')
            .map((c) => ({ id: c.id, updatedAt: ms(c.update_time) })),
          read: list.length,
          // the server may cap the page below the asked limit: `total` tells whether more follow
          more:
            list.length > 0 &&
            (typeof data.total === 'number'
              ? offset + list.length < data.total
              : list.length >= PAGE.chatgpt),
        };
      },
      detail: (id) =>
        get('chatgpt', `/backend-api/conversation/${encodeURIComponent(id)}`, headers),
      strip: stripChatgpt,
    };
  }

  /**
   * Conversation ids to fetch, newest first. Stops at the first one not newer than `lastUpdatedAt`
   * (where the last complete sync stopped); skips those stored with the same last activity.
   */
  async function changed(source, { lastUpdatedAt, known = {} }) {
    const queue = [];
    let newest = lastUpdatedAt ?? null;
    let offset = 0;
    for (let pages = 0, more = true; more && pages < MAX_PAGES; pages++) {
      const page = await source.page(offset);
      offset += page.read;
      more = page.more;
      for (const item of page.items) {
        if (item.updatedAt != null) newest = Math.max(newest ?? 0, item.updatedAt);
        if (lastUpdatedAt != null && item.updatedAt != null && item.updatedAt <= lastUpdatedAt) {
          more = false;
          break;
        }
        const have = known[item.id];
        if (have != null && item.updatedAt != null && item.updatedAt <= have + SAME_TIME_MS)
          continue;
        queue.push(item.id);
      }
    }
    return { queue, newest };
  }

  async function syncProvider(provider, state) {
    const tally = { added: 0, updated: 0 };
    const report = (status, extra = {}) => {
      const result = { status, ...tally, ...extra };
      onProgress(provider, result);
      return result;
    };
    report('syncing');
    try {
      const source = provider === 'claude' ? await claudeSource(state) : await chatgptSource();
      const { queue, newest } = await changed(source, state);
      report('syncing', { pending: queue.length });
      let batch = [];
      let bytes = 0;
      let failed = 0;
      let lastFailure = '';
      const flush = async (extraState) => {
        if (batch.length === 0 && !extraState) return;
        const result = await server('/api/chat-history/ingest', {
          provider,
          conversations: batch,
          projects: source.projects,
          ...(extraState ? { state: extraState } : {}),
        });
        tally.added += result.added;
        tally.updated += result.updated;
        batch = [];
        bytes = 0;
      };
      for (const [i, id] of queue.entries()) {
        try {
          const conversation = source.strip(await source.detail(id));
          batch.push(conversation);
          bytes += JSON.stringify(conversation).length;
        } catch (e) {
          if (!(e instanceof SyncStop) || e.fatal) throw e;
          failed++;
          lastFailure = e.message;
        }
        if (batch.length >= BATCH_COUNT || bytes >= BATCH_BYTES) {
          await flush();
          report('syncing', { pending: queue.length - i - 1 });
        }
      }
      // The stop mark moves only when every changed conversation arrived: a lost one is retried
      await flush({
        ...source.state,
        ...(failed === 0 && newest != null ? { lastUpdatedAt: newest } : {}),
      });
      return failed
        ? report('error', {
            reason: `${failed} conversation${failed === 1 ? '' : 's'} could not be read (${lastFailure}); retried at the next sync`,
          })
        : report('ok', { syncedAt: Date.now() });
    } catch (e) {
      if (!(e instanceof SyncStop)) console.error(`[chat-sync] ${provider}:`, e?.message ?? e);
      return report(e instanceof SyncStop ? e.status : 'error', {
        reason: e instanceof SyncStop ? e.message : 'Sync failed unexpectedly',
      });
    }
  }

  async function run() {
    let state;
    try {
      state = await server('/api/chat-history/sync-state');
    } catch (e) {
      const failed = { status: 'error', added: 0, updated: 0, reason: e.message };
      return { claude: failed, chatgpt: failed };
    }
    // one provider after the other: the low request rate holds across both
    const result = {};
    for (const provider of ['claude', 'chatgpt'])
      result[provider] = await syncProvider(provider, state[provider] ?? { known: {} });
    return result;
  }

  let running = null;
  /** One run at a time: a second caller (interval, Sync now) shares the running one */
  const sync = () => (running ??= run().finally(() => (running = null)));

  return { sync };
}
