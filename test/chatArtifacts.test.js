import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { extractToolArtifacts, patchPaths, sessionArtifacts, createArtifactLog, logArtifactEvent } =
  await import('../server/services/chatArtifacts.js');
const { TRANSCRIPT_READERS } = await import('../server/services/chatTranscripts.js');
const { viewSession, stopAllChats, chatArtifacts, chatArtifactContent, watchChat } =
  await import('../server/services/chatService.js');

const jsonl = (records) => records.map((r) => `${JSON.stringify(r)}\n`).join('');
const lines = (records) => jsonl(records).split('\n');

const cwd = '/w/app';

// ---------------------------------------------------------------------------
// Claude transcript fixture
// ---------------------------------------------------------------------------
const claudeTool = (id, name, input) => ({
  type: 'assistant',
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] },
});
const claudeResult = (id, text, isError = false) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
  },
});

const claudeRecords = [
  { type: 'user', message: { role: 'user', content: 'build it' } },
  claudeTool('t1', 'Write', { file_path: '/w/app/src/new.ts', content: 'x' }),
  claudeResult('t1', 'File created successfully at: /w/app/src/new.ts'),
  claudeTool('t2', 'Edit', { file_path: '/w/app/src/old.ts', old_string: 'a', new_string: 'b' }),
  claudeResult('t2', 'The file /w/app/src/old.ts has been updated.'),
  // a Write over an existing file is an edit
  claudeTool('t3', 'Write', { file_path: '/w/app/README.md', content: 'y' }),
  claudeResult('t3', 'The file /w/app/README.md has been updated successfully.'),
  // failed calls touch nothing
  claudeTool('t4', 'Edit', { file_path: '/w/app/src/broken.ts', old_string: 'q', new_string: 'r' }),
  claudeResult('t4', 'String to replace not found', true),
  claudeTool('t5', 'NotebookEdit', { notebook_path: '/w/app/nb.ipynb', new_source: 'z' }),
  claudeResult('t5', 'Updated cell'),
  // the created file edited later: still created, but now the newest touch
  claudeTool('t6', 'MultiEdit', { file_path: '/w/app/src/new.ts', edits: [] }),
  claudeResult('t6', 'Applied 1 edit to /w/app/src/new.ts'),
  // reads are no artifacts
  claudeTool('t7', 'Read', { file_path: '/w/app/package.json' }),
  claudeResult('t7', '{}'),
];

// ---------------------------------------------------------------------------
// omp session fixture (pi session v3)
// ---------------------------------------------------------------------------
const ompCall = (id, name, args) => ({
  type: 'message',
  id: `a-${id}`,
  message: {
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', id, name, arguments: args }],
  },
});
const ompResult = (id, text, isError = false) => ({
  type: 'message',
  id: `r-${id}`,
  message: {
    role: 'toolResult',
    toolCallId: id,
    content: [{ type: 'text', text }],
    isError,
  },
});

const ompRecords = [
  { type: 'session', version: 3, id: 'x', cwd },
  ompCall('o1', 'write', { path: 'docs/plan.md', content: '# Plan', i: 'Writing plan' }),
  ompResult('o1', 'Successfully wrote 6 bytes to docs/plan.md'),
  ompCall('o2', 'edit', {
    i: 'Editing',
    input: '[server/a.js#1A2B]\nPUT 3.=3:\n+  x\n[types.ts#FFFF]\nPUT >1:\n++ y\n',
  }),
  ompResult('o2', '[server/a.js#3C4D]\n3: x'),
  ompCall('o3', 'write', { path: 'local://report.md', content: '# Report' }),
  ompResult('o3', 'Successfully wrote 8 bytes'),
  ompCall('o4', 'write', { path: 'proc://vite/kill' }),
  ompResult('o4', 'Stopped vite'),
  ompCall('o5', 'edit', { input: '[server/a.js#3C4D]\nMV server/b.js\n' }),
  ompResult('o5', 'moved'),
  ompCall('o6', 'edit', { input: '[gone.ts#AAAA]\nPUT 1.=1:\n+z\n' }),
  ompResult('o6', 'stale anchor', true),
  // the planned doc edited afterwards: still created
  ompCall('o7', 'edit', { path: 'docs/plan.md', edits: [{ oldText: 'a', newText: 'b' }] }),
  ompResult('o7', 'ok'),
];

