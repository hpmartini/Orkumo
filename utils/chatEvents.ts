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
  /** `ts`: when the prompt was sent (ms), if the transcript says */
  | { kind: 'user'; key: string; text: string; ts?: number }
  | {
      kind: 'assistant';
      key: string;
      blocks: ChatBlock[];
      streaming: boolean;
      /** Model that wrote this message, if the transcript names it */
      model?: string;
    }
  | { kind: 'result'; key: string; ok: boolean; subtype: string; durationMs: number | null }
  | { kind: 'notice'; key: string; text: string; tone: 'info' | 'error' }
  /** The CLI's "※ recap" summary (system/away_summary) */
  | { kind: 'recap'; key: string; text: string };

export type AssistantMessage = Extract<ChatMessage, { kind: 'assistant' }>;
export type ResultMessage = Extract<ChatMessage, { kind: 'result' }>;

/** One answer card: the assistant messages of one turn and the result that ended it */
export interface ChatAnswer {
  kind: 'answer';
  key: string;
  parts: AssistantMessage[];
  result: ResultMessage | null;
}

/** What the chat renders: answers grouped, everything else as it came */
export type ChatItem = Exclude<ChatMessage, { kind: 'assistant' }> | ChatAnswer;

/**
 * Group consecutive assistant messages into one answer per turn. A `result` closes the answer
 * before it; a user message, recap or notice starts a new one.
 */
export function groupAnswers(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let open: ChatAnswer | null = null;
  for (const m of messages) {
    if (m.kind === 'assistant') {
      if (open) open.parts.push(m);
      else items.push((open = { kind: 'answer', key: m.key, parts: [m], result: null }));
    } else if (m.kind === 'result' && open) {
      open.result = m;
      open = null;
    } else {
      items.push(m);
      open = null;
    }
  }
  return items;
}

export interface ChatCommand {
  name: string;
  description: string;
  argumentHint?: string;
  builtin?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  model: string | null;
  /** Assistant message id → index of the next block a full `assistant` event fills */
  filled: Record<string, number>;
  /** Slash commands (built-ins, skills) and agents the CLI reported */
  commands: ChatCommand[];
  agents: { name: string; description: string }[];
  /** Sub-agent blocks by the Agent tool call that runs them */
  sub: Record<string, ChatBlock[]>;
}

export const initialChatState: ChatState = {
  messages: [],
  sessionId: null,
  model: null,
  filled: {},
  commands: [],
  agents: [],
  sub: {},
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

/** Turn length from the last prompt's time to the result's `ts` (omp records no duration) */
function turnTime(state: ChatState, ts: unknown): number | null {
  if (typeof ts !== 'number') return null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.kind === 'result') return null;
    if (m.kind === 'user') return typeof m.ts === 'number' && ts >= m.ts ? ts - m.ts : null;
  }
  return null;
}

/** Fold one server event into the chat. Unknown or malformed events leave the state unchanged. */
export function reduceChat(state: ChatState, event: unknown): ChatState {
  if (!isObj(event) || typeof event.type !== 'string') return state;
  const sessionId = str(event.session_id) || state.sessionId;
  if (sessionId !== state.sessionId) state = { ...state, sessionId };

  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') return { ...state, model: str(event.model) || state.model };
      if (event.subtype === 'away_summary' && str(event.content))
        return {
          ...state,
          messages: [
            ...state.messages,
            {
              kind: 'recap',
              key: `c${state.messages.length}`,
              text: str(event.content).replace(/\s*\(disable recaps in \/config\)\s*$/, ''),
            },
          ],
        };
      return state;

    case 'devorbit_commands':
      return {
        ...state,
        commands: Array.isArray(event.commands)
          ? (event.commands as ChatCommand[])
          : state.commands,
        agents: Array.isArray(event.agents) ? (event.agents as ChatState['agents']) : state.agents,
      };

    case 'assistant': {
      const msg = event.message;
      if (!isObj(msg) || !Array.isArray(msg.content)) return state;
      // Subagent chatter (parent_tool_use_id set) stays inside its tool block
      if (event.parent_tool_use_id) {
        const parent = str(event.parent_tool_use_id);
        const blocks = (msg.content as unknown[]).map(toBlock).filter((b): b is ChatBlock => !!b);
        return {
          ...state,
          sub: { ...state.sub, [parent]: [...(state.sub[parent] ?? []), ...blocks] },
        };
      }
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
        // Replayed history never gets a `result`, so it must not keep the typing cursor
        const model = str(msg.model) || m.model;
        return {
          ...m,
          blocks,
          streaming: event.history === true ? false : m.streaming,
          ...(model ? { model } : {}),
        };
      });
      return { ...next, filled: { ...next.filled, [id]: filled } };
    }

    case 'user': {
      const msg = event.message;
      if (!isObj(msg) || !Array.isArray(msg.content)) return state;
      if (event.parent_tool_use_id) {
        const parent = str(event.parent_tool_use_id);
        let blocks = state.sub[parent] ?? [];
        for (const r of msg.content as unknown[]) {
          if (!isObj(r) || r.type !== 'tool_result') continue;
          blocks = blocks.map((b) =>
            b.type === 'tool' && b.id === str(r.tool_use_id)
              ? { ...b, result: resultText(r.content), isError: r.is_error === true }
              : b
          );
        }
        return { ...state, sub: { ...state.sub, [parent]: blocks } };
      }
      return (msg.content as unknown[]).reduce<ChatState>(
        (s, block) =>
          isObj(block) && block.type === 'tool_result' ? attachToolResult(s, block) : s,
        state
      );
    }

    case 'devorbit_user':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: 'user',
            key: `u${state.messages.length}`,
            text: str(event.text),
            ...(typeof event.ts === 'number' ? { ts: event.ts } : {}),
          },
        ],
      };

    case 'result': {
      const ok = event.is_error !== true;
      const subtype = str(event.subtype);
      const messages = state.messages.map((m) =>
        m.kind === 'assistant' && m.streaming ? { ...m, streaming: false } : m
      );
      return {
        ...state,
        messages: [
          ...messages,
          {
            kind: 'result',
            key: `r${state.messages.length}`,
            ok,
            subtype,
            durationMs:
              typeof event.duration_ms === 'number' ? event.duration_ms : turnTime(state, event.ts),
          },
        ],
      };
    }

    default:
      return state;
  }
}

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
