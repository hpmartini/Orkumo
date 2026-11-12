/**
 * Shared rules of the task / agent / issue composers (#105): Enter inserts a newline,
 * Cmd+Enter (Ctrl+Enter off macOS) submits, Cmd+Shift+Enter submits and attaches.
 */

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

/** Prompt with the stored image paths appended, the way Claude Code references pasted images */
export function promptWithImages(prompt: string, paths: string[]): string {
  const text = prompt.trim();
  if (paths.length === 0) return text;
  return [text, ...paths.map((p) => `[Image: ${p}]`)].filter(Boolean).join('\n');
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
