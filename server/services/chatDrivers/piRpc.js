/**
 * Chat driver for pi (`pi --mode rpc`: JSONL commands on stdin, `response` frames and session
 * events on stdout). Translates the pi session into the Claude stream-json event shapes the chat
 * reducer (`utils/chatEvents.ts`) understands.
 *
 * - Fresh session: plain `pi --mode rpc`; resume: `--session-id <id>` (opens the cwd's project
 *   session with exactly that id). The handshake asks `get_state` for the session id and model
 *   and `get_commands` for the `/` picker; a resumed session also asks `get_messages` and replays
 *   it as history before the first live turn.
 * - One `prompt` per user turn; a turn ends at `agent_settled` (pi has no further automatic work:
 *   retries, compaction recovery). Turns sent before the handshake or while one runs wait here.
 * - `interrupt` sends `abort`; the turn ends as `error_during_execution`. Queued turns are dropped.
 * - pi has no permission prompts. Extension dialogs (`extension_ui_request` select/confirm/input/
 *   editor) are answered `cancelled` right away so the agent never blocks on a UI that is not there.
 */
import crypto from 'crypto';

const STDERR_KEEP = 4000;
const KILL_AFTER_MS = 3000;
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (v, n) => str(v).slice(0, n);

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * pi tool call → Claude tool name + input, so the chat renders summaries and diffs.
 * Tools without a Claude equivalent (ls, extension tools) keep their own name and arguments.
 * @param {string} name - pi tool name
 * @param {object} args - pi tool arguments
 * @returns {{ name: string, input: object }}
 */
export function mapTool(name, args) {
  const a = isObj(args) ? args : {};
  const { path, ...rest } = a;
  switch (name) {
    case 'bash':
      return { name: 'Bash', input: a };
    case 'read':
      return { name: 'Read', input: { file_path: path, ...rest } };
    case 'write':
      return { name: 'Write', input: { file_path: path, content: a.content } };
    case 'edit': {
      // pi edits as `{ path, edits: [{ oldText, newText }] }` (older: `{ path, oldText, newText }`)
      const edits = Array.isArray(a.edits)
        ? a.edits.filter(isObj)
        : typeof a.oldText === 'string'
          ? [{ oldText: a.oldText, newText: a.newText }]
          : [];
      if (edits.length === 1)
        return {
          name: 'Edit',
          input: {
            file_path: path,
            old_string: str(edits[0].oldText),
            new_string: str(edits[0].newText),
          },
        };
      return {
        name: 'MultiEdit',
        input: {
          file_path: path,
          edits: edits.map((e) => ({ old_string: str(e.oldText), new_string: str(e.newText) })),
        },
      };
    }
    case 'grep':
      return { name: 'Grep', input: a };
    case 'find':
      return { name: 'Glob', input: a };
    default:
      return { name: str(name), input: a };
  }
}

/** Text of a tool result's content blocks (images become a placeholder) */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObj)
    .map((c) => (c.type === 'text' ? str(c.text) : `[${str(c.type)}]`))
    .join('\n');
}

/** pi assistant content → Claude content blocks (same order, so stream indexes line up) */
function assistantBlocks(content) {
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const c of content) {
    if (!isObj(c)) continue;
    if (c.type === 'text') blocks.push({ type: 'text', text: str(c.text) });
    else if (c.type === 'thinking') blocks.push({ type: 'thinking', thinking: str(c.thinking) });
    else if (c.type === 'toolCall') {
      const { name, input } = mapTool(c.name, c.arguments);
      blocks.push({ type: 'tool_use', id: str(c.id), name, input });
    }
  }
  return blocks;
}

/** pi `toolResult` message → Claude tool_result event */
function toolResultEvent(msg) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: str(msg.toolCallId),
          content: contentText(msg.content),
          is_error: msg.isError === true,
        },
      ],
    },
    parent_tool_use_id: null,
  };
}

/**
 * `get_messages` of a resumed session → history events (user turns, assistant messages, tool
 * results). System, bash-execution, custom and summary messages stay out of the chat.
 * @param {object[]} messages - pi AgentMessage list
 * @param {() => string} nextId - assistant message id generator
 */
export function historyEvents(messages, nextId) {
  const events = [];
  if (!Array.isArray(messages)) return events;
  for (const msg of messages) {
    if (!isObj(msg)) continue;
    if (msg.role === 'user') {
      const text = contentText(
        Array.isArray(msg.content) ? msg.content.filter((c) => c?.type === 'text') : msg.content
      );
      if (text.trim()) events.push({ type: 'devorbit_user', text, history: true });
    } else if (msg.role === 'assistant') {
      const content = assistantBlocks(msg.content);
      if (msg.stopReason === 'error' && str(msg.errorMessage))
        content.push({ type: 'text', text: msg.errorMessage });
      if (content.length)
        events.push({
          type: 'assistant',
          message: { id: nextId(), content },
          parent_tool_use_id: null,
          history: true,
        });
    } else if (msg.role === 'toolResult') {
      events.push(toolResultEvent(msg));
    }
  }
  return events;
}

