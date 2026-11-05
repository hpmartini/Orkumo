/**
 * Claude Code stream-json events → chat message model (#189).
 * Pure: the Chat pane folds every server event through `reduceChat`. A second harness
 * (Pi, OMP) would get its own reducer producing the same `ChatState`.
 */

export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: Record<string, unknown>;
      result?: string;
      isError?: boolean;
    };

export type ChatMessage =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; blocks: ChatBlock[]; streaming: boolean }
  | {
      kind: 'permission';
      key: string;
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      description: string;
      reason: string;
      canAlways: boolean;
      decision: 'allow' | 'deny' | 'always' | null;
    }
  | { kind: 'result'; key: string; ok: boolean; subtype: string; durationMs: number | null }
  | { kind: 'notice'; key: string; text: string; tone: 'info' | 'error' };

export interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  model: string | null;
  /** A turn is running (user sent, no result yet) */
  busy: boolean;
  /** CLI process has exited */
  ended: boolean;
  /** Assistant message id → index of the next block a full `assistant` event fills */
  filled: Record<string, number>;
}

export const initialChatState: ChatState = {
  messages: [],
  sessionId: null,
  model: null,
  busy: false,
  ended: false,
  filled: {},
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Tool results are a string or a list of text/image blocks */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (isObj(c) ? (c.type === 'text' ? str(c.text) : `[${str(c.type)}]`) : ''))
    .join('\n');
}

function toBlock(raw: unknown): ChatBlock | null {
  if (!isObj(raw)) return null;
  if (raw.type === 'text') return { type: 'text', text: str(raw.text) };
  if (raw.type === 'thinking') return { type: 'thinking', text: str(raw.thinking) };
  if (raw.type === 'tool_use')
    return {
      type: 'tool',
      id: str(raw.id),
      name: str(raw.name),
      input: isObj(raw.input) ? raw.input : {},
    };
  return null;
}

function updateAssistant(
  state: ChatState,
  id: string,
  fn: (
    m: Extract<ChatMessage, { kind: 'assistant' }>
  ) => Extract<ChatMessage, { kind: 'assistant' }>
): ChatState {
  let found = false;
  const messages = state.messages.map((m) => {
    if (m.kind !== 'assistant' || m.key !== id) return m;
    found = true;
    return fn(m);
  });
  if (found) return { ...state, messages };
  return {
    ...state,
    messages: [...state.messages, fn({ kind: 'assistant', key: id, blocks: [], streaming: true })],
  };
}

function setBlock(blocks: ChatBlock[], index: number, block: ChatBlock): ChatBlock[] {
  const next = [...blocks];
  next[index] = block;
  return next;
}

function reduceStreamEvent(state: ChatState, ev: Json): ChatState {
  if (ev.type === 'message_start' && isObj(ev.message)) {
    const id = str(ev.message.id);
    return id ? updateAssistant(state, id, (m) => ({ ...m, streaming: true })) : state;
  }
  const current = [...state.messages]
    .reverse()
    .find((m): m is Extract<ChatMessage, { kind: 'assistant' }> => m.kind === 'assistant');
  if (!current) return state;
  const index = typeof ev.index === 'number' ? ev.index : -1;
  if (ev.type === 'content_block_start' && index >= 0) {
    const block = toBlock(ev.content_block);
    return block
      ? updateAssistant(state, current.key, (m) => ({
          ...m,
          blocks: setBlock(m.blocks, index, block),
        }))
      : state;
  }
  if (ev.type === 'content_block_delta' && index >= 0 && isObj(ev.delta)) {
    const delta = ev.delta;
    const piece =
      delta.type === 'text_delta'
        ? str(delta.text)
        : delta.type === 'thinking_delta'
          ? str(delta.thinking)
          : '';
    if (!piece) return state;
    return updateAssistant(state, current.key, (m) => {
      const block = m.blocks[index];
      if (!block || block.type === 'tool') return m;
      return { ...m, blocks: setBlock(m.blocks, index, { ...block, text: block.text + piece }) };
    });
  }
  if (ev.type === 'message_stop') {
    return updateAssistant(state, current.key, (m) => ({ ...m, streaming: false }));
  }
  return state;
}

function attachToolResult(state: ChatState, block: Json): ChatState {
  const toolId = str(block.tool_use_id);
  return {
    ...state,
    messages: state.messages.map((m) =>
      m.kind !== 'assistant' || !m.blocks.some((b) => b.type === 'tool' && b.id === toolId)
        ? m
        : {
            ...m,
            blocks: m.blocks.map((b) =>
              b.type === 'tool' && b.id === toolId
                ? { ...b, result: resultText(block.content), isError: block.is_error === true }
                : b
            ),
          }
    ),
  };
}

let noticeSeq = 0;
const notice = (state: ChatState, text: string, tone: 'info' | 'error'): ChatState => ({
  ...state,
  messages: [...state.messages, { kind: 'notice', key: `n${++noticeSeq}`, text, tone }],
});

