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

describe('release tag schema (#126 point 4)', () => {
  const workflow = fs.readFileSync(path.join(repo, '.github/workflows/release.yml'), 'utf8');
  const pattern = /\[\[ "\$TAG" =~ (\S+) \]\]/.exec(workflow)[1];
  const accepts = (tag) => {
    try {
      execFileSync('bash', ['-c', `[[ "$1" =~ ${pattern} ]]`, '_', tag]);
      return true;
    } catch {
      return false;
    }
  };
  it.each(['v1.0.0', 'v1.0.0-rc.8', 'v1.2.10-rc.10'])('accepts %s', (tag) =>
    expect(accepts(tag)).toBe(true)
  );
  it.each(['v1.0.0-rc7', '1.0.0', 'v1.0.0-beta.1', 'v1.0.0-rc.1-x'])('rejects %s', (tag) =>
    expect(accepts(tag)).toBe(false)
  );

  // the whole "Set version from tag" step, run against a scratch package.json
  const step = yaml
    .load(workflow)
    .jobs.build.steps.find((s) => s.name === 'Set version from tag').run;
  const runStep = (TAG, PRERELEASE) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x","version":"0.0.0"}');
    try {
      execFileSync('bash', ['-c', step], {
        cwd: dir,
        env: { ...process.env, TAG, PRERELEASE },
        stdio: 'pipe',
      });
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    } catch {
      return null;
    }
  };
  it.each([
    ['v1.0.0-rc.8', 'true', '1.0.0-rc.8'],
    ['v1.0.0', 'false', '1.0.0'],
    ['v1.0.0-rc.8', 'false', null], // /releases/latest would return the rc
    ['v1.0.0', 'true', null], // rc installs would never see the final release
  ])('%s with prerelease=%s → %s', (tag, pre, version) => {
    expect(runStep(tag, pre)).toBe(version);
  });
});
