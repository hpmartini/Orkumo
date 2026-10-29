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
