/**
 * Transcript readers for the chat view (#189): every agent runs as a TUI in a terminal pane, the
 * UI view renders its session file. One reader per harness finds the file and turns its JSONL
 * lines into Claude Code stream-json event shapes, which the client reducer
 * (utils/chatEvents.ts) reads:
 *
 * | harness | file                                                     | format              |
 * | :------ | :------------------------------------------------------- | :------------------ |
 * | claude  | `~/.claude/projects/<slug>/<uuid>.jsonl`                 | Claude transcript   |
 * | omp     | `~/.omp/agent/sessions/<dir>/<timestamp>_<uuid>.jsonl`   | pi session v3       |
 * | pi      | `~/.pi/agent/sessions/<dir>/<timestamp>_<uuid>.jsonl`    | pi session v3       |
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HARNESS_RESUME } from '../../config/harnesses.js';
import { paths as agentPaths, projectSlug } from './agentService.js';
import { findOmpSessionFile, ompSessionsDir } from './ompSessions.js';

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Replay events kept from a transcript; the view's replay buffer has the same cap */
export const MAX_HISTORY_EVENTS = 5000;
/** Transcript bytes read per step: a long session's file runs to tens of MB, all of it is read */
export const READ_CHUNK_BYTES = 8 * 1024 * 1024;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (v, n) => str(v).slice(0, n);

/** One JSONL line → record object, or null for blank/garbage lines (never throws) */
export function parseLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === 'object' && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude Code transcripts: already stream-json shaped
// ---------------------------------------------------------------------------

/** `{ ts }` (ms) of a record that carries its time, else nothing */
const stamp = (rec) => {
  const ts = Date.parse(str(rec.timestamp));
  return Number.isFinite(ts) ? { ts } : {};
};

/** Pasted text arrives wrapped in `<pasted_content id="…">…</pasted_content id="…">`: show it bare */
export function unwrapPasted(text) {
  return text.replace(/<\/?pasted_content(?:\s+id="[^"]*")?>\n?/g, '');
}

/** Hand-backs of subagents and other sessions (`<agent-message …>`) are no prompts of the user */
const isPeerMessage = (text) => /^\s*<(agent-message|task-notification)\b/.test(text);

/**
 * A slash command called with text (`/retro Dann …`), which Claude Code logs as
 * `<command-name>/retro</command-name>` + `<command-args>Dann …</command-args>`: `/retro Dann …`.
 * A skill without text is a turn too (`/status-report`): Claude Code logs it `<command-message>`
 * first, built-ins `<command-name>` first. null for a built-in without text (`/compact`,
 * `/clear`): those stay control lines, not user turns.
 */
export function commandPrompt(text) {
  const name = text.match(/<command-name>(\/[^<\s]+)<\/command-name>/)?.[1];
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  if (!name) return null;
  if (args) return `${name} ${args}`;
  return text.trimStart().startsWith('<command-message>') ? name : null;
}

/** Claude transcript JSONL lines → view events (user turns, assistant messages, tool results) */
function claudeHistoryEvents(lines) {
  const events = [];
  for (const line of lines) {
    const rec = parseLine(line);
    if (!rec || rec.isSidechain || rec.isMeta || rec.isCompactSummary) continue;
    // A prompt typed while the agent works is logged here at once, its user record only when the
    // turn takes it: the view shows it as queued in between (enqueue/dequeue FIFO, remove by text)
    if (rec.type === 'queue-operation') {
      const text = str(rec.content);
      // peer messages stay in: they hold their place in the FIFO, the view hides `<…` entries
      if (['enqueue', 'dequeue', 'remove', 'popAll'].includes(rec.operation))
        events.push({ type: 'devorbit_queue', op: rec.operation, text: unwrapPasted(text) });
      continue;
    }
    if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      events.push({ type: 'system', subtype: 'compact_boundary' });
      continue;
    }
    if (rec.type === 'system' && rec.subtype === 'away_summary' && rec.content) {
      events.push({ type: 'system', subtype: 'away_summary', content: rec.content });
      continue;
    }
    // Claude Code notes the end of a longer turn with its duration: the answer card's footer
    if (rec.type === 'system' && rec.subtype === 'turn_duration') {
      const ms = Number(rec.durationMs);
      events.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: Number.isFinite(ms) ? ms : null,
      });
      continue;
    }
    // A prompt typed while the agent works is no user message: Claude Code stores it as a
    // queued-command attachment when it hands it to the running turn (task notifications too)
    const queued = rec.type === 'attachment' ? rec.attachment : null;
    if (queued?.type === 'queued_command') {
      const human = !queued.origin || queued.origin.kind === 'human';
      const text = str(queued.prompt);
      if (queued.commandMode === 'prompt' && human && text.trim() && !isPeerMessage(text))
        events.push({
          type: 'devorbit_user',
          text: unwrapPasted(text),
          history: true,
          ...stamp(rec),
        });
      continue;
    }
    if (!rec.message) continue;
    const content = rec.message.content;
    if (rec.type === 'assistant' && Array.isArray(content)) {
      events.push({
        type: 'assistant',
        message: rec.message,
        parent_tool_use_id: null,
        history: true,
        ...stamp(rec),
        ...(typeof rec.effort === 'string' ? { effort: rec.effort } : {}),
      });
    } else if (rec.type === 'user') {
      const raw =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((b) => b?.type === 'text')
                .map((b) => b.text)
                .join('\n')
            : '';
      const text = unwrapPasted(raw);
      if (text.includes('<command-name>/clear</command-name>'))
        events.push({ type: 'system', subtype: 'clear' });
      // A background shell / task ended: the view drops its running chip
      const ended = text.match(
        /<task-notification>[\s\S]*?<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(?:completed|failed|killed|stopped)<\/status>/
      );
      if (ended) events.push({ type: 'devorbit_task_ended', id: ended[1] });
      // A command with text is the user's turn; `<command-name>` without it,
      // `<local-command-stdout>` and similar CLI wrappers are not
      const command = commandPrompt(text);
      if (command)
        events.push({ type: 'devorbit_user', text: command, history: true, ...stamp(rec) });
      else if (text.trim() && !text.trimStart().startsWith('<')) {
        events.push({ type: 'devorbit_user', text, history: true, ...stamp(rec) });
      }
      if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
        events.push({ type: 'user', message: rec.message, parent_tool_use_id: null });
      }
    }
  }
  return events.slice(-MAX_HISTORY_EVENTS);
}