/** pi `get_commands` (extension commands, prompt templates, skills) → `devorbit_commands` */
function commandsEvent(list) {
  return {
    type: 'devorbit_commands',
    commands: (Array.isArray(list) ? list : [])
      .filter((c) => isObj(c) && typeof c.name === 'string' && c.name)
      .map((c) => ({
        name: c.name,
        description: clip(c.description, 600),
        argumentHint: '',
        builtin: false,
      })),
  };
}

/**
 * Start `pi --mode rpc` and its handshake.
 * @param {{ harness: string, cwd: string, resume: string|null }} opts
 * @param {{ bin: string, spawn: Function, emit: (event: object) => void,
 *   exit: (info: { code: number|null, stderr: string }) => void }} io
 */
export function startDriver(opts, io) {
  const args = ['--mode', 'rpc', ...(opts.resume ? ['--session-id', opts.resume] : [])];
  const proc = io.spawn(io.bin, args, {
    cwd: opts.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const prefix = crypto.randomUUID().slice(0, 8);
  let seq = 0;
  const nextId = () => `pi-${prefix}-m${++seq}`;

  let stderr = '';
  let exited = false;
  let stopped = false;
  let killTimer = null;
  /** the handshake failed: the exit is an error whatever code the process reports */
  let failed = false;
  let ready = false;
  let sessionId = opts.resume || null;
  let model;

  let reqSeq = 0;
  /** command id → response handler */
  const pending = new Map();
  /** user turns waiting for their `prompt` */
  const queue = [];
  /** running turn: { start, aborted, error, dropped } */
  let turn = null;
  /** pi runs the agent (ours or one an extension started): between agent_start and agent_settled */
  let agentBusy = false;
  /** assistant message being streamed: { id, started } */
  let cur = null;

  const addStderr = (text) => {
    stderr = (stderr + text).slice(-STDERR_KEEP);
  };

  function write(obj) {
    if (exited || !proc.stdin?.writable) return;
    try {
      proc.stdin.write(`${JSON.stringify(obj)}\n`);
    } catch {
      // EPIPE: the exit handler reports it
    }
  }

  function request(type, fields, onResponse) {
    const id = `${type}-${++reqSeq}`;
    if (onResponse) pending.set(id, onResponse);
    write({ id, type, ...fields });
  }

  function assertAlive() {
    if (exited || stopped || !proc.stdin?.writable) throw badRequest('Chat session is not running');
  }

  const emitInit = () =>
    io.emit({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      ...(model ? { model } : {}),
    });

  // ---- turns ---------------------------------------------------------------------------------

  function result(subtype, start) {
    io.emit({
      type: 'result',
      subtype,
      is_error: subtype !== 'success',
      duration_ms: Date.now() - start,
      session_id: sessionId,
    });
  }

  function endTurn(subtype) {
    if (!turn) return;
    const { start, dropped } = turn;
    turn = null;
    result(subtype, start);
    for (let i = 0; i < dropped; i++) result('error_during_execution', start);
    pump();
  }

  function failTurn(message) {
    io.emit({
      type: 'assistant',
      message: { id: nextId(), content: [{ type: 'text', text: message }] },
      parent_tool_use_id: null,
    });
    endTurn('error');
  }

  function pump() {
    if (!ready || turn || agentBusy || !queue.length || exited || stopped) return;
    turn = { start: Date.now(), aborted: false, error: null, dropped: 0 };
    request('prompt', { message: queue.shift() }, (r) => {
      if (!r.success) failTurn(`pi rejected the message: ${str(r.error) || 'unknown error'}`);
      // an extension command consumed the message without starting a run
      else if (r.data?.disposition === 'handled' && !agentBusy) endTurn('success');
    });
  }

  // ---- session events ------------------------------------------------------------------------

  function streamEvent(event) {
    io.emit({ type: 'stream_event', event });
  }

  /** First streamed block opens the message, so an empty (aborted) message never shows */
  function blockStart(index, block) {
    if (!cur) return;
    if (!cur.started) {
      cur.started = true;
      streamEvent({ type: 'message_start', message: { id: cur.id } });
    }
    streamEvent({ type: 'content_block_start', index, content_block: block });
  }

  function onUpdate(e) {
    if (!cur || !isObj(e) || typeof e.contentIndex !== 'number') return;
    const index = e.contentIndex;
    switch (e.type) {
      case 'text_start':
        return blockStart(index, { type: 'text', text: '' });
      case 'thinking_start':
        return blockStart(index, { type: 'thinking', thinking: '' });
      case 'toolcall_start':
        return blockStart(index, {
          type: 'tool_use',
          id: str(e.id),
          name: mapTool(e.toolName, {}).name,
          input: {},
        });
      case 'text_delta':
        if (cur.started && str(e.delta))
          streamEvent({
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: e.delta },
          });
        return;
      case 'thinking_delta':
        if (cur.started && str(e.delta))
          streamEvent({
            type: 'content_block_delta',
            index,
            delta: { type: 'thinking_delta', thinking: e.delta },
          });
        return;
    }
  }

  function onAssistantEnd(msg) {
    const id = cur?.id ?? nextId();
    if (cur?.started) streamEvent({ type: 'message_stop' });
    cur = null;
    const content = assistantBlocks(msg.content);
    if (msg.stopReason === 'aborted') {
      if (turn) turn.aborted = true;
    } else if (msg.stopReason === 'error') {
      // after our abort pi closes the turn with an error message ("This operation was aborted")
      if (!turn?.aborted) {
        const message = str(msg.errorMessage) || 'pi reported an error';
        content.push({ type: 'text', text: message });
        if (turn) turn.error = message;
      }
    } else if (turn) {
      turn.error = null; // a retry succeeded
    }
    if (content.length)
      io.emit({ type: 'assistant', message: { id, content }, parent_tool_use_id: null });
  }

  function onExtensionUi(msg) {
    // Dialogs need a client UI the chat does not have: cancel so the extension falls back
    if (DIALOG_METHODS.has(msg.method) && msg.id)
      write({ type: 'extension_ui_response', id: msg.id, cancelled: true });
  }

  function handle(msg) {
    switch (msg.type) {
      case 'response': {
        const handler = pending.get(msg.id);
        if (handler) {
          pending.delete(msg.id);
          handler(msg);
        }
        return;
      }
      case 'agent_start':
        agentBusy = true;
        return;
      case 'agent_settled':
        agentBusy = false;
        if (turn)
          endTurn(turn.aborted ? 'error_during_execution' : turn.error ? 'error' : 'success');
        else pump();
        return;
      case 'message_start': {
        const m = msg.message;
        if (!isObj(m) || m.role !== 'assistant') return;
        cur = { id: nextId(), started: false };
        if (str(m.model) && m.model !== model) {
          model = m.model;
          emitInit();
        }
        return;
      }
      case 'message_update':
        return onUpdate(msg.assistantMessageEvent);
      case 'message_end': {
        const m = msg.message;
        if (!isObj(m)) return;
        if (m.role === 'assistant') onAssistantEnd(m);
        else if (m.role === 'toolResult') io.emit(toolResultEvent(m));
        return;
      }
      case 'extension_ui_request':
        return onExtensionUi(msg);
      case 'extension_error':
        addStderr(`\n${str(msg.extensionPath)}: ${str(msg.error)}`);
        return;
    }
  }

  // ---- handshake -----------------------------------------------------------------------------

  function failHandshake(message) {
    failed = true;
    addStderr(`\n${message}`);
    stop();
  }

  function finishHandshake() {
    ready = true;
    pump();
  }

  request('get_state', {}, (r) => {
    if (!r.success || !isObj(r.data)) {
      failHandshake(`pi get_state failed: ${str(r.error) || 'no data'}`);
      return;
    }
    sessionId = str(r.data.sessionId) || sessionId;
    model = str(r.data.model?.id) || undefined;
    emitInit();
    if (!opts.resume) {
      finishHandshake();
      return;
    }
    request('get_messages', {}, (m) => {
      if (m.success) for (const event of historyEvents(m.data?.messages, nextId)) io.emit(event);
      else addStderr(`\npi get_messages failed: ${str(m.error)}`);
      finishHandshake();
    });
  });
  request('get_commands', {}, (r) => {
    if (r.success) io.emit(commandsEvent(r.data?.commands));
  });

  // ---- process -------------------------------------------------------------------------------

  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    // split on LF only: U+2028/U+2029 are valid inside JSON strings
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObj(msg) || typeof msg.type !== 'string') continue;
      try {
        handle(msg);
      } catch (error) {
        addStderr(`\npi driver: ${error.message}`);
      }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', addStderr);
  proc.stdin.on('error', () => {
    // EPIPE after the process died; the exit handler reports it
  });

  const finish = (code) => {
    if (exited) return;
    exited = true;
    clearTimeout(killTimer);
    pending.clear();
    // pi exits 143 on our SIGTERM: a clean end; a failed handshake never is
    const reported = failed
      ? code && code !== 143
        ? code
        : 1
      : stopped && code === 143
        ? null
        : code;
    io.exit({ code: reported ?? null, stderr });
  };
  proc.on('exit', (code) => finish(code));
  proc.on('error', (error) => {
    addStderr(`\n${error.message}`);
    finish(-1);
  });

  function stop() {
    if (stopped || exited) return;
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

  return {
    send(text) {
      assertAlive();
      queue.push(text);
      pump();
    },
    interrupt() {
      assertAlive();
      const dropped = queue.splice(0).length;
      if (turn) {
        turn.aborted = true;
        turn.dropped += dropped;
      } else {
        const start = Date.now();
        for (let i = 0; i < dropped; i++) result('error_during_execution', start);
      }
      if (turn || agentBusy) request('abort', {});
    },
    answer() {
      assertAlive();
      throw badRequest('pi has no permission requests');
    },
    stop,
  };
}
