import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import {
  resolveUpdateMode,
  setupUpdater,
  checkWithFinalFallback,
  feedOverride,
  isDeveloperIdSigned,
  releasePageUrl,
  GITHUB_FEED,
} from '../electron/updater.js';

const quiet = { log: () => {}, error: () => {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeUpdater(currentVersion = '1.0.0-rc.1') {
  const u = new EventEmitter();
  Object.assign(u, {
    currentVersion,
    allowPrerelease: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: false })),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn(),
  });
  return u;
}

function wire(mode, { response = 0, env = {} } = {}) {
  const autoUpdater = fakeUpdater();
  const dialog = { showMessageBox: vi.fn(async () => ({ response })) };
  const shell = { openExternal: vi.fn() };
  const check = setupUpdater({
    autoUpdater,
    dialog,
    shell,
    getWindow: () => null,
    mode,
    env,
    log: quiet,
  });
  return { autoUpdater, dialog, shell, check };
}

describe('resolveUpdateMode', () => {
  const base = { isDev: false, env: {}, hasUpdateConfig: true, macSigned: () => true };
  it.each([
    ['dev build', { isDev: true, platform: 'darwin' }, 'off'],
    [
      'disabled by env',
      { platform: 'linux', env: { ORKUMO_DISABLE_UPDATES: '1', APPIMAGE: '/a' } },
      'off',
    ],
    ['linux AppImage', { platform: 'linux', env: { APPIMAGE: '/x/Orkumo.AppImage' } }, 'install'],
    ['linux .deb/.rpm (no APPIMAGE)', { platform: 'linux' }, 'notify'],
    ['mac Developer ID', { platform: 'darwin' }, 'install'],
    ['mac ad-hoc', { platform: 'darwin', macSigned: () => false }, 'notify'],
    [
      '--dir build without app-update.yml',
      { platform: 'darwin', hasUpdateConfig: false },
      'notify',
    ],
    ['other platform', { platform: 'win32' }, 'notify'],
  ])('%s → %s', (_name, over, expected) => {
    expect(resolveUpdateMode({ ...base, ...over })).toBe(expected);
  });

  it('does not run codesign without app-update.yml', () => {
    const macSigned = vi.fn(() => true);
    resolveUpdateMode({ ...base, platform: 'darwin', hasUpdateConfig: false, macSigned });
    expect(macSigned).not.toHaveBeenCalled();
  });
});

describe('isDeveloperIdSigned', () => {
  const devId =
    'Executable=/x\nAuthority=Developer ID Application: Martini Labs (ABC123)\nAuthority=Apple Root CA';
  const spawn = (stderr) => () => ({ status: 0, stdout: '', stderr });
  it('accepts a Developer ID authority (codesign prints to stderr)', () => {
    expect(isDeveloperIdSigned('/A.app', spawn(devId))).toBe(true);
  });
  it('ignores stdout', () => {
    expect(isDeveloperIdSigned('/A.app', () => ({ stdout: devId, stderr: '' }))).toBe(false);
  });
  it('rejects ad-hoc and unsigned', () => {
    expect(isDeveloperIdSigned('/A.app', spawn('Signature=adhoc\nTeamIdentifier=not set'))).toBe(
      false
    );
    expect(
      isDeveloperIdSigned('/A.app', () => ({
        status: 1,
        stderr: 'code object is not signed at all',
      }))
    ).toBe(false);
  });
  it.runIf(process.platform === 'darwin')(
    'real codesign: a system app is not Developer ID signed',
    () => {
      expect(isDeveloperIdSigned('/System/Applications/Calculator.app')).toBe(false);
    }
  );
});

