import toast from 'react-hot-toast';
import { API_BASE_URL } from './apiConfig';

export interface OpenFileOptions {
  /** VS Code, in the window of the session's project (else the Mac's default app) */
  editor?: boolean;
  /** Show the file in Finder instead of opening it */
  reveal?: boolean;
  line?: number;
  col?: number;
}

/**
 * Open a file path the user clicked (#188): VS Code via /api/files/open-in-editor, the default
 * app or Finder via /api/files/open. Relative paths resolve against `cwd`. The server keeps
 * folders and launchable files in Finder; failures surface as a toast.
 */
export async function openFile(path: string, cwd: string, options: OpenFileOptions = {}) {
  const { editor = false, reveal = false, line, col } = options;
  try {
    const res = await fetch(`${API_BASE_URL}/files/${editor ? 'open-in-editor' : 'open'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        editor ? { path, cwd, line, col } : reveal ? { path, cwd, reveal } : { path, cwd }
      ),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || res.statusText);
    if (body?.action === 'revealed' && !reveal)
      toast(`Startbare Datei, im Finder gezeigt: ${path}`);
  } catch (err) {
    toast.error(`Datei öffnen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}
