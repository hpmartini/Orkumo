import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  assetUrl,
  canSwapBundle,
  channelOf,
  compareVersions,
  downloadVerified,
  isUpdateFor,
  parseMacYml,
  parseReleaseTags,
  parseVersion,
  pickMacZip,
  pickRelease,
  shQuote,
  swapScript,
} from '../electron/selfUpdate.js';
import { devVersion, latestRcOf } from '../scripts/release/build-local.mjs';

const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-self-update-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('version order and channels', () => {
  it('dev < rc.N < rc.N+1 < final < next rc', () => {
    const ordered = [
      '1.0.0-dev.abc1234',
      '1.0.0-rc.1',
      '1.0.0-rc.2',
      '1.0.0-rc.10',
      '1.0.0',
      '1.0.1-rc.1',
      '1.1.0',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1]), ordered[i]).toBe(-1);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1);
    }
    expect(compareVersions('v1.0.0-rc.2', '1.0.0-rc.2')).toBe(0);
  });

  it('rejects non-versions', () => {
    expect(parseVersion('1.0')).toBeNull();
    expect(parseVersion('1.0.0-')).toBeNull();
    expect(parseVersion('1.0.0-rc..1')).toBeNull();
    expect(() => compareVersions('x', '1.0.0')).toThrow(/Not a version/);
  });

  it.each([
    ['1.0.0', 'stable'],
    ['1.0.0-rc.3', 'rc'],
    ['1.0.0-dev.abc1234', 'dev'],
    ['garbage', 'unknown'],
  ])('channelOf(%s) = %s', (v, channel) => {
    expect(channelOf(v)).toBe(channel);
  });

  it.each([
    // [current, candidate, offered]
    ['1.0.0-rc.1', '1.0.0-rc.2', true], // rc sees newer rcs
    ['1.0.0-rc.2', '1.0.0', true], // rc install sees the final
    ['1.0.0-rc.2', '1.1.0-rc.1', true],
    ['1.0.0-rc.2', '1.0.0-rc.2', false],
    ['1.0.0-rc.2', '1.0.0-rc.1', false],
    ['1.0.0', '1.0.1-rc.1', false], // finals only see finals
    ['1.0.0', '1.0.1', true],
    ['1.0.0-dev.abc1234', '1.0.0-rc.1', true], // a local build is offered the GitHub rc
    ['1.0.0-dev.abc1234', '1.0.0', true],
    ['1.0.0-dev.abc1234', '0.9.0', false],
    ['1.0.0-rc.8', '1.0.0-rc7', false], // old tag form would outrank every -rc.N
    ['1.0.0-rc.1', '1.0.0-beta.1', false],
    ['1.0.0-rc.1', 'not-a-version', false],
  ])('%s offered %s: %s', (current, candidate, offered) => {
    expect(isUpdateFor(current, candidate)).toBe(offered);
  });
});

describe('local build version stamp', () => {
  it('stamps <version>-rc.<latest>.dev.<sha>: above the latest rc, below the next one', () => {
    const local = devVersion('1.0.0', 'abc1234', 14);
    expect(local).toBe('1.0.0-rc.14.dev.abc1234');
    expect(devVersion('1.2.0-rc.3', 'abc1234', 3)).toBe('1.2.0-rc.3.dev.abc1234');
    // the regression: a local build was offered (and swapped to) the older published rc.8
    expect(isUpdateFor(local, '1.0.0-rc.8')).toBe(false);
    expect(isUpdateFor(local, '1.0.0-rc.14')).toBe(false);
    expect(isUpdateFor(local, '1.0.0-rc.15')).toBe(true);
    expect(isUpdateFor(local, '1.0.0')).toBe(true);
  });
  it('finds the latest rc among tags and release names', () => {
    expect(
      latestRcOf('1.0.0', ['v1.0.0-rc.8', 'v1.0.0-rc.14', 'v1.0.0-rc7', 'v0.9.0-rc.30', ''])
    ).toBe(14);
    expect(latestRcOf('1.0.0', [])).toBe(0);
  });
  it('keeps the version valid for an all-digit sha and without git', () => {
    expect(devVersion('1.0.0', '0123456', 2)).toBe('1.0.0-rc.2.dev.g0123456');
    expect(parseVersion(devVersion('1.0.0', '0123456'))).not.toBeNull();
    expect(devVersion('1.0.0', '')).toBe('1.0.0-rc.0.dev.local');
    expect(compareVersions(devVersion('1.0.0', ''), '1.0.0-rc.1')).toBe(-1);
  });
});

