/**
 * API client for the chat history (#280, `/api/chat-history`): claude.ai / ChatGPT conversations,
 * synced by the desktop app (electron/chatSync.js, `window.electronAPI.chatSync`) or imported
 * from a data export. The sync's ingest route is for the Electron main process only.
 */
import { request } from './boardApi';

export type ChatProvider = 'claude' | 'chatgpt';

export interface ChatHistoryItem {
  id: string;
  provider: ChatProvider;
  title: string;
  createdAt: number | null;
  updatedAt: number | null;
  project: string | null;
  projectName: string | null;
  topic: string;
  messageCount: number;
  snippet: string;
}

export interface ChatHistoryGroup {
  id: string;
  name: string;
  count: number;
}

export interface ChatHistoryList {
  total: number;
  counts: Record<ChatProvider, number>;
  projects: ChatHistoryGroup[];
  topics: ChatHistoryGroup[];
  items: ChatHistoryItem[];
  tookMs: number;
}

export interface ChatHistoryConversation extends Omit<ChatHistoryItem, 'snippet'> {
  messages: { role: 'user' | 'assistant'; text: string; at: number | null }[];
}

export interface ChatHistoryQuery {
  q?: string;
  provider?: ChatProvider | null;
  project?: string | null;
  topic?: string | null;
  from?: number | null;
  to?: number | null;
  limit?: number;
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
  counts: Record<ChatProvider, number>;
}

export function fetchChatHistory(query: ChatHistoryQuery): Promise<ChatHistoryList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value != null && value !== '') params.set(key, String(value));
  return request<ChatHistoryList>(`/chat-history?${params}`);
}

export const fetchChatConversation = (id: string): Promise<ChatHistoryConversation> =>
  request<ChatHistoryConversation>(`/chat-history/conversation?id=${encodeURIComponent(id)}`);

/** Read an unpacked export folder (or one conversations.json) on the server's machine */
export const importChatExport = (path: string): Promise<ChatImportReport> =>
  request<ChatImportReport>('/chat-history/import', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