/** Transcript of a Claude session: the cwd's project folder, else any (worktree sessions) */
function findClaudeTranscript(sessionId, cwd, projectsDir = agentPaths.PROJECTS_DIR) {
  const name = `${sessionId}.jsonl`;
  const direct = path.join(projectsDir, projectSlug(cwd), name);
  if (fs.existsSync(direct)) return direct;
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const candidate = path.join(projectsDir, dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // no projects dir
  }
  return null;
}

/** Command / agent lists for the `/` and `@` picker, trimmed */
export function commandsEvent(commands, agents) {
  const event = { type: 'devorbit_commands' };
  if (Array.isArray(commands))
    event.commands = commands
      .filter((c) => c && typeof c.name === 'string' && !c.name.startsWith('__'))
      .map((c) => ({
        name: c.name,
        description: clip(c.description, 600),
        argumentHint: clip(c.argumentHint, 200),
        builtin: c.builtin === true,
      }));
  if (Array.isArray(agents))
    event.agents = agents
      .filter((a) => a && typeof a.name === 'string')
      .map((a) => ({ name: a.name, description: clip(a.description, 600) }));
  return event;
}

// ---------------------------------------------------------------------------
// omp / pi session files (pi session format v3)
// ---------------------------------------------------------------------------

/**
 * pi/omp tool call → Claude tool name + input, so the chat renders summaries and diffs.
 * Tools without a Claude equivalent (omp's hashline edit, eval, task, ...) keep their own name
 * and arguments.
 */
export function mapTool(name, args) {
  const a = isObj(args) ? args : {};
  const { path: file, ...rest } = a;
  switch (name) {
    case 'bash':
      return { name: 'Bash', input: a };
    case 'read':
      return { name: 'Read', input: { file_path: file, ...rest } };
    case 'write':
      return { name: 'Write', input: { file_path: file, content: a.content } };
    case 'edit': {
      // pi edits as `{ path, edits: [{ oldText, newText }] }` (older: `{ path, oldText, newText }`)
      const edits = Array.isArray(a.edits)
        ? a.edits.filter(isObj)
        : typeof a.oldText === 'string'
          ? [{ oldText: a.oldText, newText: a.newText }]
          : [];
      if (!file || edits.length === 0) break;
      if (edits.length === 1)
        return {
          name: 'Edit',
          input: {
            file_path: file,
            old_string: str(edits[0].oldText),
            new_string: str(edits[0].newText),
          },
        };
      return {
        name: 'MultiEdit',
        input: {
          file_path: file,
          edits: edits.map((e) => ({ old_string: str(e.oldText), new_string: str(e.newText) })),
        },
      };
    }
    case 'grep':
      return { name: 'Grep', input: a };
    case 'find':
    case 'glob':
      return { name: 'Glob', input: a };
  }
  return { name: str(name), input: a };
}