/** Fold one server event into the chat. Unknown or malformed events leave the state unchanged. */
export function reduceChat(state: ChatState, event: unknown): ChatState {
  if (!isObj(event) || typeof event.type !== 'string') return state;
  const sessionId = str(event.session_id) || state.sessionId;
  if (sessionId !== state.sessionId) state = { ...state, sessionId };

  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') return { ...state, model: str(event.model) || state.model };
      return state;

    case 'stream_event':
      return isObj(event.event) ? reduceStreamEvent(state, event.event) : state;

    case 'assistant': {
      const msg = event.message;
      if (!isObj(msg) || !Array.isArray(msg.content)) return state;
      // Subagent chatter (parent_tool_use_id set) stays inside its tool block
      if (event.parent_tool_use_id) return state;
      const id = str(msg.id) || `a${state.messages.length}`;
      // The CLI sends one `assistant` event per finished content block, in block order
      let filled = state.filled[id] ?? 0;
      const next = updateAssistant(state, id, (m) => {
        let blocks = m.blocks;
        for (const raw of msg.content as unknown[]) {
          const block = toBlock(raw);
          if (!block) continue;
          const streamed = blocks[filled];
          // Keep streamed thinking when the final block arrives redacted (empty text)
          const keep =
            streamed &&
            streamed.type === block.type &&
            block.type !== 'tool' &&
            streamed.type !== 'tool' &&
            !block.text;
          blocks = setBlock(blocks, filled, keep ? streamed : block);
          filled++;
        }
        return { ...m, blocks };
      });
      return { ...next, filled: { ...next.filled, [id]: filled } };
    }

    case 'user': {
      const msg = event.message;
      if (!isObj(msg) || event.parent_tool_use_id) return state;
      if (!Array.isArray(msg.content)) return state;
      return (msg.content as unknown[]).reduce<ChatState>(
        (s, block) =>
          isObj(block) && block.type === 'tool_result' ? attachToolResult(s, block) : s,
        state
      );
    }

    case 'devorbit_user':
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          { kind: 'user', key: `u${state.messages.length}`, text: str(event.text) },
        ],
      };

    case 'control_request': {
      const req = event.request;
      if (!isObj(req) || req.subtype !== 'can_use_tool') return state;
      const requestId = str(event.request_id);
      if (
        !requestId ||
        state.messages.some((m) => m.kind === 'permission' && m.requestId === requestId)
      )
        return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: 'permission',
            key: `p${requestId}`,
            requestId,
            toolName: str(req.display_name) || str(req.tool_name),
            input: isObj(req.input) ? req.input : {},
            description: str(req.description),
            reason: str(req.decision_reason),
            canAlways:
              Array.isArray(req.permission_suggestions) && req.permission_suggestions.length > 0,
            decision: null,
          },
        ],
      };
    }

    case 'devorbit_permission': {
      const decision = event.decision;
      if (decision !== 'allow' && decision !== 'deny' && decision !== 'always') return state;
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === 'permission' && m.requestId === event.request_id ? { ...m, decision } : m
        ),
      };
    }

    case 'result': {
      const ok = event.is_error !== true;
      const subtype = str(event.subtype);
      const messages = state.messages.map((m) =>
        m.kind === 'assistant' && m.streaming ? { ...m, streaming: false } : m
      );
      return {
        ...state,
        busy: false,
        messages: [
          ...messages,
          {
            kind: 'result',
            key: `r${state.messages.length}`,
            ok,
            subtype,
            durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : null,
          },
        ],
      };
    }

    case 'devorbit_exit': {
      const code = typeof event.code === 'number' ? event.code : null;
      const stderr = str(event.stderr);
      const ended = { ...state, busy: false, ended: true };
      return code && code !== 0
        ? notice(ended, `Session ended (code ${code})${stderr ? `: ${stderr}` : ''}`, 'error')
        : notice(ended, 'Session ended', 'info');
    }

    default:
      return state;
  }
}

/** Permission request still waiting for an answer (blocks the turn) */
export const pendingPermissions = (state: ChatState) =>
  state.messages.filter(
    (m): m is Extract<ChatMessage, { kind: 'permission' }> => m.kind === 'permission' && !m.decision
  );

export type ChatSubmitKey = 'enter' | 'mod+enter';

/**
 * Does this keydown send the message? `enter`: Enter sends, Shift+Enter breaks the line.
 * `mod+enter`: Cmd/Ctrl+Enter sends, plain Enter breaks the line. IME composition never sends.
 */
export function isSubmitKey(
  e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean },
  mode: ChatSubmitKey
): boolean {
  if (e.key !== 'Enter' || e.isComposing) return false;
  if (mode === 'mod+enter') return e.metaKey || e.ctrlKey;
  return !e.shiftKey && !e.metaKey && !e.ctrlKey;
}

export interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

/** Edit/Write/MultiEdit input → diff lines (whole old block removed, new block added) */
export function toolDiff(name: string, input: Record<string, unknown>): DiffLine[] | null {
  const lines = (text: unknown, sign: DiffLine['sign']): DiffLine[] =>
    str(text)
      .split('\n')
      .map((t) => ({ sign, text: t }));
  if (name === 'Write') return lines(input.content, '+');
  if (name === 'Edit') return [...lines(input.old_string, '-'), ...lines(input.new_string, '+')];
  if (name === 'MultiEdit' && Array.isArray(input.edits))
    return input.edits.flatMap((e) =>
      isObj(e) ? [...lines(e.old_string, '-'), ...lines(e.new_string, '+')] : []
    );
  return null;
}

/** One-line summary of a tool call's main argument */
export function toolSummary(input: Record<string, unknown>): string {
  const main =
    input.file_path ??
    input.command ??
    input.pattern ??
    input.url ??
    input.path ??
    input.description;
  const text = typeof main === 'string' ? main : '';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
