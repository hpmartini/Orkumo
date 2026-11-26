/**
 * API client for the Claude Code agent view (`/api/agents/*`).
 */
import type { HarnessModel } from '@hpmartini/agents-ui/utils/modelMatrix';
import { API_BASE_URL } from '../utils/apiConfig';
import { agentApiUrl, getAgentTarget, pinTarget, targetOf } from '../utils/agentTarget';
import { fitImage } from '@hpmartini/agents-ui/utils/imageFit';
import { PROMPT_IMAGE_TYPES, type StoredAttachment } from '@hpmartini/agents-ui/utils/composer';
import type {
  AgentsResponse,
  AgentDispatchRequest,
  AgentDispatchResult,
  AgentLogs,
  AgentRemoveResult,
  AgentDaemonStatus,
  AgentSubagent,
  AgentRepo,
  AgentSlashCommand,
  AgentPastSession,
  AgentViewSettings,
  AgentSession,
  AgentNotification,
  AgentContext,
  AgentOrphanServer,
  AgentServerStats,
  AgentHarness,
} from '@hpmartini/agents-ui/types';
import type {
  ChatArtifact,
  ChatArtifacts,
  ChatHandlers,
  ChatStatus,
  ChatSummary,
  ClaudeArtifact,
  HandoffResetJob,
  QuickAgent,
} from '@hpmartini/agents-ui';

const API_BASE = API_BASE_URL;

/** `/agents...` goes to the session's instance (#220, utils/agentTarget); everything else stays local */
const apiUrl = (path: string, id?: string) =>
  path.startsWith('/agents') ? agentApiUrl(path, id) : `${API_BASE}${path}`;

/** Remembers the instance of every listed id, so its tab keeps talking there after a switch */
const pinAll = <T extends { id: string }>(items: T[], target: string): T[] => {
  items.forEach((item) => pinTarget(item.id, target));
  return items;
};

/** `id`: session the call is about when the path has none (it then goes to that session's instance) */
async function request<T>(path: string, init?: RequestInit, id?: string): Promise<T> {
  const response = await fetch(apiUrl(path, id), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    const error = new Error(message) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}

function query(params: Record<string, string | boolean | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function fetchAgents(
  options: { cwd?: string | null; all?: boolean } = {}
): Promise<AgentsResponse> {
  const target = getAgentTarget();
  return request<AgentsResponse>(`/agents${query({ cwd: options.cwd, all: options.all })}`).then(
    (data) => {
      pinAll(data.sessions ?? [], target);
      return data;
    }
  );
}

export async function fetchAgentsRawJson(
  options: { cwd?: string | null; all?: boolean } = {}
): Promise<string> {
  const response = await fetch(
    `${agentApiUrl('/agents/json')}${query({ cwd: options.cwd, all: options.all })}`
  );
  if (!response.ok) throw new Error('Failed to fetch agents JSON');
  return response.text();
}

/** `fresh`: wait for a recompute (after a session changed) instead of the server's cached result */
export async function fetchAgentContexts({ fresh = false } = {}): Promise<
  Record<string, AgentContext>
> {
  const { contexts } = await request<{ contexts: Record<string, AgentContext> }>(
    `/agents/context${fresh ? '?fresh=1' : ''}`
  );
  return contexts;
}

export async function fetchOrphanServers(): Promise<AgentOrphanServer[]> {
  return (await request<{ servers: AgentOrphanServer[] }>('/agents/servers/orphans')).servers;
}

export function stopOrphanServer(pid: number): Promise<{ stopped: number }> {
  return request(`/agents/servers/${pid}/stop`, { method: 'POST' });
}

/** CPU/memory per server pid; pids that vanished are missing from the result. */
export async function fetchServerStats(
  pids: number[],
  signal?: AbortSignal
): Promise<AgentServerStats[]> {
  const { stats } = await request<{ stats: AgentServerStats[] }>(
    `/agents/servers/stats${query({ pids: pids.join(',') })}`,
    { signal }
  );
  return stats;
}

export function dispatchAgent(body: AgentDispatchRequest): Promise<AgentDispatchResult> {
  const target = getAgentTarget();
  return request<AgentDispatchResult>('/agents/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((result) => pinAll([result], target)[0]);
}

/**
 * Stores an image for a prompt and returns its server path; large images are scaled down first.
 * `session`: the agent the prompt goes to; the file must sit on its instance (else the picker's)
 */
export async function uploadAgentImage(file: Blob, session?: string): Promise<string> {
  const image = await fitImage(file);
  const data = await request<{ path: string }>(
    '/agents/images',
    {
      method: 'POST',
      headers: { 'Content-Type': image.type || 'application/octet-stream' },
      body: image,
    },
    session
  );
  return data.path;
}

/** Stores a PDF / text / code file for a prompt (#19 AK-3) and returns its server path */
export async function uploadAgentFile(file: File, session?: string): Promise<string> {
  const data = await request<{ path: string }>(
    `/agents/files${query({ name: file.name || 'file.txt' })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    },
    session
  );
  return data.path;
}

/** Stores one composer attachment: the four image types as image, everything else as file */
export async function uploadAttachment(file: File, session?: string): Promise<StoredAttachment> {
  return PROMPT_IMAGE_TYPES.includes(file.type)
    ? { path: await uploadAgentImage(file, session), kind: 'image' }
    : { path: await uploadAgentFile(file, session), kind: 'file' };
}

export function openCloudSession(target?: string): Promise<{ args: string[] }> {
  return request<{ args: string[] }>('/agents/cloud-session', {
    method: 'POST',
    body: JSON.stringify({ target: target || null }),
  });
}

export function fetchAgentLogs(id: string, lines = 40): Promise<AgentLogs> {
  return request<AgentLogs>(`/agents/${encodeURIComponent(id)}/logs${query({ lines })}`);
}

export function replyToAgent(
  id: string,
  text: string,
  mode: 'auto' | 'attach' | 'resume' = 'auto'
): Promise<{ delivered: boolean; queued?: boolean; mode: string; output?: string }> {
  return request(`/agents/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text, mode }),
  });
}

