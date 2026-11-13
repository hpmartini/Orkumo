/**
 * Artifacts of an agent session for its UI view: files the agent's tools created or edited,
 * derived from the view's events (chatService's replay buffer, Claude stream-json shapes), plus
 * omp's session documents (`local://`, stored in `<session file without .jsonl>/local/`).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Largest artifact the preview returns */
export const MAX_ARTIFACT_BYTES = 1024 * 1024;
/** Session documents listed at most (a runaway agent must not stall the route) */
const MAX_DOCUMENTS = 200;
const MAX_DOCUMENT_DEPTH = 4;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
/** `local://`, `proc://`, `agent://`, ... : omp's internal URIs, no files of the project */
const URI_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Tools whose `file_path` names the file they change (omp's write/edit are mapped to these) */
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Paths an omp patch-style `edit` touches: hashline headers `[path#TAG]` and `MV dest`, or
 * apply_patch headers (`*** Add File:` creates, `*** Update File:` / `*** Move to:` edit).
 * @returns {{ path: string, create: boolean }[]}
 */
export function patchPaths(input) {
  const touched = [];
  for (const line of str(input).split('\n')) {
    let m = line.match(/^\[(.+)#[0-9A-F]{4}\]\s*$/);
    if (m) {
      touched.push({ path: m[1], create: false });
      continue;
    }
    m = line.match(/^MV\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/);
    if (m) {
      touched.push({ path: m[1] ?? m[2] ?? m[3], create: false });
      continue;
    }
    m = line.match(/^\*\*\* (Add File|Update File|Move to): (.+?)\s*$/);
    if (m) touched.push({ path: m[2], create: m[1] === 'Add File' });
  }
  return touched;
}

/** Files one tool call writes: `create` for a new file, else an edit */
function toolTouches(name, input) {
  if (FILE_TOOLS.has(name)) {
    const file = str(input.file_path) || str(input.notebook_path);
    return file ? [{ path: file, create: name === 'Write' }] : [];
  }
  // omp's hashline / patch edit keeps its own name (chatTranscripts.mapTool)
  if (name === 'edit' && typeof input.input === 'string') return patchPaths(input.input);
  return [];
}

/** Text of a tool result (string or text blocks) */
const resultText = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c) => (isObj(c) ? str(c.text) : '')).join('\n')
      : '';

/**
 * Tool path → absolute file. `local://x` resolves into the session's document folder (null
 * without one); every other URI scheme is no file.
 */
function resolveToolPath(file, cwd, documentDir) {
  const scheme = file.match(URI_RE);
  if (scheme) {
    if (scheme[1].toLowerCase() !== 'local' || !documentDir) return null;
    const rel = file.slice(scheme[0].length);
    const target = path.resolve(documentDir, rel);
    return target.startsWith(documentDir + path.sep) ? target : null;
  }
  if (file === '~' || file.startsWith('~/')) return path.join(os.homedir(), file.slice(1));
  return path.resolve(cwd, file);
}

/**
 * Running record of the file tool calls of a session. The view's replay buffer is capped, so
 * chatService feeds every event in here as it arrives; only file calls and their outcome stay.
 */
export function createArtifactLog() {
  return { calls: new Map(), results: new Map() };
}

/** Fold one view event (assistant tool_use blocks, user tool_result blocks) into the log */
export function logArtifactEvent(log, event) {
  const content = isObj(event?.message) ? event.message.content : null;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isObj(block)) continue;
    if (event.type === 'assistant' && block.type === 'tool_use') {
      const touches = toolTouches(str(block.name), isObj(block.input) ? block.input : {});
      if (touches.length) log.calls.set(str(block.id), touches);
    } else if (event.type === 'user' && block.type === 'tool_result') {
      const id = str(block.tool_use_id);
      if (!log.calls.has(id)) continue;
      log.results.set(id, {
        error: block.is_error === true,
        overwrote: /has been (updated|overwritten)/i.test(resultText(block.content)),
      });
    }
  }
}