describe('release feed', () => {
  const atom = `<?xml version="1.0"?><feed>
    <entry><link rel="alternate" type="text/html" href="https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.10"/></entry>
    <entry><link rel="alternate" type="text/html" href="https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.9"/></entry>
    <entry><link rel="alternate" type="text/html" href="https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc7"/></entry>
    <entry><link rel="alternate" type="text/html" href="https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.9"/></entry>
  </feed>`;

  it('extracts tags in feed order, once each', () => {
    expect(parseReleaseTags(atom)).toEqual(['v1.0.0-rc.10', 'v1.0.0-rc.9', 'v1.0.0-rc7']);
  });

  it('picks the highest fitting version, not the first entry', () => {
    expect(pickRelease(['v1.0.0-rc.9', 'v1.0.0-rc.10', 'v1.0.0-rc7'], '1.0.0-rc.8')).toEqual({
      tag: 'v1.0.0-rc.10',
      version: '1.0.0-rc.10',
    });
    expect(pickRelease(['v1.0.0-rc.9', 'v1.0.0'], '1.0.0-rc.8')?.version).toBe('1.0.0');
    expect(pickRelease(['v1.0.0-rc.9'], '1.0.0')).toBeNull();
  });

  it('asset URLs keep the tag and name inside the release download path', () => {
    expect(assetUrl('https://h/o/r/releases', 'v1.0.0-rc.9', 'latest-mac.yml')).toBe(
      'https://h/o/r/releases/download/v1.0.0-rc.9/latest-mac.yml'
    );
    expect(assetUrl('https://h/o/r/releases', '../x', 'a b.zip')).toBe(
      'https://h/o/r/releases/download/..%2Fx/a%20b.zip'
    );
  });
});

describe('*-mac.yml', () => {
  const sha = (s) => crypto.createHash('sha512').update(s).digest('base64');
  const yml = `version: 1.0.0-rc.9
files:
  - url: Orkumo-1.0.0-rc.9-mac.zip
    sha512: ${sha('x64')}
    size: 3
  - url: Orkumo-1.0.0-rc.9-arm64-mac.zip
    sha512: ${sha('arm')}
    size: 3
  - url: Orkumo-1.0.0-rc.9-arm64.dmg
    sha512: ${sha('dmg')}
    size: 3
path: Orkumo-1.0.0-rc.9-mac.zip
sha512: ${sha('x64')}
releaseDate: '2026-11-12T21:26:13.000Z'
`;

  it('parses version and files', () => {
    const meta = parseMacYml(yml);
    expect(meta.version).toBe('1.0.0-rc.9');
    expect(meta.files).toHaveLength(3);
    expect(meta.files[1]).toEqual({
      url: 'Orkumo-1.0.0-rc.9-arm64-mac.zip',
      sha512: sha('arm'),
      size: 3,
    });
  });

  it('picks the zip of the machine arch', () => {
    const { files } = parseMacYml(yml);
    expect(pickMacZip(files, 'arm64')?.url).toBe('Orkumo-1.0.0-rc.9-arm64-mac.zip');
    expect(pickMacZip(files, 'x64')?.url).toBe('Orkumo-1.0.0-rc.9-mac.zip');
    expect(pickMacZip(files.slice(1), 'x64')).toBeNull();
  });

  it.each([
    ['no version', 'files: []'],
    ['no files', 'version: 1.0.0'],
    ['path traversal', `version: 1.0.0\nfiles:\n  - url: ../../evil.zip\n    sha512: ${sha('a')}`],
    [
      'absolute url',
      `version: 1.0.0\nfiles:\n  - url: https://evil/x.zip\n    sha512: ${sha('a')}`,
    ],
    ['bad sha512', 'version: 1.0.0\nfiles:\n  - url: a.zip\n    sha512: abc'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseMacYml(text)).toThrow();
  });
});

describe('downloadVerified', () => {
  const body = Buffer.from('orkumo update payload '.repeat(2000));
  const digest = crypto.createHash('sha512').update(body).digest('base64');
  const fetch = (data = body) =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new globalThis.Headers({ 'content-length': String(data.length) }),
      // chunked like a network stream
      body: (async function* () {
        for (let i = 0; i < data.length; i += 4096) yield data.subarray(i, i + 4096);
      })(),
    }));

  it('writes the file when sha512 and size match, with progress', async () => {
    const dest = path.join(tmp(), 'u.zip');
    const progress = vi.fn();
    await downloadVerified({
      url: 'http://x/u.zip',
      dest,
      sha512: digest,
      size: body.length,
      fetch: fetch(),
      onProgress: progress,
    });
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(body.length, body.length);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('refuses a wrong hash and leaves nothing behind', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'u.zip');
    const tampered = Buffer.from(body);
    tampered[100] ^= 1;
    await expect(
      downloadVerified({
        url: 'u',
        dest,
        sha512: digest,
        size: body.length,
        fetch: fetch(tampered),
      })
    ).rejects.toThrow(/sha512/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('refuses a wrong size', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'u.zip');
    await expect(
      downloadVerified({ url: 'u', dest, sha512: digest, size: body.length + 1, fetch: fetch() })
    ).rejects.toThrow(/incomplete/);
    await expect(
      downloadVerified({ url: 'u', dest, sha512: digest, size: 10, fetch: fetch() })
    ).rejects.toThrow(/larger/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reports HTTP errors', async () => {
    const dest = path.join(tmp(), 'u.zip');
    const notFound = vi.fn(async () => ({ ok: false, status: 404, body: null }));
    await expect(
      downloadVerified({ url: 'http://x/u.zip', dest, sha512: digest, fetch: notFound })
    ).rejects.toThrow('Download failed: HTTP 404 for http://x/u.zip');
  });
});

