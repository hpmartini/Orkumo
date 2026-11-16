import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { canonicalDir } from './configService.js';

const httpError = (message, status) => Object.assign(new Error(message), { status });

/** owner/name as GitHub allows it; also keeps `..` and option-like names out of the clone path */
const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const isRepoSlug = (slug) =>
  typeof slug === 'string' && SLUG_RE.test(slug) && !/\/\.{1,2}$/.test(slug);

const gh = (args, timeout) =>
  new Promise((resolve, reject) =>
    execFile('gh', args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT')
        return reject(httpError('GitHub CLI (gh) not found on the server PATH', 502));
      if (error)
        return reject(httpError(String(stderr || error.message).trim() || 'gh failed', 502));
      resolve(String(stdout));
    })
  );

const FIELDS =
  '.[] | {slug: .full_name, private: .private, fork: .fork, archived: .archived, pushedAt: .pushed_at, description: .description}';

/** Repos the gh user owns, collaborates on or reaches through an org, most recently pushed first */
export async function listGithubRepos() {
  const out = await gh(
    [
      'api',
      '--paginate',
      '-X',
      'GET',
      'user/repos',
      '-f',
      'per_page=100',
      '-f',
      'sort=pushed',
      '-f',
      'affiliation=owner,collaborator,organization_member',
      '--jq',
      FIELDS,
    ],
    60_000
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Clone target for `slug` inside `dir`, which must be one of the scan `directories`: the clone then
 * shows up as a project on the next scan. Throws 400/409 with a message for the UI.
 */
export function cloneTarget(slug, dir, directories) {
  if (!isRepoSlug(slug)) throw httpError('Not a GitHub repository (owner/name)', 400);
  const want = canonicalDir(String(dir || ''));
  const root = directories.map(canonicalDir).find((d) => d === want);
  if (!root) throw httpError('Clone only into one of the project directories', 400);
  const target = path.join(root, slug.split('/')[1]);
  if (fs.existsSync(target)) throw httpError(`${target} already exists`, 409);
  return target;
}

/**
 * `gh repo clone` into `target` (sets origin and, for forks, upstream). `target` did not exist
 * (cloneTarget), so a failed or timed-out clone removes its partial folder and a retry works.
 */
export async function cloneRepo(slug, target) {
  try {
    await gh(['repo', 'clone', slug, target], 15 * 60_000);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}
