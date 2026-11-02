/**
 * Martini Workflows (mw 7): card details for the workflow view. mw 7 writes no local run state, so
 * this only reads docs from the checkout and screenshots from GitHub comments; the stage rule
 * itself lives in utils/workflowStage.js.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const MAX_IMAGES = 12;
// Documents a board session leaves in a checkout besides the briefing named by the `briefed` marker
const DOC_RE = /^(BRIEFING|PLAN|PRD|SPEC)[\w.-]*\.md$/i;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

// Screenshots only from GitHub's own attachment hosts: the view loads them without a click
const IMAGE_HOST_RE =
  /^https:\/\/(github\.com\/user-attachments\/|user-images\.githubusercontent\.com\/|private-user-images\.githubusercontent\.com\/)/;

/** GitHub-hosted image URLs in markdown/HTML comment bodies (review screenshots), deduplicated */
export function extractImages(bodies) {
  const urls = [];
  const re = /!\[[^\]]*\]\((https:\/\/[^)\s]+)\)|<img[^>]+src="(https:\/\/[^"]+)"/g;
  for (const body of bodies) {
    for (const m of String(body || '').matchAll(re)) {
      const url = m[1] || m[2];
      if (IMAGE_HOST_RE.test(url) && !urls.includes(url)) urls.push(url);
    }
  }
  return urls.slice(-MAX_IMAGES);
}

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(httpError(`gh failed: ${error.message}`, 502));
      try {
        resolve(JSON.parse(String(stdout || '[]')));
      } catch {
        reject(httpError('gh returned non-JSON', 502));
      }
    });
  });
}

/** Comment bodies of an issue or PR (`--paginate` concatenates pages into one array with --slurp) */
async function commentBodies(repo, number) {
  const pages = await gh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/issues/${number}/comments`,
  ]);
  return pages.flat().map((c) => c?.body ?? '');
}

/**
 * Docs of a workflow: the briefing of the `briefed` marker and BRIEFING/PLAN/PRD/SPEC files in the
 * checkout/worktree.
 */
export async function findDocs(dirs, briefingPath) {
  const docs = [];
  const add = async (dir, rel) => {
    // Only markdown files inside the checkout (symlinks resolved): a marker path must not leave it
    if (!rel.endsWith('.md')) return;
    const [root, full] = await Promise.all([
      fs.realpath(dir).catch(() => null),
      fs.realpath(path.resolve(dir, rel)).catch(() => null),
    ]);
    if (!root || !full || !full.startsWith(root + path.sep)) return;
    if (docs.some((d) => d.path === full)) return;
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isFile()) docs.push({ name: rel, path: full });
  };
  for (const dir of dirs.filter(Boolean)) {
    if (briefingPath) await add(dir, briefingPath);
    for (const n of await fs.readdir(dir).catch(() => [])) if (DOC_RE.test(n)) await add(dir, n);
  }
  return docs;
}

/**
 * Lazy details of one workflow card: docs and review screenshots (issue + PR comments).
 * @param {{ repo: string, number: number, pullRequests: { repo: string, number: number }[] }} item
 * @param {{ dirs: string[], briefingPath: string|null }} where
 */
export async function getDetails(item, { dirs, briefingPath }) {
  const [docs, bodies] = await Promise.all([
    findDocs(dirs, briefingPath),
    Promise.all([
      commentBodies(item.repo, item.number),
      ...item.pullRequests.map((pr) => commentBodies(pr.repo, pr.number)),
    ]).then((lists) => lists.flat()),
  ]);
  return { docs, screenshots: extractImages(bodies) };
}

/** Content of a doc that getDetails listed for this item (the caller passes that list) */
export async function readDoc(docs, requested) {
  const doc = docs.find((d) => d.path === requested);
  if (!doc) throw httpError('Not a document of this workflow', 403);
  const text = await fs.readFile(doc.path, 'utf8');
  return { name: doc.name, path: doc.path, content: text.slice(0, 200_000) };
}
