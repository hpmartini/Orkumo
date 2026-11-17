/**
 * What a claude.ai / ChatGPT message shows besides its text: artifacts and canvases, uploaded
 * and generated files and images, tool calls with their results, cited sources. Read from the
 * providers' detail responses (and the data exports, same shapes) into `parts`, in the order the
 * provider shows them; a message whose only content is text gets no `parts` (its `text` is enough).
 *
 * The shapes are undocumented. Every field is optional here; an unknown block is skipped, never
 * thrown on. Sizes are capped so one huge artifact or tool output cannot bloat the store.
 *
 * Part types (mirrored by `ChatPart` in services/chatHistoryApi.ts):
 *   text      { text }
 *   thinking  { text }
 *   artifact  { id, title, kind, language?, content, version }
 *   file      { name, mime?, size?, content?, asset? }   asset: provider path of an image preview
 *   image     { name?, asset? }
 *   tool      { name, input?, output?, error? }
 *   sources   { items: [{ title, url }] }
 */

export const MAX_ARTIFACT_CHARS = 200_000;
export const MAX_FILE_CHARS = 20_000;
export const MAX_TOOL_CHARS = 4_000;
const MAX_SOURCES = 40;

const cap = (value, max) =>
  typeof value !== 'string' ? undefined : value.length > max ? `${value.slice(0, max)}\n…` : value;
const str = (value) => (typeof value === 'string' && value ? value : undefined);
const httpUrl = (value) =>
  typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
const short = (value) =>
  value == null
    ? undefined
    : cap(typeof value === 'string' ? value : JSON.stringify(value, null, 2), MAX_TOOL_CHARS);
const basename = (p) => (typeof p === 'string' ? p.split('/').filter(Boolean).pop() : undefined);

/** Unique http(s) sources; `null` when none */
function sources(list) {
  const seen = new Set();
  const items = [];
  for (const s of list) {
    const url = httpUrl(s?.url);
    if (!url || seen.has(url) || items.length >= MAX_SOURCES) continue;
    seen.add(url);
    items.push({ title: str(s.title) ?? new URL(url).hostname, url });
  }
  return items.length ? { type: 'sources', items } : null;
}

/** Text of a tool result's content (string or blocks) */
const resultText = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
          .filter(Boolean)
          .join('\n')
      : undefined;

/**
 * Keeps the current text of every artifact of one conversation, so an update (a replacement in
 * an earlier version) shows the whole artifact as it stood after that turn.
 */
export function artifactBook() {
  const docs = new Map();
  return {
    put(id, { title, kind, language, content }) {
      const before = docs.get(id);
      const doc = {
        id,
        title: title ?? before?.title ?? id,
        kind: kind ?? before?.kind ?? 'text/markdown',
        language: language ?? before?.language,
        content: content ?? '',
        version: (before?.version ?? 0) + 1,
      };
      docs.set(id, doc);
      return { type: 'artifact', ...doc, content: cap(doc.content, MAX_ARTIFACT_CHARS) };
    },
    /** `replace(old)` returns the new text, or null when the artifact is unknown */
    edit(id, replace, meta = {}) {
      const before = docs.get(id);
      if (!before) return null;
      return this.put(id, { ...meta, content: replace(before.content) });
    },
    last: () => [...docs.keys()].pop() ?? null,
  };
}

const KIND_BY_EXT = {
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  jsx: 'application/vnd.ant.react',
  tsx: 'application/vnd.ant.react',
  mermaid: 'application/vnd.ant.mermaid',
};
const kindOfPath = (p) => {
  const ext = (basename(p) ?? '').split('.').pop()?.toLowerCase() ?? '';
  return KIND_BY_EXT[ext] ?? 'application/vnd.ant.code';
};
const langOfPath = (p) => (basename(p) ?? '').split('.').pop()?.toLowerCase();

// ---------------------------------------------------------------------------
// claude.ai
// ---------------------------------------------------------------------------

/** A Claude tool call as part(s): artifacts become artifacts, the rest a tool line */
function claudeToolUse(block, book) {
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  const name = str(block.name) ?? 'tool';
  if (name === 'artifacts') {
    const id = str(input.id) ?? `artifact-${book.last() ?? 0}`;
    const meta = { title: str(input.title), kind: str(input.type), language: str(input.language) };
    if (input.command === 'update' && typeof input.old_str === 'string')
      return book.edit(id, (text) => text.replace(input.old_str, input.new_str ?? ''), meta);
    return book.put(id, { ...meta, content: str(input.content) ?? '' });
  }
  // claude.ai's file creation (computer use): a file in the output folder is an artifact too
  if (name === 'create_file' && typeof input.path === 'string')
    return book.put(input.path, {
      title: basename(input.path),
      kind: kindOfPath(input.path),
      language: langOfPath(input.path),
      content: str(input.file_text) ?? '',
    });
  if (
    name === 'str_replace' &&
    typeof input.path === 'string' &&
    typeof input.old_str === 'string'
  ) {
    const edited = book.edit(input.path, (t) => t.replace(input.old_str, input.new_str ?? ''));
    if (edited) return edited;
  }
  const shown = input.query ?? input.code ?? input.command ?? input.url ?? input.path ?? input;
  return { type: 'tool', name, input: short(shown) };
}