describe('swapScript', () => {
  const bundle = "/Applications/Ork umo's $HOME `x`.app";
  const staged =
    '/Users/me/Library/Application Support/devorbit-dashboard/updates/staging/Orkumo.app';

  it('quotes every path so the shell never expands it', () => {
    const script = swapScript({ pid: 4242, bundle, staged });
    expect(script).toContain(`bundle=${shQuote(bundle)}`);
    expect(shQuote(bundle)).toBe(`'/Applications/Ork umo'\\''s $HOME \`x\`.app'`);
    expect(script).toContain(`staged='${staged}'`);
    expect(script).toContain('pid=4242');
    // paths only ever appear through the quoted variables
    expect(script.split('\n').filter((l) => l.includes('Ork umo'))).toHaveLength(3);
  });

  it('swaps by rename with a backup, rolls back on failure, relaunches with open', () => {
    const script = swapScript({ pid: 1, bundle: '/A/Orkumo.app', staged: '/S/Orkumo.app' });
    expect(script).toContain('while kill -0 "$pid"');
    expect(script).toContain('mv "$bundle" "$backup"');
    expect(script).toContain('mv "$incoming" "$bundle"');
    expect(script).toContain('mv "$backup" "$bundle"');
    expect(script).toContain('xattr -dr com.apple.quarantine "$bundle"');
    expect(script).toContain('open "$bundle"');
    expect(script).toContain('rm -rf "$backup"');
    expect(script).not.toMatch(/ditto|cp -/);
    expect(script).toContain("backup='/A/.Orkumo.app.update-backup'");
    expect(
      swapScript({ pid: 1, bundle: '/A/O.app', staged: '/S/O.app', relaunch: false })
    ).toContain('relaunch=0');
  });

  it('is valid sh', () => {
    const { status, stderr } = spawnSync('/bin/sh', ['-n'], {
      input: swapScript({ pid: 1, bundle, staged }),
      encoding: 'utf8',
    });
    expect(stderr).toBe('');
    expect(status).toBe(0);
  });

  it.each([
    [{ pid: 0, bundle: '/A/O.app', staged: '/S/O.app' }],
    [{ pid: 1.5, bundle: '/A/O.app', staged: '/S/O.app' }],
    [{ pid: 1, bundle: 'O.app', staged: '/S/O.app' }],
    [{ pid: 1, bundle: '/A/O.app', staged: '/S/O' }],
    [{ pid: 1, bundle: '', staged: '/S/O.app' }],
  ])('refuses %j', (options) => {
    expect(() => swapScript(options)).toThrow();
  });

  function fakeApp(dir, name, version) {
    const app = path.join(dir, name);
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'version'), version);
    return app;
  }
  const exitedPid = () => spawnSync('/usr/bin/true').pid;

  it('runs: swaps, removes the backup, keeps nothing else (no relaunch)', () => {
    const dir = tmp();
    const apps = path.join(dir, 'Applications dir');
    fs.mkdirSync(apps);
    const bundle = fakeApp(apps, 'Orkumo.app', 'old');
    const staged = fakeApp(path.join(dir, 'staging'), 'Orkumo.app', 'new');
    const script = swapScript({ pid: exitedPid(), bundle, staged, relaunch: false });
    const { status, stdout } = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8' });
    expect(status, stdout).toBe(0);
    expect(fs.readFileSync(path.join(bundle, 'Contents', 'version'), 'utf8')).toBe('new');
    expect(fs.readdirSync(apps)).toEqual(['Orkumo.app']);
    expect(fs.existsSync(staged)).toBe(false);
  });

  it('runs: a failed move puts the old bundle back', () => {
    const dir = tmp();
    const bundle = fakeApp(dir, 'Orkumo.app', 'old');
    const staged = path.join(dir, 'missing', 'Orkumo.app'); // nothing staged: first mv fails
    const script = swapScript({ pid: exitedPid(), bundle, staged, relaunch: false });
    const { status, stdout } = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8' });
    expect(status).toBe(1);
    expect(stdout).toContain('cannot move the update');
    expect(fs.readFileSync(path.join(bundle, 'Contents', 'version'), 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['Orkumo.app']);
  });
});

describe('canSwapBundle', () => {
  it('needs a .app in a writable folder outside App Translocation', () => {
    const ok = () => {};
    const denied = () => {
      throw new Error('EACCES');
    };
    expect(canSwapBundle('/Applications/Orkumo.app', ok)).toBe(true);
    expect(canSwapBundle('/Applications/Orkumo.app', denied)).toBe(false);
    expect(canSwapBundle('/private/var/folders/x/AppTranslocation/ABC/d/Orkumo.app', ok)).toBe(
      false
    );
    expect(canSwapBundle('/usr/lib/orkumo', ok)).toBe(false);
  });
});
