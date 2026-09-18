/**
 * Parsing of the agent view dispatch input.
 *
 * Mirrors the TUI rules documented for `claude agents`:
 *   <agent-name> <prompt>   run as subagent when the first word matches a subagent
 *   @<agent-name> <prompt>  mention a subagent anywhere
 *   @<repo> <prompt>        mention a repository to target its directory
 *   /<command>              slash command (/resume, /model, /effort, skills)
 *   ! <command>             run a shell command as a background job (--exec)
 *   #<number> | PR URL      select the session working on that PR
 *   a:<name> s:<state> #<n> URL  filter the list instead of dispatching
 */
import type { AgentSession, AgentSubagent, AgentRepo } from '../types';

export const MIN_PROMPT_LENGTH = 4;

export interface ParseContext {
  subagents?: Pick<AgentSubagent, 'name'>[];
  repos?: Pick<AgentRepo, 'name' | 'path'>[];
}

export type ParsedInput =
  | { kind: 'empty' }
  | { kind: 'filter'; filter: SessionFilter; raw: string }
  | { kind: 'select-pr'; number: number | null; url: string | null; raw: string }
  | { kind: 'command'; command: string; args: string; raw: string }
  | { kind: 'exec'; command: string; raw: string }
  | { kind: 'too-short'; raw: string }
  | {
      kind: 'dispatch';
      prompt: string;
      agent: string | null;
      repo: Pick<AgentRepo, 'name' | 'path'> | null;
      raw: string;
    };

export interface SessionFilter {
  agent?: string;
  state?: string;
  prNumber?: number;
  url?: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

/** Remove ANSI escape sequences (colours, cursor movement, OSC titles) from terminal output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

const URL_RE = /^https?:\/\/\S+$/i;
const PR_URL_RE = /\/(?:pull|merge_requests)\/(\d+)/;

/**
 * Detect a "filter" expression (typed in the dispatch input to narrow the list).
 */
export function parseFilter(text: string): SessionFilter | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const agent = trimmed.match(/^a:(\S+)$/);
  if (agent) return { agent: agent[1] };
  const state = trimmed.match(/^s:(\S+)$/);
  if (state) return { state: state[1].toLowerCase() };
  const pr = trimmed.match(/^#(\d+)$/);
  if (pr) return { prNumber: Number(pr[1]) };
  if (URL_RE.test(trimmed) && !/\s/.test(trimmed)) return { url: trimmed };
  return null;
}

/**
 * Apply a filter to a list of sessions.
 */
export function applySessionFilter(
  sessions: AgentSession[],
  filter: SessionFilter | null
): AgentSession[] {
  if (!filter) return sessions;
  return sessions.filter((session) => {
    if (filter.agent) {
      const needle = filter.agent.toLowerCase();
      return (
        (session.agent || '').toLowerCase() === needle ||
        session.name.toLowerCase().includes(needle)
      );
    }
    if (filter.state) {
      const wanted = filter.state;
      const aliases: Record<string, string[]> = {
        working: ['working'],
        blocked: ['blocked'],
        'needs-input': ['blocked'],
        input: ['blocked'],
        done: ['done'],
        completed: ['done'],
        idle: ['done'],
        failed: ['failed'],
        stopped: ['stopped'],
        pinned: [],
      };
      if (wanted === 'pinned') return session.pinned;
      const states = aliases[wanted] || [wanted];
      return states.includes(session.state || '') || session.displayState === wanted;
    }
    if (filter.prNumber !== undefined) {
      return session.links.some((link) => link.number === filter.prNumber);
    }
    if (filter.url) {
      const url = filter.url;
      return (
        session.links.some((link) => link.href === url) || (session.intent || '').includes(url)
      );
    }
    return true;
  });
}

/**
 * Parse the dispatch input into an action.
 */
export function parseDispatchInput(text: string, context: ParseContext = {}): ParsedInput {
  const raw = text;
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'empty' };

