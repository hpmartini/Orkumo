/**
 * Codex chat driver: `codex app-server`, JSON-RPC 2.0 over stdio (one JSON object per line),
 * translated into the Claude stream-json event shapes the chat client understands.
 *
 * Protocol (verified against codex-cli 0.151.0): `initialize` → `initialized` notification →
 * `thread/start {cwd}` or `thread/resume {threadId, cwd, excludeTurns}` + `thread/turns/list`
 * (history), then one `turn/start` per user message. The server streams `turn/*` and `item/*`
 * notifications and asks for approvals with server→client requests
 * (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, …), answered with
 * a JSON-RPC result. `turn/interrupt {threadId, turnId}` stops a turn; it then completes with
 * status `interrupted`. No model, sandbox or approval flags: the user's codex config decides
 * (an untrusted folder defaults to a read-only sandbox that asks before writing).
 */

/** Notifications the chat never reads; opted out so codex does not send them */
const OPT_OUT = [
  'hook/completed',
  'hook/started',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'mcpServer/startupStatus/updated',
  'remoteControl/status/changed',
  'turn/diff/updated',
  'turn/moderationMetadata',
];
const FIVE_HOUR_MIN = 300;
const WEEK_MIN = 7 * 24 * 60;

/**
 * Codex RateLimitSnapshot → the status line's `{ fiveHour, weekly }` (usage page shape); `prev`
 * is the last result: rolling updates are sparse and only replace the windows they carry.
 */
export function codexRateLimits(snapshot, prev = null) {
  const windows = [snapshot?.primary, snapshot?.secondary].filter(
    (w) => w && typeof w.usedPercent === 'number'
  );
  const pick = (minutes) => {
    const w = windows.find((x) => x.windowDurationMins === minutes);
    return w
      ? {
          usedPercent: w.usedPercent,
          resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null,
          windowMinutes: minutes,
        }
      : null;
  };
  return {
    fiveHour: pick(FIVE_HOUR_MIN) ?? prev?.fiveHour ?? null,
    weekly: pick(WEEK_MIN) ?? prev?.weekly ?? null,
  };
}

/** Newest turns of a resumed thread shown as history */
const HISTORY_TURNS = 100;
const HISTORY_PAGE = 50;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** One stdout line → JSON-RPC message, or null for blank/garbage lines (never throws) */
export function parseLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