// Their results only say the file was written; the artifact itself is the call
const QUIET_RESULTS = new Set(['artifacts', 'create_file', 'str_replace']);

function claudeToolResult(block) {
  if (QUIET_RESULTS.has(block.name)) return null;
  const content = Array.isArray(block.content) ? block.content : [];
  const found = sources(content.filter((b) => b?.type === 'knowledge' || b?.url));
  if (found) return found;
  const output = short(resultText(block.content));
  return output
    ? {
        type: 'tool',
        name: str(block.name) ?? 'result',
        output,
        ...(block.is_error ? { error: true } : {}),
      }
    : null;
}

/**
 * Parts of one Claude message in display order, or null when it is text only.
 * Uploaded files lead (claude.ai shows them above the prompt).
 */
export function claudeParts(message, book) {
  const parts = [];
  for (const f of message.attachments ?? []) {
    if (!str(f?.file_name)) continue;
    parts.push({
      type: 'file',
      name: f.file_name,
      ...(str(f.file_type) && { mime: f.file_type }),
      ...(Number.isFinite(f.file_size) && { size: f.file_size }),
      ...(str(f.extracted_content) && { content: cap(f.extracted_content, MAX_FILE_CHARS) }),
    });
  }
  for (const f of [...(message.files ?? []), ...(message.files_v2 ?? [])]) {
    if (!str(f?.file_name) && !str(f?.file_uuid)) continue;
    if (parts.some((p) => p.uuid && p.uuid === f.file_uuid)) continue;
    const asset = str(f.preview_url) ?? str(f.thumbnail_url);
    const image = f.file_kind === 'image';
    parts.push({
      type: image ? 'image' : 'file',
      name: str(f.file_name) ?? 'file',
      ...(f.file_uuid && { uuid: f.file_uuid }),
      ...(asset && asset.startsWith('/') && { asset }),
    });
  }
  let rich = parts.length > 0;
  const blocks = Array.isArray(message.content) ? message.content : [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      if (block.text.trim()) parts.push({ type: 'text', text: block.text });
      const cited = sources((block.citations ?? []).map((c) => c?.details ?? c));
      if (cited) {
        parts.push(cited);
        rich = true;
      }
    } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push({ type: 'thinking', text: cap(block.thinking, MAX_TOOL_CHARS) });
      rich = true;
    } else if (block?.type === 'tool_use') {
      parts.push(claudeToolUse(block, book));
      rich = true;
    } else if (block?.type === 'tool_result') {
      const part = claudeToolResult(block);
      if (part) {
        // a result belongs to its call: fold it into the call's line when that is the last part
        const last = parts[parts.length - 1];
        if (part.type === 'tool' && last?.type === 'tool' && !last.output)
          Object.assign(last, { output: part.output, ...(part.error && { error: true }) });
        else parts.push(part);
        rich = true;
      }
    }
  }
  // a message from before content blocks: its flat text
  if (!blocks.some((b) => b?.type === 'text') && str(message.text))
    parts.push({ type: 'text', text: message.text });
  for (const p of parts) delete p.uuid;
  return rich ? parts : null;
}

// ---------------------------------------------------------------------------
// ChatGPT
// ---------------------------------------------------------------------------

/** `file-service://file-abc` / `sediment://file_abc` → `file-abc` */
const assetId = (pointer) =>
  typeof pointer === 'string' ? (pointer.match(/^[a-z-]+:\/\/([\w-]+)$/)?.[1] ?? null) : null;

const TOOL_NAMES = {
  python: 'Code',
  web: 'Web search',
  'web.run': 'Web search',
  browser: 'Web search',
  'dalle.text2im': 'Image generation',
  file_search: 'File search',
  myfiles_browser: 'File search',
};
const toolName = (raw) => TOOL_NAMES[raw] ?? raw ?? 'tool';

/** Sources a ChatGPT answer cites (its search results, citations, content references) */
function chatgptSources(metadata = {}) {
  const list = [];
  for (const c of metadata.citations ?? []) list.push(c?.metadata ?? c);
  for (const ref of metadata.content_references ?? []) {
    for (const item of ref?.items ?? []) list.push(item);
    if (ref?.url) list.push(ref);
    for (const s of ref?.sources ?? []) list.push(s);
  }
  for (const group of metadata.search_result_groups ?? [])
    for (const entry of group?.entries ?? []) list.push(entry);
  return sources(list);
}