export function stopAgent(id: string): Promise<{ output: string }> {
  return request(`/agents/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

/** Ends the agent pane `paneId` runs, also while the pane is closed (closing only detaches) */
export function stopPane(paneId: string): Promise<{ stopped: number }> {
  return request(`/agents/panes/${encodeURIComponent(paneId)}/stop`, { method: 'POST' }, paneId);
}

/** Types `text` into the agent pane `paneId` runs and submits it */
export function sendToPane(paneId: string, text: string): Promise<{ delivered: boolean }> {
  return request(
    `/agents/panes/${encodeURIComponent(paneId)}/message`,
    { method: 'POST', body: JSON.stringify({ text }) },
    paneId
  );
}

const handoffResetPath = (paneId: string) =>
  `/agents/panes/${encodeURIComponent(paneId)}/handoff-reset`;

/** Handoff + Reset: the agent in pane `paneId` writes a handoff, the pane is reset and continues (server job) */
export async function startHandoffReset(paneId: string): Promise<HandoffResetJob> {
  const { job } = await request<{ job: HandoffResetJob }>(
    handoffResetPath(paneId),
    { method: 'POST' },
    paneId
  );
  return job;
}

/** The pane's last Handoff + Reset job (kept a while after it ended); null when there is none */
export async function fetchHandoffReset(paneId: string): Promise<HandoffResetJob | null> {
  const { job } = await request<{ job: HandoffResetJob | null }>(
    handoffResetPath(paneId),
    undefined,
    paneId
  );
  return job;
}

/** Cancels the pane's active Handoff + Reset job */
export async function cancelHandoffReset(paneId: string): Promise<HandoffResetJob> {
  const { job } = await request<{ job: HandoffResetJob }>(
    handoffResetPath(paneId),
    { method: 'DELETE' },
    paneId
  );
  return job;
}

/** Quick window (#251): starts the default harness in ~ with `prompt` as its first message */
export function startQuickAgent(prompt: string): Promise<QuickAgent> {
  return request('/agents/quick', { method: 'POST', body: JSON.stringify({ prompt }) });
}

export function respawnAgent(id: string): Promise<{ output: string }> {
  return request(`/agents/${encodeURIComponent(id)}/respawn`, { method: 'POST' });
}

export function respawnAllAgents(): Promise<{ output: string }> {
  return request('/agents/respawn-all', { method: 'POST' });
}

export async function removeAgent(
  id: string,
  options: { discardUnpushed?: string | null; forceRemoveWorktree?: string | null } = {}
): Promise<AgentRemoveResult> {
  const response = await fetch(apiUrl(`/agents/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = (await response.json().catch(() => null)) as
    | AgentRemoveResult
    | { error: string }
    | null;
  if (response.status === 409 && payload && 'removed' in payload) return payload;
  if (!response.ok) {
    throw new Error(payload && 'error' in payload ? payload.error : 'Failed to delete session');
  }
  return payload as AgentRemoveResult;
}

export function renameAgent(id: string, name: string): Promise<{ id: string; name: string }> {
  return request(`/agents/${encodeURIComponent(id)}/name`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function pinAgent(id: string, pinned: boolean): Promise<{ id: string; pinned: boolean }> {
  return request(`/agents/${encodeURIComponent(id)}/pin`, {
    method: 'PUT',
    body: JSON.stringify({ pinned }),
  });
}

export function reorderAgents(ids: string[]): Promise<{ ids: string[] }> {
  return request('/agents/order', { method: 'PUT', body: JSON.stringify({ ids }) });
}

export function fetchAgentDaemon(): Promise<AgentDaemonStatus> {
  return request<AgentDaemonStatus>('/agents/daemon');
}

/** Non-Claude harnesses (#195) and whether their CLI is installed (null: unknown, Docker) */
export function fetchHarnesses(): Promise<{ id: string; installed: boolean | null }[]> {
  return request('/agents/harnesses');
}

export function stopAgentDaemon(options: {
  any?: boolean;
  keepWorkers?: boolean;
}): Promise<{ output: string; code: number }> {
  return request('/agents/daemon/stop', { method: 'POST', body: JSON.stringify(options) });
}

export async function fetchSubagents(cwd?: string | null): Promise<AgentSubagent[]> {
  const data = await request<{ agents: AgentSubagent[] }>(`/agents/subagents${query({ cwd })}`);
  return data.agents;
}

/** Real path of `path` if the server lets the Web-IDE open it; rejects with status 403 otherwise */
export async function checkCodeFolder(path: string): Promise<string> {
  const data = await request<{ path: string }>(`/code/folder${query({ path })}`);
  return data.path;
}

/** `chats`: the folder chats without a project run in (#19), absent on older hosts */
export async function fetchAgentRepos(
  cwd?: string | null
): Promise<{ cwd: string; repos: AgentRepo[]; home?: string; chats?: string }> {
  return request(`/agents/repos${query({ cwd })}`);
}

export async function fetchAgentCommands(
  cwd?: string | null,
  harness?: 'omp'
): Promise<AgentSlashCommand[]> {
  const data = await request<{ commands: AgentSlashCommand[] }>(
    `/agents/commands${query({ cwd, harness })}`
  );
  return data.commands;
}

export async function fetchPastSessions(
  options: { cwd?: string | null; q?: string } = {}
): Promise<AgentPastSession[]> {
  const data = await request<{ sessions: AgentPastSession[] }>(
    `/agents/past${query({ cwd: options.cwd, q: options.q })}`
  );
  return data.sessions;
}

export function fetchAgentViewSettings(): Promise<AgentViewSettings> {
  return request<AgentViewSettings>('/settings/agent-view');
}

export function updateAgentViewSettings(
  partial: Partial<AgentViewSettings>
): Promise<AgentViewSettings> {
  return request<AgentViewSettings>('/settings/agent-view', {
    method: 'PUT',
    body: JSON.stringify(partial),
  });
}

/**
 * Subscribe to the agents SSE stream. Reconnects with backoff.
 */
export function subscribeToAgents(handlers: {
  onSessions: (sessions: AgentSession[]) => void;
  onNotify?: (notification: AgentNotification) => void;
  onError?: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onSettingsChanged?: () => void;
}): () => void {
  let eventSource: EventSource | null = null;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;

  const connect = () => {
    if (closing) return;
    const target = getAgentTarget();
    eventSource = new EventSource(apiUrl('/agents/stream'));
    eventSource.addEventListener('connected', () => {
      attempts = 0;
      handlers.onConnectionChange?.(true);
    });
    eventSource.addEventListener('sessions', (event) => {
      try {
        handlers.onSessions(pinAll(JSON.parse((event as MessageEvent).data), target));
      } catch (err) {
        console.error('Failed to parse agents sessions event', err);
      }
    });
    eventSource.addEventListener('notify', (event) => {
      try {
        handlers.onNotify?.(JSON.parse((event as MessageEvent).data));
      } catch (err) {
        console.error('Failed to parse agents notify event', err);
      }
    });
    // the server moved an orchestrator mark / role along with its pane: the page's copy is stale
    eventSource.addEventListener('settings', () => handlers.onSettingsChanged?.());
    eventSource.addEventListener('agent-error', (event) => {
      try {
        handlers.onError?.(JSON.parse((event as MessageEvent).data).message);
      } catch {
        // ignore
      }
    });
    eventSource.onerror = () => {
      handlers.onConnectionChange?.(false);
      eventSource?.close();
      eventSource = null;
      if (closing || attempts >= 10) return;
      const delay = Math.min(1000 * 2 ** attempts, 30000) + Math.random() * 500;
      attempts += 1;
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closing = true;
    if (timer) clearTimeout(timer);
    eventSource?.close();
  };
}

// ---------------------------------------------------------------------------
// UI view of an agent pane (#189): the server tails the agent's transcript (chatService.js); the
// pane's PTY stays the agent, input is typed into it
// ---------------------------------------------------------------------------

/** Opens (or reuses) the transcript view of the session pane `paneId` runs */
export const openTranscriptView = (
  paneId: string,
  body: { harness: AgentHarness; sessionId: string; cwd: string; name?: string }
) => {
  // The view runs on the pane's instance; its id belongs there too (#220)
  const target = targetOf(paneId);
  return request<ChatSummary>(
    '/agents/chat/view',
    { method: 'POST', body: JSON.stringify(body) },
    paneId
  ).then((chat) => pinAll([chat], target)[0]);
};

const chatPath = (id: string, action = '') =>
  `/agents/chat/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const fetchChatStatus = (id: string) => request<ChatStatus>(chatPath(id, 'status'));

export const fetchChatFiles = (id: string, q: string) =>
  request<{ files: string[] }>(`${chatPath(id, 'files')}?q=${encodeURIComponent(q)}`).then(
    (d) => d.files
  );

export const fetchChatDirs = (id: string, q: string) =>
  request<{ dirs: string[] }>(`${chatPath(id, 'dirs')}?q=${encodeURIComponent(q)}`).then(
    (d) => d.dirs
  );

export const fetchChatShell = (id: string, shellId: string) =>
  request<{ output: string; updatedAt: number; truncated: boolean }>(
    chatPath(id, `shells/${encodeURIComponent(shellId)}`)
  );

export const fetchChatArtifacts = (id: string) =>
  request<{ artifacts: ChatArtifact[]; claudeArtifacts?: ClaudeArtifact[] }>(
    chatPath(id, 'artifacts')
  ).then((d): ChatArtifacts => ({ files: d.artifacts, pages: d.claudeArtifacts ?? [] }));

/** Older turns of a view: the page before cursor `before` (its `devorbit_page` event) */
export const fetchChatHistory = (id: string, before: number) =>
  request<{ events: unknown[]; before: number; more: boolean }>(
    `${chatPath(id, 'history')}?before=${before}`
  );

/** Text of a listed artifact; throws with the server's reason (binary, too large, outside) */
export const fetchChatArtifactContent = (id: string, path: string) =>
  request<{ path: string; content: string; size: number; mtime: number }>(
    `${chatPath(id, 'artifacts/content')}?path=${encodeURIComponent(path)}`
  );

/** Preview URL of an image stored by uploadAgentImage; null for any other path */
/** URL of an image in a chat's tool results (its ref comes from the server) */
export const chatImageUrl = (chatId: string, ref: string): string =>
  agentApiUrl(`${chatPath(chatId, 'images')}/${encodeURIComponent(ref)}`);

/** `chatId`: the chat the image was sent in; it is stored on that chat's instance */
export function agentImageUrl(path: string, chatId?: string): string | null {
  const name = path.split('/').pop() ?? '';
  return /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(name) && path.includes('/agent-images/')
    ? agentApiUrl(`/agents/images/${name}`, chatId)
    : null;
}

type ChatWatch = { chatId: string; handlers: ChatHandlers };

/** Chat SSE of this window to one instance; `subs` are the views it carries */
interface ChatStream {
  client: string;
  source: EventSource | null;
  ready: boolean;
  attempts: number;
  retry: ReturnType<typeof setTimeout> | null;
  subs: Map<string, ChatWatch>;
}

/**
 * One chat SSE per agent target (instance), shared by every view of the window. A stream per
 * view held one of Chromium's 6 HTTP/1.1 connections per host each: with 5 UI views and the
 * agents stream open, every other request (context switch, deletes, polls) queued forever.
 */
const chatStreams = new Map<string, ChatStream>();

const parseData = (e: Event): unknown => {
  try {
    return JSON.parse((e as MessageEvent).data);
  } catch {
    return null; // malformed line: skip
  }
};

function setChatWatch(
  stream: ChatStream,
  sub: string,
  watch: ChatWatch,
  method: 'POST' | 'DELETE'
) {
  return request(chatPath(watch.chatId, 'watch'), {
    method,
    body: JSON.stringify({ client: stream.client, sub }),
  });
}

function startChatWatch(stream: ChatStream, sub: string, watch: ChatWatch) {
  setChatWatch(stream, sub, watch, 'POST').catch((err: { status?: number }) => {
    // 409: the stream reconnected meanwhile, its `ready` watches again
    if (err.status === 404 && stream.subs.get(sub) === watch) watch.handlers.onGone();
  });
}

function connectChatStream(target: string, stream: ChatStream) {
  const source = new EventSource(
    `${API_BASE}${target}/agents/chat/events?client=${encodeURIComponent(stream.client)}`
  );
  stream.source = source;
  source.addEventListener('ready', () => {
    stream.ready = true;
    stream.attempts = 0;
    stream.subs.forEach((watch, sub) => startChatWatch(stream, sub, watch));
  });
  source.addEventListener('watch', (e) => {
    const data = parseData(e) as { sub?: string } | null;
    if (data?.sub) stream.subs.get(data.sub)?.handlers.onOpen();
  });
  source.onmessage = (e) => {
    const data = parseData(e) as { sub?: string; event?: unknown } | null;
    if (data?.sub) stream.subs.get(data.sub)?.handlers.onEvent(data.event);
  };
  source.onerror = () => {
    stream.ready = false;
    // the server may be restarting: its views' ids may be gone, nothing polls them till `watch`
    stream.subs.forEach((watch) => watch.handlers.onClose?.());
    // A dropped stream reconnects on its own; a refused one (CLOSED) gets a new EventSource
    if (source.readyState !== EventSource.CLOSED) return;
    const delay = Math.min(1000 * 2 ** stream.attempts, 30000);
    stream.attempts += 1;
    stream.retry = setTimeout(() => connectChatStream(target, stream), delay);
  };
}

/**
 * Chat event stream of view `id`. Every (re)watch replays the whole history first, so `onOpen`
 * resets the client state; the shared stream re-watches after it reconnects. `onGone` fires
 * once the view is gone (e.g. the server restarted).
 */
export function subscribeToChat(id: string, handlers: ChatHandlers): () => void {
  const target = targetOf(id);
  let stream = chatStreams.get(target);
  if (!stream) {
    stream = {
      client: crypto.randomUUID(),
      source: null,
      ready: false,
      attempts: 0,
      retry: null,
      subs: new Map(),
    };
    chatStreams.set(target, stream);
    connectChatStream(target, stream);
  }
  const sub = crypto.randomUUID();
  const watch = { chatId: id, handlers };
  stream.subs.set(sub, watch);
  if (stream.ready) startChatWatch(stream, sub, watch);

  const own = stream;
  return () => {
    if (own.subs.get(sub) !== watch) return;
    own.subs.delete(sub);
    if (own.subs.size === 0) {
      // Closing the stream ends its watches on the server
      own.source?.close();
      clearTimeout(own.retry ?? undefined);
      chatStreams.delete(target);
    } else if (own.ready) {
      setChatWatch(own, sub, watch, 'DELETE').catch(() => {});
    }
  };
}

const modelLists = new Map<string, Promise<HarnessModel[]>>();

/** Models and effort levels of a harness CLI; read once per page, a failed read retries */
export function fetchHarnessModels(harness: 'claude' | 'omp'): Promise<HarnessModel[]> {
  let list = modelLists.get(harness);
  if (!list) {
    list = request<{ models: HarnessModel[] }>(`/agents/models${query({ harness })}`).then(
      (d) => d.models
    );
    list.catch(() => modelLists.delete(harness));
    modelLists.set(harness, list);
  }
  return list;
}
