import type { ChatHistoryConversation, ChatProvider } from '../services/chatHistoryApi';
import type { AgentHarness } from '../types';
import { DISPATCH_PROMPT_MAX, MAX_HARNESS_PROMPT } from '../config/limits.js';

/** Where a conversation comes from: claude.ai, chatgpt.com, or a chat started in Orkumo (#19 AK-4) */
export const PROVIDER_LABEL = { claude: 'Claude', chatgpt: 'ChatGPT', orkumo: 'Orkumo' } as const;

/** Where a conversation lives on the web, and where its provider's login is (built-in browser) */
export const PROVIDER_SITE = { claude: 'claude.ai', chatgpt: 'chatgpt.com' } as const;
export const PROVIDER_LOGIN = {
  claude: 'https://claude.ai/login',
  chatgpt: 'https://chatgpt.com/auth/login',
} as const;

/** A provider on the web (claude.ai, chatgpt.com), not an Orkumo chat */
export const isWebProvider = (provider: string): provider is ChatProvider =>
  provider === 'claude' || provider === 'chatgpt';

/** The conversation on claude.ai / chatgpt.com (ids are `<provider>:<provider id>`); null for Orkumo chats */
export function conversationUrl(
  c: Pick<ChatHistoryConversation, 'id' | 'provider'>
): string | null {
  if (!isWebProvider(c.provider)) return null;
  const id = encodeURIComponent(c.id.slice(c.provider.length + 1));
  return c.provider === 'claude' ? `https://claude.ai/chat/${id}` : `https://chatgpt.com/c/${id}`;
}

export const RECENCY = ['Today', 'Yesterday', 'This week', 'Older'] as const;
export type Recency = (typeof RECENCY)[number];

const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/** Rail section of a last activity, in local days; "This week" = the 7 days before yesterday */
export function recencyOf(time: number | null, now = Date.now()): Recency {
  if (time == null) return 'Older';
  const today = startOfDay(now);
  if (time >= today) return 'Today';
  const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
  if (time >= yesterday) return 'Yesterday';
  return time >= new Date(today).setDate(new Date(today).getDate() - 7) ? 'This week' : 'Older';
}

/** Short age for a rail row: "now", "5m", "3h", a weekday this week, else the date */
export function relativeTime(time: number | null, now = Date.now()): string {
  if (time == null) return '';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (time >= startOfDay(now)) return `${Math.floor(minutes / 60)}h`;
  const date = new Date(time);
  if (recencyOf(time, now) !== 'Older')
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Harness a continued conversation runs on: the CLI of the same subscription (#251) */
export const PROVIDER_HARNESS = { claude: 'claude', chatgpt: 'codex' } as const satisfies Record<
  ChatProvider,
  AgentHarness
>;

/** Longest start prompt a harness takes: `POST /api/agents/dispatch` for Claude Code, else the PTY's */
export const promptLimit = (harness: AgentHarness): number =>
  harness === 'claude' ? DISPATCH_PROMPT_MAX : MAX_HARNESS_PROMPT;

/**
 * Prompt that carries an imported conversation into a new Orkumo chat, at most `max` characters
 * less room for what the user adds before sending (#19 AK-7: a long history overran the dispatch
 * limit). `file`: the whole conversation stored as Markdown (`conversationMarkdown`), handed
 * over by path; the prompt then repeats only as much of its end as fits.
 */
export function continuePrompt(
  conversation: ChatHistoryConversation,
  max: number = DISPATCH_PROMPT_MAX,
  file: string | null = null
): string {
  const source = PROVIDER_LABEL[conversation.provider];
  const title = conversation.title.slice(0, 200);
  const transcript = conversation.messages
    .map((m) => `${m.role === 'user' ? 'User' : source}: ${m.text}`)
    .join('\n\n');
  const budget = max - Math.min(2000, Math.floor(max / 5));
  const lines = (intro: string, body: string) =>
    [
      `We continue a conversation from ${source}: "${title}".`,
      ...(file ? [`The whole conversation is in this file: [File: ${file}]`] : []),
      intro,
      '',
      body,
      '',
      'Continue from here: ',
    ].join('\n');
  const whole = lines('This is the conversation so far:', transcript);
  if (whole.length <= budget) return whole;
  const intro = file ? 'Its end:' : 'Its beginning is left out, this is how it ended:';
  const room = budget - lines(intro, '…').length;
  return lines(intro, room > 0 ? `…${transcript.slice(-room)}` : '…');
}

/** File name of a conversation's Markdown export: its title, safe on every file system */
export function markdownFileName(conversation: Pick<ChatHistoryConversation, 'title'>): string {
  const base = conversation.title
    .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'chat'}.md`;
}

const isoDay = (time: number | null) => (time ? new Date(time).toISOString().slice(0, 10) : null);

/** A conversation as Markdown (#19 AK-6): title, source, dates, then every message */
export function conversationMarkdown(conversation: ChatHistoryConversation): string {
  const source = PROVIDER_LABEL[conversation.provider];
  const facts = [
    `Source: ${source}${conversation.harness ? ` (${conversation.harness})` : ''}`,
    conversation.createdAt && `Started: ${isoDay(conversation.createdAt)}`,
    conversation.updatedAt && `Last activity: ${isoDay(conversation.updatedAt)}`,
    conversation.projectName && `Project: ${conversation.projectName}`,
    conversation.provider !== 'orkumo' && `Link: ${conversationUrl(conversation)}`,
  ].filter(Boolean);
  const messages = conversation.messages.map((m) => {
    const at = m.at ? ` · ${new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')}` : '';
    return `## ${m.role === 'user' ? 'User' : source}${at}\n\n${m.text.trim()}`;
  });
  return [
    `# ${conversation.title}`,
    facts.map((f) => `- ${f}`).join('\n'),
    '---',
    ...messages,
  ].join('\n\n') + '\n';
}

/** Local day (`YYYY-MM-DD` of a date input) as ms; `end` = its last millisecond */
export function dayBound(day: string, end = false): number | null {
  const time = new Date(`${day}T00:00:00`).getTime();
  return day && Number.isFinite(time) ? time + (end ? 86_400_000 - 1 : 0) : null;
}