/** `/bin/zsh -lc 'ls -la'` → `ls -la`: codex reports every command wrapped in the login shell */
export function unwrapShell(command) {
  const cmd = str(command);
  const m = /^(?:\S*\/)?(?:ba|z)?sh -l?c (.+)$/s.exec(cmd);
  if (!m) return cmd;
  const arg = m[1];
  if (arg.length > 1 && arg.startsWith("'") && arg.endsWith("'"))
    return arg.slice(1, -1).replace(/'\\''/g, "'");
  if (arg.length > 1 && arg.startsWith('"') && arg.endsWith('"'))
    return arg.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  return arg;
}

/** Unified diff hunks → old/new blocks (context lines on both sides) */
function diffHunks(diff) {
  const hunks = [];
  let hunk = null;
  for (const line of str(diff).split('\n')) {
    if (line.startsWith('@@')) {
      hunk = { old: [], new: [] };
      hunks.push(hunk);
    } else if (hunk) {
      if (line.startsWith('-')) hunk.old.push(line.slice(1));
      else if (line.startsWith('+')) hunk.new.push(line.slice(1));
      else if (line.startsWith(' ')) {
        hunk.old.push(line.slice(1));
        hunk.new.push(line.slice(1));
      }
    }
  }
  return hunks.map((h) => ({ old_string: h.old.join('\n'), new_string: h.new.join('\n') }));
}

/** One file of a codex patch → Claude's Write / Edit / MultiEdit input (the UI renders the diff) */
function fileTool(change) {
  const file_path = str(change?.path);
  const kind = change?.kind?.type;
  const diff = str(change?.diff);
  // An added file's "diff" is its content
  if (kind === 'add') return { name: 'Write', input: { file_path, content: diff } };
  const hunks = diffHunks(diff);
  const extra = change?.kind?.move_path ? { move_path: change.kind.move_path } : {};
  if (kind === 'delete' && !hunks.length)
    return { name: 'Edit', input: { file_path, old_string: diff, new_string: '', ...extra } };
  if (hunks.length === 1) return { name: 'Edit', input: { file_path, ...hunks[0], ...extra } };
  if (hunks.length > 1) return { name: 'MultiEdit', input: { file_path, edits: hunks, ...extra } };
  return { name: 'Edit', input: { file_path, diff, ...extra } };
}

const textOf = (items) =>
  (Array.isArray(items) ? items : [])
    .map((c) => (isObj(c) ? (typeof c.text === 'string' ? c.text : `[${str(c.type)}]`) : ''))
    .filter(Boolean)
    .join('\n');

/** Thread item → tool_use blocks (several for a multi-file patch), or null for non-tool items */
function toolBlocks(item) {
  const id = str(item.id);
  switch (item.type) {
    case 'commandExecution':
      return [{ id, name: 'Bash', input: { command: unwrapShell(item.command) } }];
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return changes.map((c, i) => ({
        id: changes.length === 1 ? id : `${id}#${i}`,
        ...fileTool(c),
      }));
    }
    case 'mcpToolCall':
      return [
        {
          id,
          name: `mcp__${str(item.server)}__${str(item.tool)}`,
          input: isObj(item.arguments) ? item.arguments : { arguments: item.arguments ?? null },
        },
      ];
    case 'dynamicToolCall':
      return [
        {
          id,
          name: item.namespace ? `${item.namespace}.${str(item.tool)}` : str(item.tool),
          input: isObj(item.arguments) ? item.arguments : { arguments: item.arguments ?? null },
        },
      ];
    case 'collabAgentToolCall':
      return [
        {
          id,
          name: str(item.tool),
          input: {
            ...(item.prompt ? { prompt: item.prompt } : {}),
            ...(item.model ? { model: item.model } : {}),
            receiverThreadIds: item.receiverThreadIds ?? [],
          },
        },
      ];
    case 'webSearch': {
      const action = isObj(item.action) ? item.action : {};
      if (action.type === 'open_page')
        return [{ id, name: 'WebFetch', input: { url: str(action.url) } }];
      if (action.type === 'find_in_page') {
        const input = { url: str(action.url), pattern: str(action.pattern) };
        return [{ id, name: 'find_in_page', input }];
      }
      const query =
        str(action.query) ||
        (Array.isArray(action.queries) ? action.queries.join(' | ') : '') ||
        str(item.query);
      return [{ id, name: 'WebSearch', input: { query } }];
    }
    case 'imageView':
      return [{ id, name: 'Read', input: { file_path: str(item.path) } }];
    case 'imageGeneration':
      return [{ id, name: 'image_generation', input: { prompt: str(item.revisedPrompt) } }];
    case 'sleep':
      return [{ id, name: 'sleep', input: { durationMs: item.durationMs ?? null } }];
    default:
      return null;
  }
}

/** Finished tool item → [content, is_error] for its tool_result */
function toolResult(item) {
  switch (item.type) {
    case 'commandExecution': {
      const code = item.exitCode;
      let out = str(item.aggregatedOutput);
      if (item.status === 'declined') out = out || 'Declined';
      if (typeof code === 'number' && code !== 0) out = `${out}${out ? '\n' : ''}Exit code ${code}`;
      const failed = item.status === 'failed' || item.status === 'declined';
      return [out, failed || (typeof code === 'number' && code !== 0)];
    }
    case 'fileChange':
      return [
        { completed: 'Applied', declined: 'Declined', failed: 'Failed' }[item.status] ?? '',
        item.status !== 'completed',
      ];
    case 'mcpToolCall':
      if (item.error) return [str(item.error.message), true];
      return [textOf(item.result?.content), item.status === 'failed'];
    case 'dynamicToolCall':
      return [textOf(item.contentItems), item.success === false || item.status === 'failed'];
    case 'collabAgentToolCall': {
      const states = isObj(item.agentsStates) ? item.agentsStates : {};
      return [
        Object.keys(states).length ? JSON.stringify(states) : str(item.status),
        item.status === 'failed',
      ];
    }
    case 'webSearch': {
      const results = Array.isArray(item.results) ? item.results : [];
      const lines = results
        .filter(isObj)
        .map((r) => [str(r.title), str(r.url)].filter(Boolean).join(' — '))
        .filter(Boolean);
      return [lines.join('\n'), false];
    }
    case 'imageGeneration':
      return [
        str(item.savedPath) || str(item.failure?.message) || str(item.status),
        Boolean(item.failure),
      ];
    default:
      return ['', false];
  }
}

