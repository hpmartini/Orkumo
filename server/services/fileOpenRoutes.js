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
 * code is revealed in Finder (`open -R`) instead of opened; `reveal: true` always reveals.
 * POST /api/files/open-in-editor - the same path in VS Code, in the window of the session's project.
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

const editorSchema = openSchema.extend({
  line: z.number().int().positive().max(10_000_000).optional(),
  col: z.number().int().positive().max(100_000).optional(),
});

/** `reveal: true` shows the file in Finder instead of opening it ("Reveal in Finder") */
const revealSchema = openSchema.extend({ reveal: z.boolean().optional() });

/** Loopback, macOS, valid body; otherwise answers the request and returns null */
function parseRequest(req, res, schema) {
  if (!isLoopbackOrigin(req.headers.origin)) {
    res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    return null;
  }
  if (process.platform !== 'darwin') {
    res.status(501).json({ error: 'Opening files is only supported on macOS' });
    return null;
  }
  const body = schema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: 'path is invalid' });
    return null;
  }
  return body.data;
}

function resolveOrReply(res, input, cwd) {
  try {
    return resolveOpenTarget(input, cwd);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
    return null;
  }
}

function openWithDefaultApp(res, target) {
  // the resolved path is absolute, so it can never be read as an option
  const args = target.reveal ? ['-R', target.path] : [target.path];
  execFile('open', args, (error) => {
    if (error) return res.status(500).json({ error: `open failed: ${error.message}` });
    res.json({ success: true, action: target.reveal ? 'revealed' : 'opened', path: target.path });
  });
}

/**
 * Folder whose VS Code window gets the file: the git root above the session directory (a
 * worktree's own root), else the directory itself. null without a usable directory, or for
 * home / temp itself, which are no project.
 */
export function projectFolder(cwd, roots = defaultRoots()) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')) return null;
  let dir;
  try {
    dir = fs.realpathSync(cwd);
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  if (!roots.some((root) => dir.startsWith(root + path.sep))) return null;
  for (let d = dir; !roots.includes(d) && d !== path.dirname(d); d = path.dirname(d)) {
    // `.git` is a folder in a checkout, a file in a worktree
    if (fs.existsSync(path.join(d, '.git'))) return d;
  }
  return dir;
}

/** VS Code's own CLI: a server started from the Dock has no Homebrew `code` on its PATH */
function vscodeCli() {
  const app = process.env.VSCODE_PATH || '/Applications/Visual Studio Code.app';
  const bundled = path.join(app, 'Contents', 'Resources', 'app', 'bin', 'code');
  return fs.existsSync(bundled) ? bundled : 'code';
}

/** `code` arguments: the project folder focuses (or opens) its window, `-g` jumps to line:col */
export function editorArgs(file, folder, line, col) {
  const goto = line ? ['-g', `${file}:${line}${col ? `:${col}` : ''}`] : [file];
  return folder ? [folder, ...goto] : goto;
}

router.post('/open', openLimiter, (req, res) => {
  const body = parseRequest(req, res, revealSchema);
  if (!body) return;
  const target = resolveOrReply(res, body.path, body.cwd);
  // `reveal` only ever downgrades opening to showing the file in Finder
  if (target) openWithDefaultApp(res, body.reveal ? { ...target, reveal: true } : target);
});

router.post('/open-in-editor', openLimiter, (req, res) => {
  const body = parseRequest(req, res, editorSchema);
  if (!body) return;
  const target = resolveOrReply(res, body.path, body.cwd);
  if (!target) return;
  // A folder would replace the project in its window: folders keep opening in Finder
  if (fs.statSync(target.path).isDirectory()) return openWithDefaultApp(res, target);
  const args = editorArgs(target.path, projectFolder(body.cwd), body.line, body.col);
  // Started from a VS Code terminal, the CLI would hand the file to that window instead
  const env = { ...process.env };
  delete env.VSCODE_IPC_HOOK_CLI;
  execFile(vscodeCli(), args, { env }, (error) => {
    if (error) return res.status(500).json({ error: `VS Code failed: ${error.message}` });
    res.json({ success: true, action: 'editor', path: target.path });
  });
});

export default router;