/** Text of content blocks (images become a placeholder) */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObj)
    .map((c) => (c.type === 'text' ? str(c.text) : `[${str(c.type)}]`))
    .join('\n');
}

/** pi assistant content → Claude content blocks (same order) */
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

/** Assistant stop reasons that end the turn → `result` subtype (`toolUse` continues the turn) */
const TURN_END = {
  stop: 'success',
  length: 'error_max_tokens',
  aborted: 'error_during_execution',
  error: 'error',
};

/** `model_change`: omp writes `model` ("provider/id"), pi `provider` + `modelId` */
const modelOf = (rec) =>
  str(rec.model) || (str(rec.modelId) && [rec.provider, rec.modelId].filter(str).join('/'));

/**
 * Session JSONL lines → view events. Shown: user text, assistant text/thinking/tool calls, tool
 * results, model changes and turn ends. Skipped: system/developer prompts, custom and internal
 * entries (custom_message, mode_change, compaction, title, ...).
 */
function sessionHistoryEvents(lines) {
  const events = [];
  for (const line of lines) {
    const rec = parseLine(line);
    if (!rec) continue;
    if (rec.type === 'compaction') {
      events.push({ type: 'system', subtype: 'compact_boundary' });
      continue;
    }
    if (rec.type === 'model_change') {
      const model = modelOf(rec);
      if (model) events.push({ type: 'system', subtype: 'init', model });
      continue;
    }
    // An interactive `/skill:name …` is no user message: omp logs the skill's prompt with the
    // line as typed in `details.prompt`
    if (rec.type === 'custom_message' && rec.customType === 'skill-prompt') {
      const typed = str(rec.details?.prompt);
      if (typed.trim())
        events.push({ type: 'devorbit_user', text: typed, history: true, ...stamp(rec) });
      continue;
    }
    const msg = rec.type === 'message' && isObj(rec.message) ? rec.message : null;
    if (!msg) continue;
    if (msg.role === 'user') {
      const text = contentText(
        Array.isArray(msg.content) ? msg.content.filter((c) => c?.type === 'text') : msg.content
      );
      // omp records its injected `<system-reminder …>` notes as user messages too: not prompts
      if (text.trim() && !text.trimStart().startsWith('<system-reminder'))
        events.push({ type: 'devorbit_user', text, history: true, ...stamp(rec) });
    } else if (msg.role === 'assistant') {
      const content = assistantBlocks(msg.content);
      if (msg.stopReason === 'error' && str(msg.errorMessage))
        content.push({ type: 'text', text: msg.errorMessage });
      if (content.length)
        events.push({
          type: 'assistant',
          message: { id: str(rec.id), model: str(msg.model) || undefined, content },
          parent_tool_use_id: null,
          history: true,
          ...stamp(rec),
        });
      const subtype = TURN_END[msg.stopReason];
      // `ts` on both ends lets the client time the turn (omp records no duration)
      if (subtype)
        events.push({ type: 'result', subtype, is_error: subtype !== 'success', ...stamp(rec) });
    } else if (msg.role === 'toolResult') {
      events.push({
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
      });
    }
  }
  return events.slice(-MAX_HISTORY_EVENTS);
}

export const piSessionsDir = (home = os.homedir()) => path.join(home, '.pi', 'agent', 'sessions');

/**
 * harness → reader. `findTranscript(sessionId, cwd, dir?)` resolves to the session file or null
 * (`dir` overrides the harness's base folder, for tests); `historyEvents(lines)` translates.
 */
export const TRANSCRIPT_READERS = Object.freeze({
  claude: {
    idRe: SESSION_ID_RE,
    findTranscript: async (sessionId, cwd, dir) => findClaudeTranscript(sessionId, cwd, dir),
    historyEvents: claudeHistoryEvents,
  },
  omp: {
    idRe: HARNESS_RESUME.omp.id,
    findTranscript: (sessionId, _cwd, dir = ompSessionsDir()) => findOmpSessionFile(sessionId, dir),
    historyEvents: sessionHistoryEvents,
  },
  pi: {
    idRe: HARNESS_RESUME.pi.id,
    findTranscript: (sessionId, _cwd, dir = piSessionsDir()) => findOmpSessionFile(sessionId, dir),
    historyEvents: sessionHistoryEvents,
  },
});
