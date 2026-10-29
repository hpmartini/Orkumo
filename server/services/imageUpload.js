/**
 * Images attached in the task / agent / issue composers (#105).
 * Agents get a local file path (like an image pasted into Claude Code); issues get the image
 * committed to the `issue-assets` branch of the repo, because GitHub's API has no image upload.
 */
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import { getDataPath } from './dataPath.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ISSUE_ASSETS_BRANCH = 'issue-assets';

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/**
 * File extension from the magic bytes; null when the buffer is no supported image.
 * The client's Content-Type is not trusted.
 * @param {Buffer} buf
 * @returns {'png'|'jpg'|'gif'|'webp'|null}
 */
export function imageExt(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  return null;
}

function checkedExt(buf) {
  const ext = imageExt(buf);
  if (!ext) throw httpError('Only PNG, JPEG, GIF or WebP images are supported', 415);
  if (buf.length > MAX_IMAGE_BYTES) throw httpError('Image is larger than 10 MB', 413);
  return ext;
}

/**
 * Stores an image for an agent prompt; the name is server-chosen so no client input reaches
 * the path. Files are kept (a session may read them later).
 * @param {Buffer} buf
 * @returns {Promise<string>} absolute path
 */
export async function saveAgentImage(buf, dir = path.join(getDataPath(), 'agent-images')) {
  const ext = checkedExt(buf);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.${ext}`);
  await fsp.writeFile(file, buf);
  return file;
}

/** `gh api` REST call with an optional JSON body on stdin (base64 images exceed argv limits). */
function ghRest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const args = ['api', '-X', method, endpoint];
    if (body) args.push('--input', '-');
    const child = execFile(
      'gh',
      args,
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error?.code === 'ENOENT') {
          return reject(httpError('GitHub CLI (gh) nicht im PATH des DevOrbit-Servers', 502));
        }
        let payload = null;
        try {
          payload = JSON.parse(String(stdout || ''));
        } catch {
          /* handled below */
        }
        if (error) {
          const notFound = /HTTP 404/.test(String(stderr));
          return reject(
            httpError(
              `gh api ${endpoint}: ${payload?.message || String(stderr || error.message).trim()}`,
              notFound ? 404 : 502
            )
          );
        }
        resolve(payload);
      }
    );
    if (body) child.stdin.end(JSON.stringify(body));
  });
}

const branchReady = new Set();

async function ensureAssetsBranch(repo) {
  if (branchReady.has(repo)) return;
  try {
    await ghRest('GET', `repos/${repo}/git/ref/heads/${ISSUE_ASSETS_BRANCH}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    const { default_branch: base } = await ghRest('GET', `repos/${repo}`);
    const ref = await ghRest('GET', `repos/${repo}/git/ref/heads/${base}`);
    await ghRest('POST', `repos/${repo}/git/refs`, {
      ref: `refs/heads/${ISSUE_ASSETS_BRANCH}`,
      sha: ref.object.sha,
    });
  }
  branchReady.add(repo);
}

/**
 * Commits an image to the `issue-assets` branch and returns a URL that renders in issue
 * Markdown (the blob `?raw=true` form also works for private repos).
 * @param {string} repo - "owner/name", validated by the route
 * @param {Buffer} buf
 * @returns {Promise<{url: string}>}
 */
export async function uploadIssueImage(repo, buf) {
  const ext = checkedExt(buf);
  await ensureAssetsBranch(repo);
  const file = `issue-images/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  await ghRest('PUT', `repos/${repo}/contents/${file}`, {
    message: `Issue image ${file}`,
    content: buf.toString('base64'),
    branch: ISSUE_ASSETS_BRANCH,
  });
  return { url: `https://github.com/${repo}/blob/${ISSUE_ASSETS_BRANCH}/${file}?raw=true` };
}
