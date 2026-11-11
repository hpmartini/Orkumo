/**
 * Chat driver for ACP harnesses (Agent Client Protocol: JSON-RPC 2.0, one message per line over
 * stdio): `omp acp`, `opencode acp`. Translates the ACP session into the Claude stream-json event
 * shapes the chat reducer (`utils/chatEvents.ts`) understands.
 *
 * - Handshake: `initialize`, then `session/new` (fresh) or `session/load` (resume). The agent
 *   replays a loaded session as `session/update` notifications before it answers `session/load`;
 *   those become history events.
 * - One `session/prompt` per user turn; turns sent while one runs wait in a queue.
 * - Agent output (thought/message chunks, tool calls, plans) is folded into assistant messages:
 *   a message ends at the turn end, a user message, or a chunk whose `messageId` differs from the
 *   previous chunk of the same kind. Every finished block goes out once, in order, as an
 *   `assistant` event; tool results follow their tool_use block.
 * - Permission requests (`session/request_permission`) become `control_request` events.
 */
import crypto from 'crypto';

/** CLI arguments per harness */
const HARNESS_ARGS = {
  omp: ['acp'],
  opencode: ['acp'],
};

const PROTOCOL_VERSION = 1;
const STDERR_KEEP = 4000;
const KILL_AFTER_MS = 3000;
const TERMINAL = new Set(['completed', 'failed']);
const TODO_STATUS = new Set(['pending', 'in_progress', 'completed']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (v, n) => str(v).slice(0, n);

/** Drop undefined values so mapped inputs stay minimal */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

const firstString = (...values) => values.find((v) => typeof v === 'string' && v);

/** `{pattern}` of a search call without a known tool name: glob-looking patterns are Glob */
const looksLikeGlob = (pattern) => /[*?{]/.test(pattern) && !/[\\^$()|+]/.test(pattern);

function todoInput(items) {
  return {
    todos: items.filter(isObj).map((t) => ({
      content: str(t.content),
      status: TODO_STATUS.has(t.status) ? t.status : 'pending',
    })),
  };
}

/**
 * ACP tool call (accumulated `tool_call` / `tool_call_update` fields) → Claude tool name + input.
 * Anything without a Claude equivalent keeps the harness's own name and raw input.
 * @param {{ name?: string, title?: string, kind?: string, rawInput?: object, content?: any[],
 *   locations?: any[] }} call
 * @returns {{ name: string, input: object }}
 */
export function mapTool(call) {
  const raw = isObj(call.rawInput) ? call.rawInput : {};
  // omp sends the tool id as `name`; opencode only as the first `title`
  const own = (str(call.name) || str(call.title)).toLowerCase();
  const kind = str(call.kind);
  const location = Array.isArray(call.locations) ? call.locations.find(isObj)?.path : undefined;
  const diff = Array.isArray(call.content)
    ? call.content.find((c) => isObj(c) && c.type === 'diff')
    : undefined;

  if (Array.isArray(raw.todos)) return { name: 'TodoWrite', input: todoInput(raw.todos) };

  if (kind === 'execute' || ['bash', 'shell', 'exec'].includes(own)) {
    return {
      name: 'Bash',
      input: compact({
        command: firstString(raw.command, raw.cmd),
        description: firstString(raw.description),
      }),
    };
  }

  if (kind === 'read' || own === 'read') {
    return {
      name: 'Read',
      input: compact({
        file_path: firstString(raw.file_path, raw.filePath, raw.path, location),
        offset: typeof raw.offset === 'number' ? raw.offset : undefined,
        limit: typeof raw.limit === 'number' ? raw.limit : undefined,
      }),
    };
  }

  if (kind === 'edit' || ['edit', 'write', 'multiedit', 'patch'].includes(own)) {
    const filePath = firstString(raw.file_path, raw.filePath, raw.path, diff?.path, location);
    if (diff && typeof diff.newText === 'string') {
      return typeof diff.oldText === 'string' && diff.oldText
        ? {
            name: 'Edit',
            input: {
              file_path: str(diff.path) || filePath,
              old_string: diff.oldText,
              new_string: diff.newText,
            },
          }
        : {
            name: 'Write',
            input: { file_path: str(diff.path) || filePath, content: diff.newText },
          };
    }
    const oldString = typeof raw.old_string === 'string' ? raw.old_string : raw.oldString;
    const newString = typeof raw.new_string === 'string' ? raw.new_string : raw.newString;
    if (typeof oldString === 'string' && typeof newString === 'string') {
      return {
        name: 'Edit',
        input: compact({ file_path: filePath, old_string: oldString, new_string: newString }),
      };
    }
    if (typeof raw.content === 'string' && filePath) {
      return { name: 'Write', input: { file_path: filePath, content: raw.content } };
    }
  }

  if (kind === 'search' || ['grep', 'glob', 'find', 'search'].includes(own)) {
    const pattern = firstString(raw.pattern, raw.query, raw.regex);
    const glob =
      ['glob', 'find'].includes(own) ||
      (own !== 'grep' && !pattern && typeof raw.path === 'string') ||
      (own !== 'grep' && pattern && raw.include === undefined && looksLikeGlob(pattern));
    if (glob) {
      return {
        name: 'Glob',
        input: compact({
          pattern: pattern ?? firstString(raw.path),
          path: pattern ? firstString(raw.path) : undefined,
        }),
      };
    }
    if (pattern) {
      return {
        name: 'Grep',
        input: compact({
          pattern,
          path: firstString(raw.path),
          glob: firstString(raw.include, raw.glob),
        }),
      };
    }
  }

  if (
    kind === 'fetch' ||
    ['fetch', 'webfetch', 'web_fetch', 'websearch', 'web_search'].includes(own)
  ) {
    if (typeof raw.url === 'string') {
      return {
        name: 'WebFetch',
        input: compact({ url: raw.url, prompt: firstString(raw.prompt) }),
      };
    }
    if (typeof raw.query === 'string') return { name: 'WebSearch', input: { query: raw.query } };
  }

  return { name: str(call.name) || str(call.title) || kind || 'tool', input: raw };
}

/** Text of a finished ACP tool call: the raw output if the harness gives one, else the content */
export function toolResultText(call) {
  const out = call.rawOutput;
  if (typeof out === 'string') return out;
  if (isObj(out)) {
    if (typeof out.output === 'string') return out.output;
    if (typeof out.error === 'string') return out.error;
    if (Array.isArray(out.content)) {
      const text = out.content
        .filter((c) => isObj(c) && c.type === 'text')
        .map((c) => str(c.text))
        .join('\n');
      if (text) return text;
    }
  }
  if (!Array.isArray(call.content)) return '';
  return call.content
    .filter(
      (c) => isObj(c) && c.type === 'content' && isObj(c.content) && c.content.type === 'text'
    )
    .map((c) => str(c.content.text))
    .join('\n');
}

/** ACP slash commands → `devorbit_commands` (agent commands; none is a CLI built-in) */
function commandsEvent(list) {
  return {
    type: 'devorbit_commands',
    commands: list
      .filter((c) => isObj(c) && typeof c.name === 'string' && c.name)
      .map((c) => ({
        name: c.name,
        description: clip(c.description, 600),
        argumentHint: clip(isObj(c.input) ? c.input.hint : '', 200),
        builtin: false,
      })),
  };
}

/** Current model of a `session/new` / `session/load` answer or a config update */
function modelOf(result) {
  if (!isObj(result)) return undefined;
  if (Array.isArray(result.configOptions)) {
    const opt = result.configOptions.find(
      (o) => isObj(o) && (o.id === 'model' || o.category === 'model')
    );
    if (opt && typeof opt.currentValue === 'string' && opt.currentValue) return opt.currentValue;
  }
  if (isObj(result.models) && typeof result.models.currentModelId === 'string')
    return result.models.currentModelId || undefined;
  return undefined;
}

/** JSON-RPC error (or thrown Error) → one readable message including the agent's details */
function errorText(error) {
  const message = str(error?.message) || String(error ?? 'request failed');
  const data = error?.data;
  const detail =
    typeof data === 'string'
      ? data
      : isObj(data)
        ? (firstString(data.details, data.message) ?? JSON.stringify(data).slice(0, 300))
        : '';
  return detail && detail !== message ? `${message}: ${detail}` : message;
}

function deadError() {
  const error = new Error('Chat session is not running');
  error.status = 400;
  return error;
}

/**
 * Start the ACP harness process and handshake.
 * @param {{ harness: string, cwd: string, resume: string|null }} opts
 * @param {{ bin: string, spawn: Function, emit: (event: object) => void,
 *   exit: (info: { code: number|null, stderr: string }) => void }} io
 */
export function startDriver(opts, io) {
  const args = HARNESS_ARGS[opts.harness];
  if (!args) {
    const error = new Error(`No ACP driver for harness ${opts.harness}`);
    error.status = 400;
    throw error;
  }
  // extraArgs: server-chosen options (omp: the skills overlay), never client input
  const proc = io.spawn(io.bin, [...args, ...(io.extraArgs ?? [])], {
    cwd: opts.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const prefix = crypto.randomUUID().slice(0, 8);
  let seq = 0;
  const nextId = (kind) => `acp-${prefix}-${kind}${++seq}`;

  let stderr = '';
  let exited = false;
  let stopped = false;
  let killTimer = null;
  /** the handshake failed: the exit is an error whatever code the process reports */
  let failed = false;
  let ready = false;
  let sessionId = opts.resume || null;
  let model;
  /** Updates before the `session/load` answer are the replayed history */
  let history = Boolean(opts.resume);

  let rpcSeq = 0;
  /** our request id → { resolve, reject } */
  const calls = new Map();
  /** emitted control_request id → { rpcId, options } */
  const permissions = new Map();
  const usedRequestIds = new Set();
  /** user turns waiting for `session/prompt`: { text, images } */
  const queue = [];
  /** the agent takes image content blocks (initialize: promptCapabilities.image) */
  let acceptsImages = false;
  /** running turn: { rpcId, start } */
  let turn = null;
  /** toolCallId → accumulated tool call state */
  const tools = new Map();
  /** open assistant message: { id, entries, emitted, chunkIds } */
  let cur = null;
  /** replayed user message being collected: { messageId, text } */
  let userMsg = null;

  const alive = () => !exited && !stopped;

  function write(obj) {
    if (exited || !proc.stdin?.writable) return;
    try {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...obj })}\n`);
    } catch {
      // EPIPE: the exit handler reports it
    }
  }

  function call(method, params) {
    const id = ++rpcSeq;
    write({ id, method, params });
    return new Promise((resolve, reject) => calls.set(id, { resolve, reject }));
  }

  const emit = (event) => io.emit(history ? { ...event, history: true } : event);
  const live = (event) => {
    if (!history) io.emit({ type: 'stream_event', event });
  };

  // ---- assistant messages -------------------------------------------------------------------

  function openMessage() {
    if (cur) return cur;
    cur = { id: nextId('m'), entries: [], emitted: 0, chunkIds: {} };
    live({ type: 'message_start', message: { id: cur.id } });
    return cur;
  }

  function toolBlock(tool) {
    const { name, input } = mapTool(tool);
    return { type: 'tool_use', id: tool.id, name, input };
  }

  function emitToolResult(tool) {
    if (tool.resultSent) return;
    tool.resultSent = true;
    emit({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: tool.id,
            content: tool.resultText ?? toolResultText(tool),
            is_error: tool.status === 'failed' || tool.forcedError === true,
          },
        ],
      },
      parent_tool_use_id: null,
    });
  }

  /** Emit the finished entries of the open message that are next in line */
  function flush() {
    if (!cur) return;
    while (cur.emitted < cur.entries.length && cur.entries[cur.emitted].done) {
      const entry = cur.entries[cur.emitted++];
      let block;
      if (entry.kind === 'text') block = { type: 'text', text: entry.text };
      else if (entry.kind === 'thinking') block = { type: 'thinking', thinking: entry.text };
      else if (entry.kind === 'todo')
        block = { type: 'tool_use', id: entry.id, name: 'TodoWrite', input: entry.input };
      else block = toolBlock(entry.tool);
      emit({
        type: 'assistant',
        message: { id: cur.id, role: 'assistant', content: [block] },
        parent_tool_use_id: null,
      });
      if (entry.kind === 'todo') {
        emit({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: entry.id, content: '', is_error: false }],
          },
          parent_tool_use_id: null,
        });
      } else if (entry.kind === 'tool') {
        entry.tool.blockSent = true;
        if (TERMINAL.has(entry.tool.status) || entry.tool.forcedError) emitToolResult(entry.tool);
      }
    }
  }

  function closeOpenChunk() {
    const last = cur?.entries[cur.entries.length - 1];
    if (last && (last.kind === 'text' || last.kind === 'thinking')) last.done = true;
  }

  function closeMessage() {
    if (!cur) return;
    for (const entry of cur.entries) entry.done = true;
    flush();
    live({ type: 'message_stop' });
    cur = null;
  }

  function pushEntry(entry, contentBlock) {
    closeOpenChunk();
    const msg = openMessage();
    msg.entries.push(entry);
    live({
      type: 'content_block_start',
      index: msg.entries.length - 1,
      content_block: contentBlock,
    });
    flush();
  }

  function onChunk(kind, update) {
    const content = update.content;
    if (!isObj(content) || content.type !== 'text' || typeof content.text !== 'string') return;
    const messageId = str(update.messageId);
    if (cur && messageId && cur.chunkIds[kind] && cur.chunkIds[kind] !== messageId) closeMessage();
    const msg = openMessage();
    if (messageId) msg.chunkIds[kind] = messageId;
    let last = msg.entries[msg.entries.length - 1];
    if (!last || last.kind !== kind || last.done) {
      last = { kind, text: '', done: false };
      pushEntry(
        last,
        kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' }
      );
    }
    last.text += content.text;
    if (content.text) {
      live({
        type: 'content_block_delta',
        index: msg.entries.indexOf(last),
        delta:
          kind === 'text'
            ? { type: 'text_delta', text: content.text }
            : { type: 'thinking_delta', thinking: content.text },
      });
    }
  }

  /** Merge the fields an ACP tool_call / tool_call_update carries into the tracked call */
  function mergeTool(tool, update) {
    for (const key of ['name', 'kind', 'status', 'rawOutput', 'locations']) {
      if (update[key] !== undefined && update[key] !== null) tool[key] = update[key];
    }
    // opencode's first title is the tool id ("grep"); later ones describe the call ("hi")
    if (!tool.title && typeof update.title === 'string') tool.title = update.title;
    if (isObj(update.rawInput) && (Object.keys(update.rawInput).length || !tool.rawInput))
      tool.rawInput = update.rawInput;
    if (Array.isArray(update.content) && update.content.length) tool.content = update.content;
  }

  function onToolCall(update) {
    const id = str(update.toolCallId);
    if (!id) return;
    let tool = tools.get(id);
    if (!tool) {
      tool = { id, blockSent: false, resultSent: false };
      tools.set(id, tool);
      mergeTool(tool, update);
      const entry = { kind: 'tool', tool, done: TERMINAL.has(tool.status) };
      tool.entry = entry;
      tool.streamed = JSON.stringify(toolBlock(tool));
      pushEntry(entry, toolBlock(tool));
      return;
    }
    mergeTool(tool, update);
    if (!tool.blockSent && cur?.entries.includes(tool.entry)) {
      // Input often arrives with a later update (opencode) or only with the diff (omp edit)
      const block = toolBlock(tool);
      const json = JSON.stringify(block);
      if (json !== tool.streamed) {
        tool.streamed = json;
        live({
          type: 'content_block_start',
          index: cur.entries.indexOf(tool.entry),
          content_block: block,
        });
      }
    }
    if (TERMINAL.has(tool.status)) {
      if (tool.blockSent) emitToolResult(tool);
      else {
        tool.entry.done = true;
        flush();
      }
    }
  }

  function onPlan(update) {
    if (!Array.isArray(update.entries)) return;
    const entry = {
      kind: 'todo',
      id: nextId('plan'),
      input: todoInput(update.entries),
      done: true,
    };
    pushEntry(entry, { type: 'tool_use', id: entry.id, name: 'TodoWrite', input: entry.input });
  }

  function flushUser() {
    // omp replays its injected `<system-reminder …>` notes as user messages too: not prompts
    if (userMsg?.text.trim() && !userMsg.text.trimStart().startsWith('<system-reminder'))
      io.emit({ type: 'devorbit_user', text: userMsg.text, history: true });
    userMsg = null;
  }

  function onUserChunk(update) {
    // Live turns are recorded by the generic layer; only replayed ones are ours
    if (!history) return;
    const content = update.content;
    if (!isObj(content) || content.type !== 'text') return;
    closeMessage();
    const messageId = str(update.messageId);
    if (userMsg && messageId && userMsg.messageId && userMsg.messageId !== messageId) flushUser();
    if (!userMsg) userMsg = { messageId, text: '' };
    userMsg.text += str(content.text);
  }

  function onUpdate(params) {
    const update = isObj(params) ? params.update : null;
    if (!isObj(update)) return;
    const kind = update.sessionUpdate;
    if (kind !== 'user_message_chunk' && kind !== 'available_commands_update') flushUser();
    switch (kind) {
      case 'agent_message_chunk':
        return onChunk('text', update);
      case 'agent_thought_chunk':
        return onChunk('thinking', update);
      case 'user_message_chunk':
        return onUserChunk(update);
      case 'tool_call':
      case 'tool_call_update':
        return onToolCall(update);
      case 'plan':
        return onPlan(update);
      case 'available_commands_update':
        if (Array.isArray(update.availableCommands))
          io.emit(commandsEvent(update.availableCommands));
        return;
      case 'config_option_update': {
        const next = modelOf(update);
        if (next && next !== model) {
          model = next;
          if (ready) io.emit(initEvent());
        }
        return;
      }
      case 'usage_update':
        // `used` tokens of the `size` context window (omp, opencode)
        if (typeof update.used === 'number' && typeof update.size === 'number' && update.size > 0)
          io.emit({
            type: 'devorbit_usage',
            context: { tokens: update.used, window: update.size },
          });
        return;
      default:
        // session_info_update, current_mode_update: nothing to show
        return;
    }
  }

  // ---- turns --------------------------------------------------------------------------------

  const initEvent = () =>
    compact({ type: 'system', subtype: 'init', session_id: sessionId, model });

  function result(subtype, isError) {
    io.emit({
      type: 'result',
      subtype,
      is_error: isError,
      duration_ms: Date.now() - turn.start,
      session_id: sessionId,
    });
  }

  function failTurn(text) {
    io.emit({
      type: 'assistant',
      message: { id: nextId('err'), role: 'assistant', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    });
    result('error', true);
  }

  function endTurn(response, error) {
    if (!turn) return;
    const stopReason = isObj(response) ? response.stopReason : undefined;
    if (stopReason === 'cancelled') {
      // Tool calls the cancel cut short get a result, so none keeps spinning
      for (const tool of tools.values()) {
        if (!TERMINAL.has(tool.status) && !tool.resultSent) {
          tool.forcedError = true;
          tool.resultText = 'Interrupted';
          if (tool.blockSent) emitToolResult(tool);
        }
      }
    }
    closeMessage();
    if (error) failTurn(`Error: ${errorText(error)}`);
    else if (stopReason === 'cancelled') result('error_during_execution', true);
    else if (!stopReason || stopReason === 'end_turn') result('success', false);
    else failTurn(`Turn stopped: ${stopReason}`);
    turn = null;
    pump();
  }

  function pump() {
    if (!ready || turn || !queue.length || !alive()) return;
    const { text, images } = queue.shift();
    // Images as content blocks (like a pasted image); an agent without image support gets the
    // file paths, which its read tool can open
    const prompt = acceptsImages
      ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map((i) => ({ type: 'image', mimeType: i.mimeType, data: i.data })),
        ]
      : [
          {
            type: 'text',
            text: [text, ...images.map((i) => `[Image: ${i.path}]`)].filter(Boolean).join('\n'),
          },
        ];
    const rpcId = ++rpcSeq;
    turn = { rpcId, start: Date.now() };
    calls.set(rpcId, {
      resolve: (res) => endTurn(res, null),
      reject: (err) => endTurn(null, err),
    });
    write({
      id: rpcId,
      method: 'session/prompt',
      params: { sessionId, prompt },
    });
  }

  // ---- agent → client requests --------------------------------------------------------------

  function onPermission(id, params) {
    const toolCall = isObj(params?.toolCall) ? params.toolCall : {};
    const known = tools.get(str(toolCall.toolCallId));
    const merged = known ? { ...known } : {};
    mergeTool(merged, toolCall);
    const { name, input } = mapTool(merged);
    const options = Array.isArray(params?.options) ? params.options.filter(isObj) : [];
    let requestId = String(id);
    for (let n = 2; usedRequestIds.has(requestId); n++) requestId = `${id}-${n}`;
    usedRequestIds.add(requestId);
    permissions.set(requestId, { rpcId: id, options });
    const always = options.find((o) => o.kind === 'allow_always');
    io.emit({
      type: 'control_request',
      request_id: requestId,
      request: compact({
        subtype: 'can_use_tool',
        tool_name: name,
        input,
        description: firstString(toolCall.title, known?.title),
        permission_suggestions: always
          ? [{ type: 'acpOption', optionId: always.optionId }]
          : undefined,
      }),
    });
  }

  function onRequest(msg) {
    if (msg.method === 'session/request_permission') return onPermission(msg.id, msg.params);
    write({ id: msg.id, error: { code: -32601, message: `Method not supported: ${msg.method}` } });
  }

  function onMessage(msg) {
    if (!isObj(msg)) return;
    if (typeof msg.method === 'string') {
      if (msg.id !== undefined && msg.id !== null) return onRequest(msg);
      if (msg.method === 'session/update') onUpdate(msg.params);
      return;
    }
    const pending = calls.get(msg.id);
    if (!pending) return;
    calls.delete(msg.id);
    if (msg.error) pending.reject(isObj(msg.error) ? msg.error : { message: String(msg.error) });
    else pending.resolve(msg.result);
  }

  // ---- process ------------------------------------------------------------------------------

  let buffer = '';
  proc.stdout.setEncoding?.('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // not JSON-RPC: log noise
      }
      try {
        onMessage(msg);
      } catch (error) {
        stderr = `${stderr}\n[acp driver] ${error?.message ?? error}`.slice(-STDERR_KEEP);
      }
    }
  });
  proc.stderr.setEncoding?.('utf8');
  proc.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_KEEP);
  });
  const onExit = (code) => {
    if (exited) return;
    exited = true;
    clearTimeout(killTimer);
    calls.clear();
    // Our own SIGTERM is a clean end (omp exits 143 on it); a failed handshake never is
    const reported = failed
      ? code && code !== 143
        ? code
        : 1
      : stopped && code === 143
        ? null
        : code;
    io.exit({ code: reported ?? null, stderr: stderr.slice(-STDERR_KEEP) });
  };
  proc.on('exit', (code) => onExit(code));
  proc.on('error', (error) => {
    stderr = `${stderr}\n${error.message}`.slice(-STDERR_KEEP);
    onExit(-1);
  });
  proc.stdin.on?.('error', () => {
    // EPIPE after the process died; onExit reports it
  });

  function stop() {
    if (stopped || exited) {
      stopped = true;
      return;
    }
    stopped = true;
    try {
      proc.stdin.end();
      proc.kill('SIGTERM');
    } catch {
      // already gone
    }
    killTimer = setTimeout(() => {
      if (!exited) proc.kill('SIGKILL');
    }, KILL_AFTER_MS);
    killTimer.unref?.();
  }

  function failHandshake(step, error) {
    failed = true;
    stderr = `${stderr}\nACP ${step} failed: ${errorText(error)}`.slice(-STDERR_KEEP);
    stop();
  }

  (async () => {
    let step = 'initialize';
    try {
      const init = await call('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      acceptsImages = init?.agentCapabilities?.promptCapabilities?.image === true;
      if (opts.resume) {
        if (!init?.agentCapabilities?.loadSession)
          throw new Error('the agent cannot resume sessions');
        step = 'session/load';
        const res = await call('session/load', {
          sessionId: opts.resume,
          cwd: opts.cwd,
          mcpServers: [],
        });
        closeMessage();
        flushUser();
        history = false;
        model = modelOf(res);
      } else {
        step = 'session/new';
        const res = await call('session/new', { cwd: opts.cwd, mcpServers: [] });
        if (!res || typeof res.sessionId !== 'string') throw new Error('no session id');
        sessionId = res.sessionId;
        model = modelOf(res);
      }
      ready = true;
      io.emit(initEvent());
      pump();
    } catch (error) {
      history = false;
      failHandshake(step, error);
    }
  })();

  return {
    send(text, images = []) {
      if (!alive()) throw deadError();
      queue.push({ text, images });
      pump();
    },
    interrupt() {
      if (!alive()) throw deadError();
      if (!turn) return;
      write({ method: 'session/cancel', params: { sessionId } });
      // ACP: the client answers every pending permission request of the turn as cancelled
      for (const [requestId, p] of permissions) {
        write({ id: p.rpcId, result: { outcome: { outcome: 'cancelled' } } });
        permissions.delete(requestId);
      }
    },
    answer(requestId, decision) {
      if (!alive()) throw deadError();
      const p = permissions.get(requestId);
      if (!p) return;
      permissions.delete(requestId);
      const order =
        decision === 'always'
          ? ['allow_always', 'allow_once']
          : decision === 'allow'
            ? ['allow_once', 'allow_always']
            : ['reject_once', 'reject_always'];
      const option = order.map((kind) => p.options.find((o) => o.kind === kind)).find(Boolean);
      write({
        id: p.rpcId,
        result: {
          outcome: option
            ? { outcome: 'selected', optionId: option.optionId }
            : { outcome: 'cancelled' },
        },
      });
    },
    stop,
  };
}
