/**
 * Shared rules of the task / agent / issue composers (#105): Enter inserts a newline,
 * Cmd+Enter (Ctrl+Enter off macOS) submits, Cmd+Shift+Enter submits and attaches.
 */
import { ATTACHMENT_EXTENSIONS } from '../config/limits.js';

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  nativeEvent?: { isComposing?: boolean };
}

/** null = not a submit key (plain Enter stays a newline) */
export function submitIntent(e: KeyLike): { attach: boolean } | null {
  if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  return { attach: e.shiftKey };
}

/** Image files of a paste / drop / file-input list */
export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list || []).filter((f) => f.type.startsWith('image/'));
}

/** Images the agents' image store takes (`POST /api/agents/images` sniffs the same four) */
export const PROMPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const extensionOf = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * Files a chat or agent prompt can carry (#19 AK-3): the four image types, else PDF, text and
 * code by extension (config/limits.js; the server checks the content).
 */
export function attachableFiles(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list || []).filter(
    (f) =>
      PROMPT_IMAGE_TYPES.includes(f.type) ||
      (ATTACHMENT_EXTENSIONS as readonly string[]).includes(extensionOf(f.name))
  );
}

/** An attachment stored on the server: images go to Claude Code as images, files by path */
export interface StoredAttachment {
  path: string;
  kind: 'image' | 'file';
}

/**
 * Prompt with the stored attachments appended: `[Image: <path>]` the way Claude Code references
 * pasted images, `[File: <path>]` for documents the agent reads itself
 */
export function promptWithAttachments(prompt: string, stored: StoredAttachment[]): string {
  const text = prompt.trim();
  if (stored.length === 0) return text;
  return [text, ...stored.map((a) => `[${a.kind === 'image' ? 'Image' : 'File'}: ${a.path}]`)]
    .filter(Boolean)
    .join('\n');
}

/** Issue body with the uploaded images embedded as Markdown */
export function bodyWithImages(body: string, urls: string[]): string {
  if (urls.length === 0) return body;
  const images = urls.map((url, i) => `![image-${i + 1}](${url})`).join('\n');
  return body.trim() ? `${body.trimEnd()}\n\n${images}` : images;
}

/** Task text -> issue fields when switching dialogs (#271): first line is the title (GitHub limit 256) */
export function taskToIssueDraft(text: string): { title: string; body: string } {
  const [first = '', ...rest] = text.trim().split('\n');
  const title = first.trim();
  return title.length > 256
    ? { title: '', body: text.trim() }
    : { title, body: rest.join('\n').trim() };
}

/** Issue fields -> task text; the inverse of taskToIssueDraft */
export function issueDraftToTask(draft: { title: string; body: string }): string {
  return [draft.title.trim(), draft.body.trim()].filter(Boolean).join('\n\n');
}