  // PR selection: #1234 or a PR/MR URL (also acts as a filter)
  const prNumber = trimmed.match(/^#(\d+)$/);
  if (prNumber) return { kind: 'select-pr', number: Number(prNumber[1]), url: null, raw };
  if (URL_RE.test(trimmed) && PR_URL_RE.test(trimmed)) {
    const match = trimmed.match(PR_URL_RE);
    return { kind: 'select-pr', number: match ? Number(match[1]) : null, url: trimmed, raw };
  }

  const filter = parseFilter(trimmed);
  if (filter) return { kind: 'filter', filter, raw };

  if (trimmed.startsWith('!')) {
    const command = trimmed.slice(1).trim();
    if (!command) return { kind: 'too-short', raw };
    return { kind: 'exec', command, raw };
  }

  if (trimmed.startsWith('/')) {
    const match = trimmed.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (match)
      return { kind: 'command', command: match[1].toLowerCase(), args: match[2].trim(), raw };
  }

  const subagents = context.subagents || [];
  const repos = context.repos || [];
  let agent: string | null = null;
  let repo: Pick<AgentRepo, 'name' | 'path'> | null = null;
  let prompt = trimmed;

  // First word matching a subagent runs that subagent as the main agent
  const firstWord = trimmed.split(/\s+/)[0];
  const firstAgent = subagents.find((a) => a.name === firstWord);
  if (firstAgent && trimmed.length > firstWord.length) {
    agent = firstAgent.name;
    prompt = trimmed.slice(firstWord.length).trim();
  }

  // @mentions: subagent wins over repo when both match
  const mentionRe = /(^|\s)@([A-Za-z0-9_./-]+)/g;
  let mention: RegExpExecArray | null;
  const toStrip: string[] = [];
  while ((mention = mentionRe.exec(trimmed)) !== null) {
    const name = mention[2];
    const mentionedAgent = subagents.find((a) => a.name === name);
    if (mentionedAgent) {
      if (!agent) agent = mentionedAgent.name;
      toStrip.push(`@${name}`);
      continue;
    }
    const mentionedRepo = repos.find((r) => r.name === name);
    if (mentionedRepo && !repo) {
      repo = mentionedRepo;
      toStrip.push(`@${name}`);
    }
  }
  for (const token of toStrip) {
    prompt = prompt.replace(
      new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`),
      '$1'
    );
  }
  prompt = prompt.replace(/\s{2,}/g, ' ').trim();

  if (prompt.length < MIN_PROMPT_LENGTH) return { kind: 'too-short', raw };
  return { kind: 'dispatch', prompt, agent, repo, raw };
}

/**
 * Suggestion helpers for the dispatch input (Tab completion / popover).
 */
export interface Suggestion {
  type: 'agent' | 'repo' | 'command';
  label: string;
  description?: string;
  insert: string;
}

export function computeSuggestions(
  text: string,
  caret: number,
  context: {
    subagents: AgentSubagent[];
    repos: AgentRepo[];
    commands: { name: string; description: string }[];
  }
): { suggestions: Suggestion[]; replaceStart: number; replaceEnd: number } {
  const before = text.slice(0, caret);
  const empty = { suggestions: [], replaceStart: caret, replaceEnd: caret };

  // Slash command at the very beginning
  const slash = before.match(/^\/(\S*)$/);
  if (slash) {
    const needle = slash[1].toLowerCase();
    return {
      suggestions: context.commands
        .filter((c) => c.name.toLowerCase().startsWith(needle))
        .slice(0, 12)
        .map((c) => ({
          type: 'command',
          label: `/${c.name}`,
          description: c.description,
          insert: `/${c.name} `,
        })),
      replaceStart: 0,
      replaceEnd: caret,
    };
  }

  // @mention anywhere
  const at = before.match(/(?:^|\s)@([A-Za-z0-9_./-]*)$/);
  if (at) {
    const needle = at[1].toLowerCase();
    const start = caret - at[1].length - 1;
    const agents: Suggestion[] = context.subagents
      .filter((a) => a.name.toLowerCase().startsWith(needle))
      .map((a) => ({
        type: 'agent',
        label: `@${a.name}`,
        description: a.description,
        insert: `@${a.name} `,
      }));
    const repos: Suggestion[] = context.repos
      .filter((r) => r.name.toLowerCase().startsWith(needle))
      .map((r) => ({
        type: 'repo',
        label: `@${r.name}`,
        description: r.path,
        insert: `@${r.name} `,
      }));
    return {
      suggestions: [...agents, ...repos].slice(0, 12),
      replaceStart: start,
      replaceEnd: caret,
    };
  }

  // Empty input + Tab browses subagents
  if (!text.trim()) {
    return {
      suggestions: context.subagents.map((a) => ({
        type: 'agent',
        label: a.name,
        description: a.description,
        insert: `${a.name} `,
      })),
      replaceStart: 0,
      replaceEnd: text.length,
    };
  }

  return empty;
}

/**
 * Parse numbered choices out of a session's recent output (permission prompts, questions).
 * Returns e.g. [{ number: 1, label: 'Yes' }, { number: 2, label: 'No' }].
 */
export function extractNumberedChoices(output: string): { number: number; label: string }[] {
  const clean = stripAnsi(output);
  const lines = clean.split(/\r?\n/).slice(-60);
  const choices: { number: number; label: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[❯>]\s*)?(\d)[.):]\s+(.+?)\s*$/);
    if (match) {
      const number = Number(match[1]);
      if (!choices.some((c) => c.number === number))
        choices.push({ number, label: match[2].trim() });
    }
  }
  // Keep the last contiguous block starting at 1
  const sorted = choices.sort((a, b) => a.number - b.number);
  if (sorted.length === 0 || sorted[0].number !== 1) return [];
  const contiguous: { number: number; label: string }[] = [];
  for (const choice of sorted) {
    if (choice.number === contiguous.length + 1) contiguous.push(choice);
    else break;
  }
  return contiguous;
}
