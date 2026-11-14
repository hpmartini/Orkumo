import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  agentFilesRouter,
  checkAgentFile,
  safeFileName,
  saveAgentFile,
} from '../server/services/agentFiles.js';
import { MAX_ATTACHMENT_BYTES } from '../config/limits.js';

let dir;
let server;
let base;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-'));
  const app = express();
  app.use('/api/agents/files', agentFilesRouter(dir));
  await new Promise((resolve) => (server = app.listen(0, '127.0.0.1', resolve)));
  base = `http://127.0.0.1:${server.address().port}/api/agents/files`;
});
afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const upload = (name, body) =>
  fetch(`${base}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });

/** Every stored file lies two levels below the upload dir: <uuid>/<name> */
const insideDir = (file) => {
  const rel = path.relative(dir, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep).length === 2;
};

describe('POST /api/agents/files (#19 AK-3)', () => {
  it('stores a PDF, a text and a code file under the data dir with their names', async () => {
    for (const [name, body] of [
      ['Report Q3.pdf', Buffer.from('%PDF-1.7\n%âãÏÓ\n')],
      ['notes.md', 'Hallo Welt'],
      ['main.ts', 'export const a = 1;\n'],
    ]) {
      const res = await upload(name, body);
      expect(res.status).toBe(201);
      const { path: file } = await res.json();
      expect(insideDir(file)).toBe(true);
      expect(path.basename(file)).toBe(name.replace(' ', '_'));
      expect(fs.readFileSync(file)).toEqual(Buffer.from(body));
    }
  });

  it('refuses types off the allow-list and content that does not fit the extension', async () => {
    const zip = await upload('a.zip', 'PK\x03\x04');
    expect(zip.status).toBe(415);
    const fakePdf = await upload('x.pdf', 'not a pdf');
    expect(fakePdf.status).toBe(415);
    const binary = await upload('x.txt', Buffer.from([0x68, 0x00, 0x69]));
    expect(binary.status).toBe(415);
    const noUtf8 = await upload('x.js', Buffer.from([0xff, 0xfe, 0x41]));
    expect(noUtf8.status).toBe(415);
    const noName = await upload('', 'x');
    expect(noName.status).toBe(400);
    const empty = await upload('a.txt', '');
    expect(empty.status).toBe(400);
  });

  it('refuses a file above 20 MB with 413', async () => {
    const res = await upload('big.txt', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/20 MB/);
  });

  it('a name with path parts never leaves the upload dir', async () => {
    for (const name of ['../../escape.txt', '/etc/passwd.txt', '..\\..\\win.txt', '.hidden.md']) {
      const res = await upload(name, 'x');
      expect(res.status).toBe(201);
      const { path: file } = await res.json();
      expect(insideDir(file)).toBe(true);
      expect(path.basename(file)).not.toMatch(/^\./);
    }
    expect(fs.readdirSync(path.dirname(dir)).includes('escape.txt')).toBe(false);
  });
});

describe('agentFiles helpers', () => {
  it('safeFileName keeps one plain segment of at most 120 characters', () => {
    expect(safeFileName('a/b/c d.txt')).toBe('c_d.txt');
    expect(safeFileName('..')).toBe('');
    expect(safeFileName(`${'x'.repeat(300)}.json`)).toHaveLength(120);
    expect(safeFileName(`${'x'.repeat(300)}.json`).endsWith('.json')).toBe(true);
  });

  it('checkAgentFile names the extension; saveAgentFile falls back to a neutral name', async () => {
    expect(checkAgentFile(Buffer.from('%PDF-1.4'), 'A.PDF')).toBe('pdf');
    expect(() => checkAgentFile(Buffer.from('x'), 'noext')).toThrow(/PDF, text and code/);
    const file = await saveAgentFile(Buffer.from('x'), '...txt', dir);
    expect(path.basename(file)).toBe('file.txt');
  });
});