describe('extractToolArtifacts - Claude transcript', () => {
  const events = TRANSCRIPT_READERS.claude.historyEvents(lines(claudeRecords));

  it('lists created and edited files once each, newest touch first, failed calls skipped', () => {
    expect(extractToolArtifacts(events, cwd)).toEqual([
      { path: '/w/app/src/new.ts', action: 'created' },
      { path: '/w/app/nb.ipynb', action: 'edited' },
      { path: '/w/app/README.md', action: 'edited' },
      { path: '/w/app/src/old.ts', action: 'edited' },
    ]);
  });

  it('counts a call whose result has not arrived yet', () => {
    const pending = TRANSCRIPT_READERS.claude.historyEvents(
      lines([claudeTool('p1', 'Write', { file_path: 'notes/todo.md', content: '' })])
    );
    expect(extractToolArtifacts(pending, cwd)).toEqual([
      { path: '/w/app/notes/todo.md', action: 'created' },
    ]);
  });
});

describe('extractToolArtifacts - omp session', () => {
  const docs = '/sessions/s1/local';
  const events = TRANSCRIPT_READERS.omp.historyEvents(lines(ompRecords));

  it('reads write paths, hashline headers and MV targets; local:// lands in the document folder', () => {
    expect(extractToolArtifacts(events, cwd, docs)).toEqual([
      { path: '/w/app/docs/plan.md', action: 'created' },
      { path: '/w/app/server/b.js', action: 'edited' },
      { path: '/w/app/server/a.js', action: 'edited' },
      { path: '/sessions/s1/local/report.md', action: 'created' },
      { path: '/w/app/types.ts', action: 'edited' },
    ]);
  });

  it('drops local:// without a document folder and every other URI scheme', () => {
    const paths = extractToolArtifacts(events, cwd).map((a) => a.path);
    expect(paths.some((p) => p.includes('report.md') || p.includes('vite'))).toBe(false);
  });

  it('a local:// path cannot climb out of the document folder', () => {
    const escape = TRANSCRIPT_READERS.omp.historyEvents(
      lines([ompCall('e1', 'write', { path: 'local://../../etc/x', content: '' })])
    );
    expect(extractToolArtifacts(escape, cwd, docs)).toEqual([]);
  });

  it('patchPaths reads apply_patch headers too', () => {
    expect(
      patchPaths(
        '*** Begin Patch\n*** Add File: a.md\n+x\n*** Update File: b.ts\n*** Move to: c.ts\n'
      )
    ).toEqual([
      { path: 'a.md', create: true },
      { path: 'b.ts', create: false },
      { path: 'c.ts', create: false },
    ]);
  });
});

describe('sessionArtifacts', () => {
  it('lists session documents first, then files, with size, mtime and existence', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-')));
    const docs = path.join(root, 'session', 'local');
    fs.mkdirSync(path.join(docs, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(docs, 'report.md'), '# Report');
    fs.writeFileSync(path.join(docs, 'sub', 'notes.md'), 'n');
    fs.writeFileSync(path.join(root, 'made.ts'), 'abc');
    const log = createArtifactLog();
    for (const event of TRANSCRIPT_READERS.omp.historyEvents(
      lines([
        ompCall('w1', 'write', { path: 'made.ts', content: 'abc' }),
        ompCall('w2', 'write', { path: 'gone.ts', content: '' }),
        ompCall('w3', 'write', { path: 'local://report.md', content: '' }),
      ])
    ))
      logArtifactEvent(log, event);

    const list = sessionArtifacts(log, root, docs);
    expect(list.map((a) => [a.name, a.kind, a.action, a.exists])).toEqual([
      expect.anything(),
      expect.anything(),
      ['gone.ts', 'file', 'created', false],
      ['made.ts', 'file', 'created', true],
    ]);
    expect(list.slice(0, 2).map((a) => a.kind)).toEqual(['document', 'document']);
    expect(
      list
        .slice(0, 2)
        .map((a) => a.name)
        .sort()
    ).toEqual(['notes.md', 'report.md']);
    expect(list.find((a) => a.name === 'made.ts')).toMatchObject({ size: 3, exists: true });
    expect(list.find((a) => a.name === 'gone.ts')).toMatchObject({ size: null, mtime: null });
  });
});