/** Text of a user message's input parts */
function userText(content) {
  return (Array.isArray(content) ? content : [])
    .map((c) => {
      if (!isObj(c)) return '';
      if (c.type === 'text') return str(c.text);
      if (c.type === 'localImage' || c.type === 'localAudio') return str(c.path);
      if (c.type === 'image' || c.type === 'audio') return str(c.url);
      if (c.type === 'skill' || c.type === 'mention') return `$${str(c.name)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const reasoningText = (item) =>
  (item.summary?.length ? item.summary : (item.content ?? []))
    .filter((s) => typeof s === 'string')
    .join('\n\n');

const TODO_STATUS = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' };

/**
 * Item stream of one turn → Claude message events. Blocks group into assistant messages
 * (`<turnId>:<n>`); a tool result or a permission request starts the next message, like a Claude
 * API response ends at a tool call. Every block's final `assistant` event goes out exactly once,
 * in block order: a text/thinking block still streaming when a later block starts is finished
 * with what it has.
 * @param {(event: object) => void} emit
 * @param {{ turnId: string, live: boolean }} opts live: stream_events; history: `history: true`
 */
function createTurn(emit, { turnId, live }) {
  let seg = null;
  let segCount = 0;
  let breakNext = false;
  /** itemId → { kind: 'text'|'thinking', text, msgId?, index?, done, part } */
  const texts = new Map();
  /** itemId → tool_use blocks already emitted */
  const tools = new Map();
  const stream = (event) => live && emit({ type: 'stream_event', event });
  const final = (msgId, block) =>
    emit({
      type: 'assistant',
      message: { id: msgId, content: [block] },
      ...(live ? {} : { history: true }),
    });
  const finish = (t, text) => {
    t.done = true;
    const body = text || t.text;
    final(
      t.msgId,
      t.kind === 'text' ? { type: 'text', text: body } : { type: 'thinking', thinking: body }
    );
  };
  const finishOpen = () => {
    for (const t of texts.values()) if (!t.done && t.msgId) finish(t);
  };
  const alloc = () => {
    finishOpen();
    if (!seg || breakNext) {
      if (seg) stream({ type: 'message_stop' });
      seg = { id: `${turnId}:${++segCount}`, next: 0 };
      breakNext = false;
      stream({ type: 'message_start', message: { id: seg.id } });
    }
    return { msgId: seg.id, index: seg.next++ };
  };
  const textState = (itemId, kind) => {
    let t = texts.get(itemId);
    if (!t) {
      t = { kind, text: '', done: false, part: 0 };
      texts.set(itemId, t);
    }
    return t;
  };
  const toolStart = (item) => {
    if (tools.has(item.id)) return tools.get(item.id);
    const blocks = toolBlocks(item);
    if (!blocks?.length) return null;
    for (const b of blocks) {
      const at = alloc();
      const block = { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      stream({ type: 'content_block_start', index: at.index, content_block: block });
      final(at.msgId, block);
    }
    tools.set(item.id, blocks);
    return blocks;
  };
  const toolDone = (item) => {
    const blocks = toolStart(item);
    if (!blocks) return;
    const [content, isError] = toolResult(item);
    emit({
      type: 'user',
      message: {
        content: blocks.map((b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content,
          is_error: isError,
        })),
      },
    });
    breakNext = true;
  };
  const textDone = (itemId, kind, text) => {
    const t = texts.get(itemId);
    if (t?.done) return;
    if (t?.msgId) return finish(t, text);
    if (!text) return;
    const at = alloc();
    Object.assign(textState(itemId, kind), at);
    finish(texts.get(itemId), text);
  };
  return {
    /** Streamed text/thinking piece; `part` separates reasoning summary sections */
    delta(itemId, kind, piece, part = 0) {
      if (!piece) return;
      const t = textState(itemId, kind);
      if (t.done) return;
      if (!t.msgId) {
        Object.assign(t, alloc());
        stream({
          type: 'content_block_start',
          index: t.index,
          content_block:
            kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' },
        });
      }
      if (part !== t.part && t.text) piece = `\n\n${piece}`;
      t.part = part;
      t.text += piece;
      stream({
        type: 'content_block_delta',
        index: t.index,
        delta:
          kind === 'text'
            ? { type: 'text_delta', text: piece }
            : { type: 'thinking_delta', thinking: piece },
      });
    },
    started(item) {
      if (!isObj(item)) return;
      // Web search and image items get their query/result only when they finish
      if (!['webSearch', 'imageView', 'imageGeneration'].includes(item.type)) toolStart(item);
    },
    completed(item) {
      if (!isObj(item)) return;
      if (item.type === 'agentMessage' || item.type === 'plan')
        textDone(item.id, 'text', str(item.text));
      else if (item.type === 'reasoning') textDone(item.id, 'thinking', reasoningText(item));
      else if (item.type === 'exitedReviewMode') textDone(item.id, 'text', str(item.review));
      else toolDone(item);
    },
    /** `turn/plan/updated` → a synthetic TodoWrite call (the chat's plan card) */
    plan(id, steps) {
      const todos = (Array.isArray(steps) ? steps : []).map((s) => ({
        content: str(s?.step),
        status: TODO_STATUS[s?.status] ?? 'pending',
      }));
      const at = alloc();
      const block = { type: 'tool_use', id, name: 'TodoWrite', input: { todos } };
      stream({ type: 'content_block_start', index: at.index, content_block: block });
      final(at.msgId, block);
      emit({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: id, content: '', is_error: false }],
        },
      });
      breakNext = true;
    },
    /** Text block for a turn error */
    error(message) {
      const at = alloc();
      final(at.msgId, { type: 'text', text: message });
    },
    /** What follows goes into a new assistant message */
    split() {
      breakNext = true;
    },
    /** tool_use blocks emitted for a started tool item */
    toolsOf(itemId) {
      return tools.get(itemId) ?? null;
    },
    /** Turn over: finish streamed blocks (an interrupted message never completes) */
    close() {
      finishOpen();
      if (seg) stream({ type: 'message_stop' });
      seg = null;
    },
  };
}

/** Turns of a resumed thread (oldest first) → history events */
export function historyEvents(turns) {
  const events = [];
  const emit = (e) => events.push(e);
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!isObj(turn)) continue;
    const t = createTurn(emit, { turnId: str(turn.id), live: false });
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (!isObj(item)) continue;
      if (item.type === 'userMessage') {
        const text = userText(item.content);
        if (!text.trim()) continue;
        t.close();
        emit({ type: 'devorbit_user', text, history: true });
      } else t.completed(item);
    }
    if (turn.status === 'failed' && turn.error?.message) t.error(str(turn.error.message));
    t.close();
  }
  return events;
}

const deadError = () => {
  const error = new Error('Chat session is not running');
  error.status = 400;
  return error;
};

/**
 * Starts `codex app-server` (driver interface: see local contract in chatService.js).
 * @param {{ harness: string, cwd: string, resume: string|null }} opts
 * @param {{ bin: string, spawn: Function, emit: (e: object) => void,
 *   exit: (info: { code: number|null, stderr: string }) => void }} io
 */
export function startDriver(opts, io) {
  const proc = io.spawn(io.bin, ['app-server'], {
    cwd: opts.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let running = true;
  let failed = false;
  let stderr = '';
  let threadId = null;
  let model = null;
  /** Last rate-limit windows: codex sends sparse updates */
  let limits = null;
  let ready = false;
  let nextId = 1;
  /** our request id → response handler */
  const calls = new Map();
  /** control_request id → { rpcId, method, params } */
  const approvals = new Map();
  /** user messages waiting for the handshake or the running turn */
  const queue = [];
  /** { id, startedAt, interrupt, view } of the turn in flight */
  let turn = null;
  let errorCount = 0;
  let planCount = 0;

  const write = (obj) => {
    if (!running || !proc.stdin.writable) throw deadError();
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...obj })}\n`);
  };
  const call = (method, params, onResult) => {
    const id = nextId++;
    calls.set(id, onResult);
    write({ id, method, params });
  };
  const fail = (message) => {
    failed = true;
    stderr = `${stderr}${stderr ? '\n' : ''}${message}`.slice(-4000);
    stop();
  };
  const emitInit = () =>
    io.emit({ type: 'system', subtype: 'init', session_id: threadId, ...(model ? { model } : {}) });

  /** The turn's translator, created on its first event */
  const view = () => {
    if (!turn.view)
      turn.view = createTurn(io.emit, { turnId: turn.id ?? `t${nextId}`, live: true });
    return turn.view;
  };
  const endTurn = (subtype, durationMs) => {
    const t = turn;
    turn = null;
    t.view?.close();
    io.emit({
      type: 'result',
      subtype,
      is_error: subtype !== 'success',
      duration_ms: durationMs ?? Date.now() - t.startedAt,
      session_id: threadId,
    });
    pump();
  };
  const turnError = (message) => {
    if (turn.view) turn.view.error(message);
    else
      io.emit({
        type: 'assistant',
        message: { id: `codex-error-${++errorCount}`, content: [{ type: 'text', text: message }] },
      });
    endTurn('error');
  };
  const sendInterrupt = () => {
    call('turn/interrupt', { threadId, turnId: turn.id }, () => {});
  };
  const pump = () => {
    if (!ready || turn || !queue.length || !running) return;
    const { text, images } = queue.shift();
    turn = { id: null, startedAt: Date.now(), interrupt: false, view: null };
    const mine = turn;
    // Attached images as local files, the way the codex TUI sends a pasted image
    const input = [
      ...(text ? [{ type: 'text', text, text_elements: [] }] : []),
      ...images.map((i) => ({ type: 'localImage', path: i.path })),
    ];
    call('turn/start', { threadId, input }, (msg) => {
      if (turn !== mine) return;
      if (msg.error) return turnError(str(msg.error.message) || 'turn/start failed');
      turn.id ??= str(msg.result?.turn?.id) || null;
      if (turn.interrupt && turn.id) sendInterrupt();
    });
  };

  const afterThread = (result) => {
    threadId = str(result?.thread?.id);
    model = str(result?.model) || null;
    if (!threadId) return fail('codex app-server: no thread id');
    emitInit();
    if (!opts.resume) {
      ready = true;
      return pump();
    }
    const collected = [];
    const page = (cursor) =>
      call(
        'thread/turns/list',
        {
          threadId,
          limit: HISTORY_PAGE,
          sortDirection: 'desc',
          itemsView: 'full',
          ...(cursor ? { cursor } : {}),
        },
        (msg) => {
          if (msg.error) return fail(`codex thread/turns/list: ${str(msg.error.message)}`);
          collected.push(...(msg.result?.data ?? []));
          const next = msg.result?.nextCursor;
          if (next && collected.length < HISTORY_TURNS) return page(next);
          const turns = collected.slice(0, HISTORY_TURNS).reverse();
          for (const event of historyEvents(turns)) io.emit(event);
          ready = true;
          pump();
        }
      );
    page(null);
  };

  const respond = (id, result) => write({ id, result });
  /** Server → client request: approvals become control_requests, the rest is refused */
  const onRequest = (msg) => {
    const p = isObj(msg.params) ? msg.params : {};
    const requestId = `codex-${msg.id}`;
    const ask = (request) => {
      approvals.set(requestId, { rpcId: msg.id, method: msg.method, params: p });
      if (turn) view().split();
      io.emit({
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'can_use_tool', ...request },
      });
    };
    if (msg.method === 'item/commandExecution/requestApproval') {
      const always = alwaysDecision(p);
      ask({
        tool_name: 'Bash',
        input: {
          command: unwrapShell(p.command),
          ...(p.kind === 'writeStdin' ? { kind: 'writeStdin' } : {}),
        },
        ...(p.reason ? { description: p.reason, decision_reason: p.reason } : {}),
        ...(always ? { permission_suggestions: [always] } : {}),
      });
    } else if (msg.method === 'item/fileChange/requestApproval') {
      const blocks = turn?.view?.toolsOf(p.itemId) ?? null;
      const tool =
        blocks?.length === 1
          ? blocks[0]
          : {
              name: 'apply_patch',
              input: { files: (blocks ?? []).map((b) => b.input.file_path) },
            };
      const reason = [str(p.reason), p.grantRoot ? `Write access to ${p.grantRoot}` : '']
        .filter(Boolean)
        .join('\n');
      ask({
        tool_name: tool.name,
        input: tool.input,
        ...(reason ? { description: reason, decision_reason: reason } : {}),
        permission_suggestions: ['acceptForSession'],
      });
    } else if (msg.method === 'item/permissions/requestApproval') {
      ask({
        tool_name: 'permissions',
        input: isObj(p.permissions) ? p.permissions : {},
        ...(p.reason ? { description: p.reason, decision_reason: p.reason } : {}),
        permission_suggestions: ['session'],
      });
    } else if (msg.method === 'mcpServer/elicitation/request') {
      ask({
        tool_name: `mcp__${str(p.serverName)}`,
        input: { message: str(p.message), ...(p.url ? { url: p.url } : {}) },
        description: str(p.message),
      });
    } else {
      const message = `${msg.method} is not supported by this client`;
      write({ id: msg.id, error: { code: -32601, message } });
    }
  };

  const onNotification = (msg) => {
    const p = isObj(msg.params) ? msg.params : {};
    if (p.threadId && threadId && p.threadId !== threadId) return;
    switch (msg.method) {
      case 'turn/started':
        if (turn && !turn.id) {
          turn.id = str(p.turn?.id) || null;
          if (turn.interrupt && turn.id) sendInterrupt();
        }
        return;
      case 'item/started':
        if (turn && p.item?.type !== 'userMessage') {
          view().started(p.item);
        }
        return;
      case 'item/completed':
        if (turn && p.item?.type !== 'userMessage') view().completed(p.item);
        return;
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
        if (turn) view().delta(p.itemId, 'text', str(p.delta));
        return;
      case 'item/reasoning/summaryTextDelta':
        if (turn) view().delta(p.itemId, 'thinking', str(p.delta), p.summaryIndex ?? 0);
        return;
      case 'item/reasoning/textDelta':
        if (turn) view().delta(p.itemId, 'thinking', str(p.delta), p.contentIndex ?? 0);
        return;
      case 'turn/plan/updated':
        if (turn) view().plan(`plan-${str(p.turnId)}-${++planCount}`, p.plan);
        return;
      case 'error':
        if (turn && !p.willRetry) turn.lastError = str(p.error?.message);
        return;
      case 'model/rerouted':
        if (p.toModel && p.toModel !== model) {
          model = p.toModel;
          emitInit();
        }
        return;
      case 'thread/tokenUsage/updated': {
        // The last request's prompt + answer is what the context holds now
        const usage = p.tokenUsage;
        const tokens = usage?.last?.totalTokens;
        if (typeof tokens === 'number' && usage.modelContextWindow > 0)
          io.emit({
            type: 'devorbit_usage',
            context: { tokens, window: usage.modelContextWindow },
          });
        return;
      }
      case 'account/rateLimits/updated':
        limits = codexRateLimits(p.rateLimits, limits);
        io.emit({ type: 'devorbit_usage', limits });
        return;
      case 'turn/completed': {
        if (!turn) return;
        const t = p.turn ?? {};
        if (t.status === 'failed') {
          const message = str(t.error?.message) || turn.lastError || 'Turn failed';
          view().error(message);
          return endTurn('error', t.durationMs ?? undefined);
        }
        const subtype = t.status === 'interrupted' ? 'error_during_execution' : 'success';
        return endTurn(subtype, t.durationMs ?? undefined);
      }
      case 'serverRequest/resolved':
        // Answered elsewhere or dropped by an interrupt: a late answer has nothing to resolve
        for (const [key, a] of approvals) if (a.rpcId === p.requestId) approvals.delete(key);
        return;
      default:
    }
  };

  const handle = (msg) => {
    if (msg.method && msg.id !== undefined && msg.id !== null) return onRequest(msg);
    if (msg.method) return onNotification(msg);
    if (msg.id !== undefined && calls.has(msg.id)) {
      const onResult = calls.get(msg.id);
      calls.delete(msg.id);
      onResult(msg);
    }
  };

  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const msg = parseLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (!msg) continue;
      try {
        handle(msg);
      } catch (error) {
        // A bug here must not take the server down; keep it for the exit report
        stderr = `${stderr}\ncodex driver: ${error?.message ?? error}`.slice(-4000);
      }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const onEnd = (code) => {
    if (!running) return;
    running = false;
    // A failed handshake is an error even when our SIGTERM ended the process
    io.exit({ code: failed && !code ? 1 : (code ?? null), stderr });
  };
  proc.on('exit', onEnd);
  proc.on('error', (error) => {
    stderr += `\n${error.message}`;
    onEnd(-1);
  });
  proc.stdin.on('error', () => {
    // EPIPE after the process died; onEnd reports it
  });

  let stopping = false;
  function stop() {
    if (!running || stopping) return;
    stopping = true;
    try {
      proc.stdin.end();
      proc.kill('SIGTERM');
    } catch {
      // already gone
    }
    setTimeout(() => {
      if (running) proc.kill('SIGKILL');
    }, 3000).unref?.();
  }

  call(
    'initialize',
    {
      clientInfo: { name: 'devorbit', title: 'DevOrbit', version: '1.0.0' },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
        optOutNotificationMethods: OPT_OUT,
      },
    },
    (msg) => {
      if (msg.error) return fail(`codex initialize: ${str(msg.error.message)}`);
      write({ method: 'initialized' });
      // Own id outside the numbered requests: a side query, not part of the thread's sequence
      calls.set('rate-limits', (res) => {
        if (res.error || !isObj(res.result)) return;
        limits = codexRateLimits(res.result.rateLimits, limits);
        io.emit({ type: 'devorbit_usage', limits });
      });
      write({ id: 'rate-limits', method: 'account/rateLimits/read' });
      if (opts.resume)
        call(
          'thread/resume',
          { threadId: opts.resume, cwd: opts.cwd, excludeTurns: true },
          (res) =>
            res.error
              ? fail(`codex thread/resume: ${str(res.error.message)}`)
              : afterThread(res.result)
        );
      else
        call('thread/start', { cwd: opts.cwd }, (res) =>
          res.error
            ? fail(`codex thread/start: ${str(res.error.message)}`)
            : afterThread(res.result)
        );
    }
  );

  return {
    send(text, images = []) {
      if (!running) throw deadError();
      queue.push({ text, images });
      pump();
    },
    interrupt() {
      if (!running) throw deadError();
      if (!turn) return;
      if (turn.id) sendInterrupt();
      else turn.interrupt = true;
    },
    answer(requestId, decision) {
      if (!running) throw deadError();
      const pending = approvals.get(requestId);
      if (!pending) return;
      approvals.delete(requestId);
      respond(pending.rpcId, approvalResult(pending, decision));
    },
    stop,
  };
}