/**
 * Files the session's tools created or edited, newest touch first, one entry per path.
 * The first touch decides created vs. edited: a file the agent created stays created however
 * often it edits it later; a Write over an existing file (Claude reports "has been updated")
 * is an edit. Failed tool calls touch nothing; calls without a result yet count.
 * @param {ReturnType<typeof createArtifactLog>} log
 * @param {string} cwd session directory relative paths resolve against
 * @param {string|null} documentDir omp's `local://` folder
 * @returns {{ path: string, action: 'created'|'edited' }[]}
 */
export function toolArtifacts(log, cwd, documentDir = null) {
  const files = new Map();
  for (const [id, touches] of log.calls) {
    const result = log.results.get(id);
    if (result?.error) continue;
    for (const touch of touches) {
      const file = resolveToolPath(touch.path, cwd, documentDir);
      if (!file) continue;
      const action =
        files.get(file)?.action ?? (touch.create && !result?.overwrote ? 'created' : 'edited');
      // Re-inserted, so the Map's order is the order of the latest touch
      files.delete(file);
      files.set(file, { path: file, action });
    }
  }
  return [...files.values()].reverse();
}

/** `toolArtifacts` of a list of view events */
export function extractToolArtifacts(events, cwd, documentDir = null) {
  const log = createArtifactLog();
  for (const event of events) logArtifactEvent(log, event);
  return toolArtifacts(log, cwd, documentDir);
}

/** Files below omp's session document folder (`local://`), depth- and count-limited */
export function listDocuments(documentDir) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_DOCUMENTS) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DOCUMENT_DEPTH) walk(full, depth + 1);
      } else if (entry.isFile()) found.push(full);
    }
  };
  if (documentDir) walk(documentDir, 1);
  return found;
}

function describe(file, kind, action) {
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    // deleted since, or never written (pending call)
  }
  return {
    path: file,
    name: path.basename(file),
    kind,
    action,
    size: stat?.isFile() ? stat.size : null,
    mtime: stat ? stat.mtimeMs : null,
    exists: !!stat,
  };
}

/**
 * The artifact list: session documents (newest first), then created and edited files (newest
 * touch first). A document the agent wrote through a tool keeps the tool's action.
 * @param {ReturnType<typeof createArtifactLog>} log
 */
export function sessionArtifacts(log, cwd, documentDir = null) {
  const touched = toolArtifacts(log, cwd, documentDir);
  const byPath = new Map(touched.map((t) => [t.path, t.action]));
  const docs = new Set(listDocuments(documentDir));
  const inDocs = (file) => !!documentDir && file.startsWith(documentDir + path.sep);
  for (const t of touched) if (inDocs(t.path)) docs.add(t.path);
  const documents = [...docs]
    .map((file) => describe(file, 'document', byPath.get(file) ?? 'created'))
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  const files = touched
    .filter((t) => !inDocs(t.path))
    .map((t) => describe(t.path, 'file', t.action));
  return [...documents, ...files];
}

const realOrNull = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

const inside = (real, dir) => real === dir || real.startsWith(dir + path.sep);

/**
 * Text of one listed artifact. Only a path of `artifacts` qualifies, and only under the
 * project directories or the session's document folder (symlinks resolved); text up to 1 MB.
 * @returns {{ path: string, content: string, size: number, mtime: number }}
 */
export function artifactContent(artifacts, file, roots) {
  const listed = typeof file === 'string' && artifacts.some((a) => a.path === file);
  if (!listed) throw httpError(404, 'Not an artifact of this session');
  const real = realOrNull(file);
  if (!real) throw httpError(404, 'The file no longer exists');
  const realRoots = roots.filter(Boolean).map(realOrNull).filter(Boolean);
  if (!realRoots.some((root) => inside(real, root)))
    throw httpError(403, 'Outside the project directories: open it in VS Code or Finder instead');
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw httpError(415, 'Not a file');
  if (stat.size > MAX_ARTIFACT_BYTES)
    throw httpError(413, 'Too large to preview (over 1 MB): open it in VS Code');
  const buffer = fs.readFileSync(real);
  if (buffer.subarray(0, 8192).includes(0))
    throw httpError(415, 'Binary file: open it in VS Code or Finder');
  return { path: file, content: buffer.toString('utf8'), size: stat.size, mtime: stat.mtimeMs };
}