// ---------------------------------------------------------------------------
// Through the chat view: the routes call chatArtifacts / chatArtifactContent
// ---------------------------------------------------------------------------
describe('chat view artifacts and content', () => {
  const OMP_ID = '01a1c9b5-7087-7460-91a2-36fa4563f9ca';
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-view-')));
  const project = path.join(root, 'project');
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-out-')));
  const sessions = path.join(root, 'sessions');
  const base = path.join(sessions, '-w-app', `2026-11-11T08-24-33-671Z_${OMP_ID}`);
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(base, 'local'), { recursive: true });
  fs.writeFileSync(path.join(project, 'small.md'), '# Hi');
  fs.writeFileSync(path.join(project, 'big.txt'), Buffer.alloc(1024 * 1024 + 1, 'a'));
  fs.writeFileSync(path.join(project, 'blob.bin'), Buffer.from([0x89, 0x50, 0, 1]));
  fs.writeFileSync(path.join(project, 'unlisted.ts'), 'secret');
  fs.writeFileSync(path.join(outside, 'elsewhere.md'), 'outside');
  fs.writeFileSync(path.join(base, 'local', 'plan.md'), '# Plan');
  // a listed file that is a symlink out of the project
  fs.symlinkSync(path.join(outside, 'elsewhere.md'), path.join(project, 'link.md'));
  fs.writeFileSync(
    `${base}.jsonl`,
    jsonl([
      { type: 'session', version: 3, id: OMP_ID, cwd: project },
      ompCall('c1', 'write', { path: 'small.md', content: '# Hi' }),
      ompCall('c2', 'write', { path: 'big.txt', content: '' }),
      ompCall('c3', 'write', { path: 'blob.bin', content: '' }),
      ompCall('c4', 'write', { path: path.join(outside, 'elsewhere.md'), content: '' }),
      ompCall('c5', 'write', { path: 'link.md', content: '' }),
    ])
  );

  afterEach(() => stopAllChats());

  const open = async () => {
    const view = viewSession(
      { harness: 'omp', sessionId: OMP_ID, cwd: project },
      {
        allowedDirs: [project],
        transcriptDir: sessions,
        pollMs: 20,
        listCommands: async () => [],
        listAgents: async () => [],
      }
    );
    const off = watchChat(view.id, () => {});
    await vi.waitFor(() => expect(chatArtifacts(view.id).length).toBe(6));
    off();
    return view.id;
  };

  const status = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.status;
    }
    return 'no error';
  };

  it('lists the session document and the written files', async () => {
    const id = await open();
    const list = chatArtifacts(id);
    expect(list[0]).toMatchObject({ name: 'plan.md', kind: 'document', exists: true });
    expect(list.slice(1).map((a) => a.name)).toEqual([
      'link.md',
      'elsewhere.md',
      'blob.bin',
      'big.txt',
      'small.md',
    ]);
  });

  it('returns the text of listed files and documents', async () => {
    const id = await open();
    expect(chatArtifactContent(id, path.join(project, 'small.md'))).toMatchObject({
      content: '# Hi',
      size: 4,
    });
    expect(chatArtifactContent(id, path.join(base, 'local', 'plan.md')).content).toBe('# Plan');
  });

  it('refuses unlisted paths, oversize and binary files, and files outside the project', async () => {
    const id = await open();
    expect(status(() => chatArtifactContent(id, path.join(project, 'unlisted.ts')))).toBe(404);
    expect(status(() => chatArtifactContent(id, '/etc/passwd'))).toBe(404);
    expect(status(() => chatArtifactContent(id, `${project}/../project/small.md`))).toBe(404);
    expect(status(() => chatArtifactContent(id, path.join(project, 'big.txt')))).toBe(413);
    expect(status(() => chatArtifactContent(id, path.join(project, 'blob.bin')))).toBe(415);
    expect(status(() => chatArtifactContent(id, path.join(outside, 'elsewhere.md')))).toBe(403);
    expect(status(() => chatArtifactContent(id, path.join(project, 'link.md')))).toBe(403);
  });
});
