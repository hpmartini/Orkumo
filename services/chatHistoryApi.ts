/**
 * API client for the chat history (#280, `/api/chat-history`): claude.ai / ChatGPT conversations,
 * synced by the desktop app (electron/chatSync.js, `window.electronAPI.chatSync`) or imported
 * from a data export, plus the chats started in Orkumo (#19, source `orkumo`: agent sessions in
 * the chats folder, read from their transcripts). The sync's ingest route is for the Electron
 * main process only.
 */
import { request } from './boardApi';
import type { AgentHarness } from '../types';

/** A provider on the web whose history Orkumo reads */
export type ChatProvider = 'claude' | 'chatgpt';
/** Where a listed conversation comes from */
export type ChatSource = ChatProvider | 'orkumo';

export interface ChatHistoryItem {
  id: string;
  provider: ChatSource;
  title: string;
  createdAt: number | null;
  updatedAt: number | null;
  project: string | null;
  projectName: string | null;
  topic: string;
  messageCount: number;
  snippet: string;
  /** Local order (#19 AK-5, `<data>/chat-history/meta.json`); the provider's data stays as is */
  pinned: boolean;
  folder: string | null;
  archived: boolean;
  /** Orkumo chats: the agent session behind it */
  harness?: AgentHarness;
  sessionId?: string;
  cwd?: string;
}

export interface ChatHistoryGroup {
  id: string;
  name: string;
  count: number;
}

export interface ChatHistoryList {
  total: number;
  counts: Record<ChatSource, number>;
  projects: ChatHistoryGroup[];
  topics: ChatHistoryGroup[];
  folders: ChatHistoryGroup[];
  items: ChatHistoryItem[];
  tookMs: number;
}

export interface ChatHistoryConversation extends Omit<ChatHistoryItem, 'snippet'> {
  messages: { role: 'user' | 'assistant'; text: string; at: number | null }[];
}

export interface ChatHistoryQuery {
  q?: string;
  provider?: ChatSource | null;
  project?: string | null;
  topic?: string | null;
  folder?: string | null;
  /** true: only archived conversations; else archived ones are left out */
  archived?: boolean;
  from?: number | null;
  to?: number | null;
  limit?: number;
}

/** Local metadata of one conversation; `null` clears a field */
export interface ChatMetaPatch {
  title?: string | null;
  pinned?: boolean;
  folder?: string | null;
  archived?: boolean;
}

export interface ChatImportReport {
  files: {
    file: string;
    provider: ChatProvider | null;
    found: number;
    imported: number;
    skipped: Record<string, number>;
    error?: string;
  }[];
  counts: Record<ChatSource, number>;
}

export function fetchChatHistory(query: ChatHistoryQuery): Promise<ChatHistoryList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value != null && value !== '' && value !== false) params.set(key, String(value));
  return request<ChatHistoryList>(`/chat-history?${params}`);
}

export const fetchChatConversation = (id: string): Promise<ChatHistoryConversation> =>
  request<ChatHistoryConversation>(`/chat-history/conversation?id=${encodeURIComponent(id)}`);

/** Pin, rename, file into a folder or archive a conversation (#19 AK-5) */
export const updateChatMeta = (id: string, patch: ChatMetaPatch): Promise<ChatHistoryItem> =>
  request<ChatHistoryItem>('/chat-history/meta', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...patch }),
  });

/** Read an unpacked export folder (or one conversations.json) on the server's machine */
export const importChatExport = (path: string): Promise<ChatImportReport> =>
  request<ChatImportReport>('/chat-history/import', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
