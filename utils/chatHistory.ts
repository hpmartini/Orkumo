import type { ChatHistoryConversation } from '../services/chatHistoryApi';
import type { AgentHarness } from '../types';

export const PROVIDER_LABEL = { claude: 'Claude', chatgpt: 'ChatGPT' } as const;

/** Where a conversation lives on the web, and where its provider's login is (built-in browser) */
export const PROVIDER_SITE = { claude: 'claude.ai', chatgpt: 'chatgpt.com' } as const;
export const PROVIDER_LOGIN = {
  claude: 'https://claude.ai/login',
  chatgpt: 'https://chatgpt.com/auth/login',
} as const;

/** The conversation on claude.ai / chatgpt.com (ids are `<provider>:<provider id>`) */
export function conversationUrl(c: Pick<ChatHistoryConversation, 'id' | 'provider'>): string {
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
  ChatHistoryConversation['provider'],
  AgentHarness
>;

// shortcut: the transcript travels inside the prompt, so long ones keep only their end;
// hand it over as a file once chats take attachments
const MAX_TRANSCRIPT = 24000;

/** Prompt that carries an imported conversation into a new Orkumo chat */
export function continuePrompt(conversation: ChatHistoryConversation): string {
  const source = PROVIDER_LABEL[conversation.provider];
  const transcript = conversation.messages
    .map((m) => `${m.role === 'user' ? 'User' : source}: ${m.text}`)
    .join('\n\n');
  const cut = transcript.length > MAX_TRANSCRIPT;
  return [
    `We continue a conversation from ${source}: "${conversation.title}".`,
    cut ? 'Its beginning is left out, this is how it ended:' : 'This is the conversation so far:',
    '',
    cut ? `…${transcript.slice(-MAX_TRANSCRIPT)}` : transcript,
    '',
    'Continue from here: ',
  ].join('\n');
}

/** Local day (`YYYY-MM-DD` of a date input) as ms; `end` = its last millisecond */
export function dayBound(day: string, end = false): number | null {
  const time = new Date(`${day}T00:00:00`).getTime();
  return day && Number.isFinite(time) ? time + (end ? 86_400_000 - 1 : 0) : null;
}
