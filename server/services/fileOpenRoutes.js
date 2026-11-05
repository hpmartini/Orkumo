import express from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { isLoopbackOrigin } from './remoteAccess.js';

/**
 * POST /api/files/open - open a file path clicked in the terminal (#188) with its default macOS app.
 * Runs on the host, so: only existing paths under home or temp, and anything that could launch
 * code is revealed in Finder (`open -R`) instead of opened.
 */
const router = express.Router();

const openLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many file opens, please slow down' },
});

// Allowlist: only plain documents open in their default app; everything else (unknown types,
// scripts, bundles, macro-enabled Office files, .py via Python Launcher, .html/.svg in the browser)
// is revealed in Finder, so a Cmd-click never launches code.
const DOCUMENT_EXT = new Set(
  (
    'pdf png jpg jpeg gif webp heic heif tiff tif bmp ico ' +
    'txt md markdown log csv tsv json jsonl yaml yml toml ini xml ' +
    'ts tsx js jsx mjs cjs css scss go rs java kt swift c h cpp hpp ' +
    'doc docx xls xlsx ppt pptx pages numbers key rtf odt ods odp ' +
    'mp3 m4a wav aac flac mp4 m4v mov'
  )
    .split(' ')
    .map((ext) => `.${ext}`)
);
// Finder aliases (bookmark data) are not symlinks: realpath keeps them, `open` follows them
const ALIAS_MAGIC = Buffer.from('book\0\0\0\0mark', 'latin1');

// classic aliases keep their target in the resource fork ('alis'); a plain document has none
const hasResourceFork = (file) => {
  try {
    return fs.statSync(path.join(file, '..namedfork', 'rsrc')).size > 0;
  } catch {
    return false;
  }
};

const isAliasFile = (file) => {
  const head = Buffer.alloc(ALIAS_MAGIC.length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return head.equals(ALIAS_MAGIC);
};

const realRoot = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return null;
  }
};

export const defaultRoots = () => [os.homedir(), os.tmpdir(), '/tmp'].map(realRoot).filter(Boolean);

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Resolve a clicked path to the real file and decide open vs. reveal.
 * @returns {{ path: string, reveal: boolean }}
 */
export function resolveOpenTarget(input, cwd, roots = defaultRoots()) {
  if (typeof input !== 'string' || !input || input.length > 4096 || input.includes('\0')) {
    throw httpError(400, 'path is invalid');
  }
  let target = input;
  if (target === '~' || target.startsWith('~/')) target = path.join(os.homedir(), target.slice(1));
  if (!path.isAbsolute(target)) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')) {
      throw httpError(400, 'Relative path needs the session directory');
    }
    target = path.resolve(cwd, target);
  }
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    throw httpError(404, `Datei nicht gefunden: ${input}`);
  }
  if (!roots.some((root) => real === root || real.startsWith(root + path.sep))) {
    throw httpError(403, 'Only files under the home or temp directory can be opened');
  }
  const stat = fs.statSync(real);
  const ext = path.extname(real).toLowerCase();
  // symlinks are resolved, so a link named report.pdf pointing at an .app is judged by the .app;
  // folders with an extension are bundles (.app, .xpc, .workflow ...)
  const safe = stat.isDirectory()
    ? !ext
    : stat.isFile() &&
      DOCUMENT_EXT.has(ext) &&
      (stat.mode & 0o111) === 0 &&
      !hasResourceFork(real) &&
      !isAliasFile(real);
  return { path: real, reveal: !safe };
}

const openSchema = z.object({
  path: z.string().min(1).max(4096),
  cwd: z.string().max(4096).optional(),
});

router.post('/open', openLimiter, (req, res) => {
  if (!isLoopbackOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  }
  if (process.platform !== 'darwin') {
    return res.status(501).json({ error: 'Opening files is only supported on macOS' });
  }
  const body = openSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'path is invalid' });
  const { path: input, cwd } = body.data;
  let target;
  try {
    target = resolveOpenTarget(input, cwd);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
  // the resolved path is absolute, so it can never be read as an option
  const args = target.reveal ? ['-R', target.path] : [target.path];
  execFile('open', args, (error) => {
    if (error) return res.status(500).json({ error: `open failed: ${error.message}` });
    res.json({ success: true, action: target.reveal ? 'revealed' : 'opened', path: target.path });
  });
});

export default router;