/** Text, images and attachments of a ChatGPT content's parts */
function contentParts(content, metadata = {}) {
  const parts = [];
  for (const a of metadata.attachments ?? []) {
    if (!str(a?.name)) continue;
    const image = typeof a.mime_type === 'string' && a.mime_type.startsWith('image/');
    // the image itself follows as an asset pointer in the parts
    if (image) continue;
    parts.push({
      type: 'file',
      name: a.name,
      ...(str(a.mime_type) && { mime: a.mime_type }),
      ...(Number.isFinite(a.size) && { size: a.size }),
    });
  }
  const list = Array.isArray(content?.parts) ? content.parts : [];
  for (const p of list) {
    if (typeof p === 'string') {
      if (p.trim()) parts.push({ type: 'text', text: p });
    } else if (p?.content_type === 'image_asset_pointer') {
      const id = assetId(p.asset_pointer);
      const name = (metadata.attachments ?? []).find((a) => a?.id === id)?.name;
      parts.push({ type: 'image', ...(name && { name }), ...(id && { asset: id }) });
    } else if (typeof p?.text === 'string' && p.text.trim()) {
      parts.push({ type: 'text', text: p.text });
    }
  }
  if (!list.length && str(content?.text)) parts.push({ type: 'text', text: content.text });
  return parts;
}

/** Stand-in text of parts without text of their own: `[Canvas: x]`, `[File: y]` */
export const labels = (parts) =>
  parts
    .map((p) =>
      p.type === 'text'
        ? p.text
        : p.type === 'artifact'
          ? `[Artifact: ${p.title}]`
          : p.type === 'file' || p.type === 'image'
            ? `[File: ${p.name ?? 'image'}]`
            : ''
    )
    .filter(Boolean)
    .join('\n')
    .trim();

/**
 * The visible thread of a ChatGPT conversation (`chain`: its messages from the root) as
 * `{ role, text, at, parts? }`. Tool calls, their outputs, canvases and generated images become
 * parts of an assistant message instead of being dropped.
 */
export function chatgptMessages(chain, textOf, ms) {
  const book = artifactBook();
  const out = [];
  /** `text` (search, export, continue): the provider's text as before, else a label per part */
  const push = (role, parts, at, text = labels(parts)) => {
    const rich = parts.some((p) => p.type !== 'text');
    if (!text && !rich) return;
    out.push({ role, text, at, ...(rich && { parts }) });
  };
  for (const m of chain) {
    if (!m || m.metadata?.is_visually_hidden_from_conversation) continue;
    const role = m.author?.role;
    const type = m.content?.content_type ?? 'text';
    const recipient = m.recipient ?? 'all';
    const at = ms(m.create_time);
    if (role === 'user') {
      if (['text', 'multimodal_text'].includes(type))
        push('user', contentParts(m.content, m.metadata), at, textOf(m.content));
      continue;
    }
    if (role === 'assistant' && recipient.startsWith('canmore.')) {
      let input = {};
      try {
        input = JSON.parse(m.content?.text ?? textOf(m.content) ?? '{}');
      } catch {
        // half-written canvas call: nothing to show
      }
      let part = null;
      if (recipient === 'canmore.create_textdoc')
        part = book.put(`canvas-${out.length}`, {
          title: str(input.name) ?? 'Canvas',
          kind: str(input.type)?.startsWith('code') ? 'application/vnd.ant.code' : 'text/markdown',
          language: str(input.type)?.split('/')[1],
          content: str(input.content) ?? '',
        });
      else if (recipient === 'canmore.update_textdoc' && book.last())
        // shortcut: an update edits the latest canvas; ids from the tool's reply are not read
        part = book.edit(book.last(), (text) =>
          (Array.isArray(input.updates) ? input.updates : []).reduce((acc, u) => {
            try {
              return acc.replace(new RegExp(u.pattern, u.multiple ? 'g' : ''), u.replacement ?? '');
            } catch {
              return acc;
            }
          }, text)
        );
      if (part) push('assistant', [part], at);
      continue;
    }
    if (role === 'assistant' && recipient !== 'all') {
      // a tool call: the code it runs or the query it sends
      push(
        'assistant',
        [
          {
            type: 'tool',
            name: toolName(recipient),
            input: short(m.content?.text ?? textOf(m.content)),
          },
        ],
        at
      );
      continue;
    }
    if (role === 'tool') {
      const name = m.author?.name;
      const images = contentParts(m.content).filter((p) => p.type === 'image');
      if (images.length) {
        push('assistant', images, at);
        continue;
      }
      if (type === 'execution_output') {
        const last = out[out.length - 1];
        const call = last?.parts?.[last.parts.length - 1];
        const output = short(m.content?.text);
        if (call?.type === 'tool' && !call.output && output) call.output = output;
        else if (output) push('assistant', [{ type: 'tool', name: toolName(name), output }], at);
      }
      // search results, browsing displays, canvas acknowledgements: shown through the answer
      continue;
    }
    if (role !== 'assistant') continue;
    if (type === 'thoughts') {
      const text = (m.content?.thoughts ?? [])
        .map((t) => t?.content)
        .filter(Boolean)
        .join('\n\n');
      if (text) push('assistant', [{ type: 'thinking', text: cap(text, MAX_TOOL_CHARS) }], at);
      continue;
    }
    if (!['text', 'multimodal_text', 'code'].includes(type)) continue;
    const parts = contentParts(m.content);
    const cited = chatgptSources(m.metadata);
    push('assistant', cited ? [...parts, cited] : parts, at, textOf(m.content));
  }
  return out;
}
