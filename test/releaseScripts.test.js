import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { mergeMacYml } from '../scripts/release/merge-mac-yml.mjs';

const repo = path.resolve(__dirname, '..');
const fixtures = path.join(repo, 'test/fixtures/126');

describe('release-assets.sh (AC-2)', () => {
  // file names as electron-builder 26 writes them for v1.0.0-rc.8
  const names = [
    'Orkumo-1.0.0-rc.8-arm64.dmg',
    'Orkumo-1.0.0-rc.8-arm64.dmg.blockmap',
    'Orkumo-1.0.0-rc.8-arm64-mac.zip',
    'Orkumo-1.0.0-rc.8-arm64-mac.zip.blockmap',
    'Orkumo-1.0.0-rc.8.AppImage',
    'devorbit-dashboard_1.0.0-rc.8_amd64.deb',
    'devorbit-dashboard-1.0.0-rc.8.x86_64.rpm',
    'latest-mac.yml',
    'latest-linux.yml',
    'builder-debug.yml',
    'builder-effective-config.yaml',
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  for (const n of names) fs.writeFileSync(path.join(dir, n), '');
  fs.mkdirSync(path.join(dir, 'mac-arm64'));
  fs.writeFileSync(path.join(dir, 'mac-arm64', 'latest-mac.yml'), '');
  const list = (...args) =>
    execFileSync('bash', [path.join(repo, 'scripts/release/release-assets.sh'), dir, ...args], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .map((f) => path.basename(f));

  it('uploads installers, *.yml and *.blockmap, never builder-debug.yml', () => {
    const files = list();
    expect(files).toEqual(
      expect.arrayContaining([
        'Orkumo-1.0.0-rc.8-arm64-mac.zip.blockmap',
        'Orkumo-1.0.0-rc.8-arm64.dmg.blockmap',
        'latest-mac.yml',
        'latest-linux.yml',
        'Orkumo-1.0.0-rc.8.AppImage',
        'devorbit-dashboard_1.0.0-rc.8_amd64.deb',
        'devorbit-dashboard-1.0.0-rc.8.x86_64.rpm',
      ])
    );
    expect(files).not.toContain('builder-debug.yml');
    expect(files).not.toContain('builder-effective-config.yaml');
    expect(files).toHaveLength(names.length - 2); // only top-level files
  });

  it('--no-mac-yml leaves *-mac.yml to the merge job', () => {
    const files = list('--no-mac-yml');
    expect(files).not.toContain('latest-mac.yml');
    expect(files).toContain('latest-linux.yml');
  });
});

describe('merge-mac-yml (AC-3)', () => {
  // real electron-builder output of the same version on arm64 and x64 (scripts/review/126/build-fixture.sh)
  const arm64 = fs.readFileSync(path.join(fixtures, 'arm64-latest-mac.yml'), 'utf8');
  const x64 = fs.readFileSync(path.join(fixtures, 'x64-latest-mac.yml'), 'utf8');

  it('one file with both zips and their sha512, whatever order the jobs finish', () => {
    for (const order of [
      [arm64, x64],
      [x64, arm64],
    ]) {
      const merged = mergeMacYml(order.map((t) => yaml.load(t)));
      const byUrl = Object.fromEntries(merged.files.map((f) => [f.url, f.sha512]));
      for (const src of [arm64, x64]) {
        for (const f of yaml.load(src).files) expect(byUrl[f.url]).toBe(f.sha512);
      }
      expect(merged.files.filter((f) => f.url.endsWith('.zip'))).toHaveLength(2);
      expect(merged.path).not.toContain('arm64');
      expect(merged.sha512).toBe(yaml.load(x64).sha512);
    }
  });

  it('CLI writes the merged file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
    fs.writeFileSync(path.join(dir, 'a.yml'), arm64);
    fs.writeFileSync(path.join(dir, 'b.yml'), x64);
    execFileSync('node', [
      path.join(repo, 'scripts/release/merge-mac-yml.mjs'),
      path.join(dir, 'out.yml'),
      path.join(dir, 'a.yml'),
      path.join(dir, 'b.yml'),
    ]);
    expect(yaml.load(fs.readFileSync(path.join(dir, 'out.yml'), 'utf8')).files).toHaveLength(2);
  });

  it('refuses a single arch (x64 Macs would get the arm64 zip) and mismatched versions', () => {
    expect(() => mergeMacYml([yaml.load(arm64)])).toThrow(/arm64 and an x64/);
    const other = { ...yaml.load(x64), version: '9.9.9' };
    expect(() => mergeMacYml([yaml.load(arm64), other])).toThrow(/version mismatch/);
  });
});

describe('release-tag.sh (Woodpecker release on merge)', () => {
  const sha = 'a'.repeat(40);
  // gh stub: `api …/releases` prints "<tag> <target>" lines, `api …/tags` tag names, like the script's --jq filters
  const run = ({ releases = '', tags = '', version = '1.0.0' }, ...args) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tag-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
    fs.writeFileSync(
      path.join(dir, 'gh'),
      '#!/usr/bin/env bash\ncase "$*" in *"/releases"*) printf "%s" "$STUB_RELEASES" ;; *"/tags"*) printf "%s" "$STUB_TAGS" ;; esac\n',
      { mode: 0o755 }
    );
    try {
      return execFileSync('bash', [path.join(repo, 'scripts/release/release-tag.sh'), ...args], {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GH_REPO: 'o/r',
          STUB_RELEASES: releases,
          STUB_TAGS: tags,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    } catch {
      return null;
    }
  };

  it('counts on from the highest rc of the version: old rcN tags, drafts, other versions ignored', () => {
    const releases = 'v1.0.0-rc.9 bbbb\nv1.0.0-rc7 main\n';
    const tags = 'v1.0.0-rc7\nv1.0.0-rc.8\nv1.0.1-rc.40\nv0.9.0\n';
    expect(run({ releases, tags }, sha, '--next')).toBe('v1.0.0-rc.10');
    expect(run({ tags: 'v1.0.0-rc7\n' }, sha, '--next')).toBe('v1.0.0-rc.8');
    expect(run({}, sha, '--next')).toBe('v1.0.0-rc.1');
  });

  it('returns the release that already targets the commit (pipeline restart), matched by sha', () => {
    const releases = `v1.0.0-rc.8 ${sha}\nv1.0.0-rc.9 ${'b'.repeat(40)}\n`;
    expect(run({ releases }, sha, '--next')).toBe('v1.0.0-rc.8');
    expect(run({ releases }, sha)).toBe('v1.0.0-rc.8');
  });

  it('fails without a release for the commit unless --next, after a final release, on bad input', () => {
    expect(run({ tags: 'v1.0.0-rc.8\n' }, sha)).toBeNull();
    expect(run({ tags: 'v1.0.0-rc.8\nv1.0.0\n' }, sha, '--next')).toBeNull();
    expect(run({ version: '1.0.0-rc.1' }, sha, '--next')).toBeNull();
    expect(run({}, 'main', '--next')).toBeNull();
  });
});

describe('upload-files.sh (draft uploads over REST, rc.73)', () => {
  // stubs log their calls; gh answers the REST lists in the scripts' --jq shapes ("<tag> <id>", "<id> <name>")
  const run = ({ releases, assets = '', curlExit = 0 }, ...files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-files-'));
    const log = path.join(dir, 'calls.log');
    const stub = (name, body) =>
      fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\necho "${name} $*" >> "$LOG"\n${body}\n`, {
        mode: 0o755,
      });
    stub(
      'gh',
      'case "$*" in *DELETE*) ;; *"/assets"*) printf "%s" "$STUB_ASSETS" ;; *"/releases"*) printf "%s" "$STUB_RELEASES" ;; esac'
    );
    stub('curl', 'exit $STUB_CURL_EXIT');
    stub('sleep', ':');
    for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
    let ok = true;
    try {
      execFileSync(
        'bash',
        [path.join(repo, 'scripts/release/upload-files.sh'), 'v1.0.0-rc.74', ...files.map((f) => path.join(dir, f))],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            LOG: log,
            GH_REPO: 'o/r',
            GH_TOKEN: 't',
            STUB_RELEASES: releases,
            STUB_ASSETS: assets,
            STUB_CURL_EXIT: String(curlExit),
          },
          stdio: 'pipe',
        }
      );
    } catch {
      ok = false;
    }
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { ok, calls };
  };
  const releases = 'v1.0.0-rc.73 111\nv1.0.0-rc.74 222\n';

  it('uploads to the draft found by id, replacing only the asset of the same name', () => {
    const { ok, calls } = run({ releases, assets: '9 a.zip\n8 other.yml\n' }, 'a.zip', 'b.yml');
    expect(ok).toBe(true);
    const uploads = calls.filter((c) => c.startsWith('curl'));
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toContain('/releases/222/assets?name=a.zip');
    expect(uploads[1]).toContain('/releases/222/assets?name=b.yml');
    expect(calls.filter((c) => c.includes('DELETE'))).toEqual(['gh api -X DELETE repos/o/r/releases/assets/9']);
    expect(calls.some((c) => c.includes('release upload'))).toBe(false);
  });

  it('fails without a release for the tag, and after the fourth failed try of a file', () => {
    const missing = run({ releases: 'v1.0.0-rc.73 111\n' }, 'a.zip');
    expect(missing.ok).toBe(false);
    expect(missing.calls.some((c) => c.startsWith('curl'))).toBe(false);
    const broken = run({ releases, curlExit: 22 }, 'a.zip', 'b.yml');
    expect(broken.ok).toBe(false);
    expect(broken.calls.filter((c) => c.startsWith('curl'))).toHaveLength(4);
  });
});
