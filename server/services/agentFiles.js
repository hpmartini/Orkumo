/**
 * Files attached in the chat and agent composers besides images (#19 AK-3): PDF, text and code.
 * Like images (imageUpload.js) they are stored on this machine and the agent gets their path as
 * a `[File: <path>]` line. Every upload gets a folder of its own under `<data>/agent-files`,
 * named by the server, so the original file name can stay (agents read it) and no client input
 * reaches anything but the last path segment.
 */
import { randomUUID } from 'crypto';
import express from 'express';
import fsp from 'fs/promises';
import path from 'path';
import { TextDecoder } from 'util';
import { ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES } from '../../config/limits.js';
import { getDataPath } from './dataPath.js';

export const agentFilesDir = (dataDir = getDataPath()) => path.join(dataDir, 'agent-files');

const httpError = (message, status) => Object.assign(new Error(message), { status });
const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * File name as stored: the client's last path segment with anything but letters, digits, `.`,
 * `_` and `-` replaced, no leading dot, at most 120 characters (extension kept).
 */
export function safeFileName(name) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.-]/g, '_')
    .replace(/^\.+/, '');
  if (base.length <= 120) return base;
  const ext = path.extname(base).slice(0, 20);
  return base.slice(0, 120 - ext.length) + ext;
}

/**
 * Checks a file for a prompt: an allow-listed extension, at most MAX_ATTACHMENT_BYTES, and
 * content that fits it (a PDF header, else UTF-8 text without NUL bytes). Throws 400/413/415.
 * @returns {string} the extension
 */
export function checkAgentFile(buf, name) {
  const ext = path.extname(String(name ?? '')).slice(1).toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.includes(ext))
    throw httpError('Only PDF, text and code files can be attached', 415);
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw httpError('The file is empty', 400);
  if (buf.length > MAX_ATTACHMENT_BYTES) throw httpError('The file is larger than 20 MB', 413);
  if (ext === 'pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-')
      throw httpError('The file is no PDF', 415);
    return ext;
  }
  let text;
  try {
    text = utf8.decode(buf);
  } catch {
    throw httpError('The file is no UTF-8 text', 415);
  }
  if (text.includes('\0')) throw httpError('The file is no text file', 415);
  return ext;
}

/**
 * Stores a checked file in a fresh folder below `dir`, under its sanitised name, else (nothing
 * left of it, or its extension lost) `file.<ext>`.
 * @returns {Promise<string>} absolute path
 */
export async function saveAgentFile(buf, name, dir = agentFilesDir()) {
  const ext = checkAgentFile(buf, name);
  const root = path.resolve(dir);
  const folder = path.join(root, randomUUID());
  const safe = safeFileName(name);
  const file = path.join(folder, safe.toLowerCase().endsWith(`.${ext}`) ? safe : `file.${ext}`);
  // defense in depth: safeFileName leaves one plain segment, so this never fires
  if (path.dirname(file) !== folder) throw httpError('Invalid file name', 400);
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(file, buf, { flag: 'wx' });
  return file;
}

/**
 * `POST /?name=<file name>` with the raw bytes as `application/octet-stream` → 201 `{ path }`.
 * Mounted at /api/agents/files; the server adds the rate limit. Any other media type is refused
 * before the body is read: `text/plain` & co. are CORS simple requests any website could send.
 */
export function agentFilesRouter(dir = agentFilesDir()) {
  const router = express.Router();
  router.post(
    '/',
    // `is` answers null without a body (refused below as empty), false for another type
    (req, res, next) =>
      req.is('application/octet-stream') === false
        ? res.status(415).json({ error: 'Send the file as application/octet-stream' })
        : next(),
    express.raw({ type: 'application/octet-stream', limit: MAX_ATTACHMENT_BYTES }),
    async (req, res) => {
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      if (!name || name.length > 255) return res.status(400).json({ error: 'Give the file name' });
      try {
        res.status(201).json({ path: await saveAgentFile(req.body, name, dir) });
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
      }
    }
  );
  // express.raw answers an oversized body with its own 413; keep the JSON shape
  router.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large')
      return res.status(413).json({ error: 'The file is larger than 20 MB' });
    next(error);
  });
  return router;
}
