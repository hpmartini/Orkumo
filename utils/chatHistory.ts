import type { ChatHistoryConversation } from '../services/chatHistoryApi';
import type { AgentHarness } from '../types';

export const PROVIDER_LABEL = { claude: 'Claude', chatgpt: 'ChatGPT' } as const;

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