/** "Always" for a command: session approval, else the proposed exec policy rule; null if neither */
function alwaysDecision(params) {
  const offered = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
  if (!offered) {
    const rule = params.proposedExecpolicyAmendment;
    return Array.isArray(rule) && rule.length
      ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: rule } }
      : 'acceptForSession';
  }
  if (offered.includes('acceptForSession')) return 'acceptForSession';
  return offered.find((d) => isObj(d) && d.acceptWithExecpolicyAmendment) ?? null;
}

/** allow / always / deny → the JSON-RPC result codex expects for this request */
function approvalResult({ method, params }, decision) {
  if (method === 'item/commandExecution/requestApproval') {
    const offered = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
    if (decision === 'always') return { decision: alwaysDecision(params) ?? 'accept' };
    if (decision === 'allow') return { decision: 'accept' };
    // decline: the model hears no and goes on; cancel (ends the turn too) if decline is not offered
    return { decision: !offered || offered.includes('decline') ? 'decline' : 'cancel' };
  }
  if (method === 'item/fileChange/requestApproval')
    return { decision: { allow: 'accept', always: 'acceptForSession', deny: 'decline' }[decision] };
  if (method === 'item/permissions/requestApproval') {
    const granted = {};
    if (decision !== 'deny')
      for (const [key, value] of Object.entries(params.permissions ?? {}))
        if (value != null) granted[key] = value;
    return { permissions: granted, scope: decision === 'always' ? 'session' : 'turn' };
  }
  // mcpServer/elicitation/request
  return decision === 'deny'
    ? { action: 'decline', content: null, _meta: null }
    : { action: 'accept', content: params.mode === 'url' ? null : {}, _meta: null };
}