describe('feedOverride', () => {
  it('maps an http(s) URL to a GitHub-compatible host', () => {
    expect(feedOverride({ ORKUMO_UPDATE_FEED: 'http://127.0.0.1:18126' })).toEqual({
      ...GITHUB_FEED,
      host: '127.0.0.1:18126',
      protocol: 'http',
    });
  });
  it.each([
    'file:///etc',
    'javascript:alert(1)',
    'not a url',
    '',
    'https://evil.example',
    'http://10.0.0.1:80',
  ])('ignores %s', (value) => {
    expect(feedOverride({ ORKUMO_UPDATE_FEED: value })).toBeNull();
  });
});

describe('setupUpdater', () => {
  it('off mode wires nothing', () => {
    const { check, autoUpdater } = wire('off');
    expect(check).toBeNull();
    expect(autoUpdater.listenerCount('error')).toBe(0);
  });

  it('background check errors are logged, never shown (AC-1)', async () => {
    const { autoUpdater, dialog } = wire('install');
    autoUpdater.emit('error', new Error('HttpError: 406\nheaders: ' + 'x'.repeat(2000)));
    await tick();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('a failed user-started download shows only the first error line', async () => {
    const { autoUpdater, dialog } = wire('install');
    autoUpdater.emit('update-available', { version: '1.0.0-rc.2' });
    await tick();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
    autoUpdater.emit('error', new Error('sha512 checksum mismatch\nline two\nline three'));
    await tick();
    const options = dialog.showMessageBox.mock.calls.at(-1).at(-1);
    expect(options.type).toBe('error');
    expect(options.message).toBe('sha512 checksum mismatch');
    expect(JSON.stringify(options)).not.toContain('line two');
  });

  it('install mode: download, then restart on confirm', async () => {
    const { autoUpdater } = wire('install');
    autoUpdater.emit('update-downloaded', { version: '1.0.0-rc.2' });
    await tick();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('install mode: "Später" downloads nothing', async () => {
    const { autoUpdater } = wire('install', { response: 1 });
    autoUpdater.emit('update-available', { version: '1.0.0-rc.2' });
    await tick();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('notify mode opens the release page and never downloads (AC-7)', async () => {
    const { autoUpdater, shell } = wire('notify');
    autoUpdater.emit('update-available', { version: '1.0.0-rc.2' });
    await tick();
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.2'
    );
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('notify mode sets the GitHub feed (no app-update.yml in --dir builds)', () => {
    const { autoUpdater } = wire('notify');
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(GITHUB_FEED);
  });

  it('install mode keeps app-update.yml unless a test feed is set', () => {
    expect(wire('install').autoUpdater.setFeedURL).not.toHaveBeenCalled();
    const { autoUpdater } = wire('install', { env: { ORKUMO_UPDATE_FEED: 'http://127.0.0.1:1' } });
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1:1' })
    );
  });
});

describe('checkWithFinalFallback (AC-5)', () => {
  it('rc without newer rc: checks final releases too', async () => {
    const u = fakeUpdater('1.0.0-rc.2');
    const seen = [];
    u.checkForUpdates.mockImplementation(async () => {
      seen.push(u.allowPrerelease);
      return { isUpdateAvailable: !u.allowPrerelease };
    });
    const result = await checkWithFinalFallback(u, quiet);
    expect(seen).toEqual([true, false]);
    expect(result.isUpdateAvailable).toBe(true);
    expect(u.allowPrerelease).toBe(true);
  });

  it('rc with newer rc: one check', async () => {
    const u = fakeUpdater('1.0.0-rc.1');
    u.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true });
    await checkWithFinalFallback(u, quiet);
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('final version: one check', async () => {
    const u = fakeUpdater('1.0.0');
    await checkWithFinalFallback(u, quiet);
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('both checks failing never throws', async () => {
    const u = fakeUpdater('1.0.0-rc.1');
    u.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await expect(checkWithFinalFallback(u, quiet)).resolves.toBeNull();
  });
});

it('releasePageUrl encodes the version', () => {
  expect(releasePageUrl('1.0.0-rc.2')).toBe(
    'https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.2'
  );
  expect(releasePageUrl('1/../../x')).not.toContain('/../');
});
