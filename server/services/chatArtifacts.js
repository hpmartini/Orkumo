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
  return {
    calls: new Map(),
    results: new Map(),
    /** Artifact publish calls waiting for their result: tool id → input */
    publishing: new Map(),
    /** claude.ai pages: url → { url, file, label, description, version, updatedAt, typeHint } */
    published: new Map(),
    /** pages only read or linked: url → 'read' | 'linked' */
    mentioned: new Map(),
  };
}

/** A page hosted on claude.ai (Claude Code's Artifact tool) */
const ARTIFACT_URL_RE = /https:\/\/claude\.ai\/artifact\/[\w-]+/g;
/** Result of a publish: "Published <file> at <url> (Version 48, version id 1794504144-e5d6)" */
const PUBLISHED_RE =
  /(?:Published (\S+) at|(?:Created a new|Updated the) Artifact at) (https:\/\/claude\.ai\/artifact\/[\w-]+)/;

/** Fold one Artifact tool call or its result into the log; reads only mark the page as read */
function logArtifactTool(log, block) {
  const input = isObj(block.input) ? block.input : {};
  const action = str(input.action) || 'publish';
  if (action === 'read') {
    const url = str(input.url).match(ARTIFACT_URL_RE)?.[0];
    if (url && !log.mentioned.has(url)) log.mentioned.set(url, 'read');
  } else if (action === 'publish' && input.asset !== true) log.publishing.set(str(block.id), input);
}

function logArtifactResult(log, block) {
  const id = str(block.tool_use_id);
  const input = log.publishing.get(id);
  if (!input) return;
  log.publishing.delete(id);
  const text = resultText(block.content);
  const hit = block.is_error === true ? null : PUBLISHED_RE.exec(text);
  if (!hit) return;
  const url = hit[2];
  const prev = log.published.get(url);
  const versionId = /version id (\d{9,})-/.exec(text);
  // An update often names only the file: label, description and title of earlier publishes stay
  log.published.set(url, {
    url,
    file: hit[1] ?? (str(input.file_path) || prev?.file || null),
    title: str(input.title) || prev?.title || null,
    label: str(input.label) || prev?.label || null,
    description: str(input.description) || prev?.description || null,
    version: Number(/\(Version (\d+)/i.exec(text)?.[1]) || prev?.version || null,
    updatedAt: versionId ? Number(versionId[1]) * 1000 : (prev?.updatedAt ?? null),
    typeUrl: str(input.type_url) || prev?.typeUrl || null,
  });
}

/** Fold one view event (assistant tool_use blocks, user tool_result blocks) into the log */
export function logArtifactEvent(log, event) {
  const content = isObj(event?.message) ? event.message.content : null;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isObj(block)) continue;
    // Links in the agent's own text only: tool results carry pages written by others
    if (event.type === 'assistant' && block.type === 'text')
      for (const url of str(block.text).match(ARTIFACT_URL_RE) ?? [])
        if (log.mentioned.get(url) !== 'linked') log.mentioned.set(url, 'linked');
    if (event.type === 'assistant' && block.type === 'tool_use' && block.name === 'Artifact')
      logArtifactTool(log, block);
    else if (event.type === 'user' && block.type === 'tool_result' && log.publishing.size)
      logArtifactResult(log, block);
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

/** Bytes of a page's source read for its <title> and type: the modal polls, keep it small */
const PAGE_HEAD_BYTES = 64 * 1024;

/** Kind of hosted page by keywords; checked in this order, the first hit wins */
const PAGE_TYPES = [
  ['Slides', /slide|deck\b|folien|präsentation|presentation|reveal\.js/i],
  ['Dashboard', /dashboard|kpi|metrics|kennzahl|scorecard|chart\.js|echarts|<canvas/i],
  ['Design', /design|mock-?up|prototyp|wireframe|entwurf/i],
  [
    'Document',
    /dokument|document|memo|bericht|report|spec|journal|notes|notizen|protokoll|\bplan/i,
  ],
];

/** Head of a page's local source; '' when it is gone or unreadable */
function pageHead(file) {
  if (!file) return '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(PAGE_HEAD_BYTES);
    return buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, PAGE_HEAD_BYTES, 0));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Type hint of a hosted page: its type link, label, description and title, then the file
 * name, then the source's head; 'Page' without a hit.
 */
export function pageType({ typeUrl, title, label, description, file }, head = '') {
  const sources = [
    typeUrl,
    [title, label, description].filter(Boolean).join(' '),
    file && path.basename(file),
    head,
  ];
  for (const text of sources)
    if (text) for (const [type, re] of PAGE_TYPES) if (re.test(text)) return type;
  return 'Page';
}

/**
 * claude.ai pages of the session: published ones (one entry per URL, its newest version,
 * newest first), then pages the agent only read or linked to.
 * @returns {{ url: string, source: 'published'|'read'|'linked', title: string|null,
 *   label: string|null, description: string|null, version: number|null,
 *   updatedAt: number|null, file: string|null, type: string }[]}
 */
export function claudeArtifacts(log) {
  const published = [...log.published.values()].reverse().map((p) => {
    const head = pageHead(p.file);
    const htmlTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1].trim() || null;
    const title = p.title ?? htmlTitle;
    return {
      url: p.url,
      source: 'published',
      title,
      label: p.label,
      description: p.description,
      version: p.version,
      updatedAt: p.updatedAt,
      file: p.file,
      type: pageType({ ...p, title }, head),
    };
  });
  published.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const other = [...log.mentioned]
    .filter(([url]) => !log.published.has(url))
    .map(([url, source]) => ({
      url,
      source,
      title: null,
      label: null,
      description: null,
      version: null,
      updatedAt: null,
      file: null,
      type: 'Page',
    }));
  return [...published, ...other];
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
