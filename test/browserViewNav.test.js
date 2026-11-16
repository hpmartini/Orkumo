import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  viewShortcut,
  goHistory,
  wireBrowserViewNav,
  windowOpenTarget,
  wireViewPopups,
} from '../electron/browserViewNav.js';

const key = (key, mods = {}) => ({ type: 'keyDown', key, ...mods });

describe('viewShortcut (#182)', () => {
  it.each([
    [key('r', { meta: true }), 'darwin', 'reload'],
    [key('R', { meta: true, shift: true }), 'darwin', 'reload'],
    [key('F5'), 'darwin', 'reload'],
    [key('F5'), 'win32', 'reload'],
    [key('r', { control: true }), 'linux', 'reload'],
    [key('[', { meta: true }), 'darwin', 'back'],
    [key(']', { meta: true }), 'darwin', 'forward'],
    [key('ArrowLeft', { alt: true }), 'linux', 'back'],
    [key('ArrowRight', { alt: true }), 'win32', 'forward'],
    [key('r', { control: true }), 'darwin', null],
    [key('r', { meta: true }), 'win32', null],
    [key('r'), 'darwin', null],
    [key('r', { meta: true, alt: true }), 'darwin', null],
    [key('ArrowLeft', { meta: true }), 'darwin', null],
    [key('ArrowLeft', { alt: true }), 'darwin', null],
    [key('['), 'darwin', null],
    [{ type: 'keyUp', key: 'F5' }, 'darwin', null],
  ])('%o on %s -> %s', (input, platform, expected) => {
    expect(viewShortcut(input, platform)).toBe(expected);
  });
});

function fakeWebContents({ canGoBack = true, canGoForward = false } = {}) {
  const wc = new EventEmitter();
  wc.reload = vi.fn();
  wc.getURL = () => 'http://localhost:1/b';
  wc.navigationHistory = {
    canGoBack: () => canGoBack,
    canGoForward: () => canGoForward,
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  return wc;
}

describe('wireBrowserViewNav (#182)', () => {
  it('Cmd+R in the view reloads only the view and blocks the app menu accelerator', () => {
    const wc = fakeWebContents();
    wireBrowserViewNav(wc, () => {}, 'darwin');
    const event = { preventDefault: vi.fn() };
    wc.emit('before-input-event', event, key('r', { meta: true }));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(wc.reload).toHaveBeenCalledTimes(1);

    const typing = { preventDefault: vi.fn() };
    wc.emit('before-input-event', typing, key('r'));
    expect(typing.preventDefault).not.toHaveBeenCalled();
    expect(wc.reload).toHaveBeenCalledTimes(1);
  });

  it('Cmd+[ goes back in the view', () => {
    const wc = fakeWebContents();
    wireBrowserViewNav(wc, () => {}, 'darwin');
    wc.emit('before-input-event', { preventDefault: vi.fn() }, key('[', { meta: true }));
    expect(wc.navigationHistory.goBack).toHaveBeenCalledTimes(1);
  });

  it('reports main-frame navigations only', () => {
    const wc = fakeWebContents();
    const send = vi.fn();
    wireBrowserViewNav(wc, send, 'darwin');
    wc.emit('did-navigate');
    wc.emit('did-navigate-in-page', {}, 'http://localhost:1/b#x', false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      url: 'http://localhost:1/b',
      canGoBack: true,
      canGoForward: false,
    });
  });
});

describe('goHistory (#182)', () => {
  it('is a no-op at the ends of the history', () => {
    const wc = fakeWebContents({ canGoBack: false, canGoForward: false });
    goHistory(wc, 'back');
    goHistory(wc, 'forward');
    expect(wc.navigationHistory.goBack).not.toHaveBeenCalled();
    expect(wc.navigationHistory.goForward).not.toHaveBeenCalled();
  });
});

describe('windowOpenTarget (Google sign-in popup)', () => {
  const route = (url) => (/^https?:/.test(url) ? 'renderer' : 'blocked');
  it.each([
    [{ url: 'https://accounts.google.com/o/oauth2/v2/auth', disposition: 'new-window' }, 'popup'],
    [{ url: 'https://example.com', disposition: 'foreground-tab' }, 'view'],
    [{ url: 'https://example.com', disposition: 'background-tab' }, 'view'],
    [{ url: 'file:///etc/passwd', disposition: 'new-window' }, null],
  ])('%o -> %s', (details, expected) => {
    expect(windowOpenTarget(details, route)).toBe(expected);
  });
});

describe('wireViewPopups', () => {
  const route = (url) => (/^https?:/.test(url) ? 'renderer' : 'blocked');
  const makeWc = () => {
    const wc = new EventEmitter();
    wc.loadURL = vi.fn(() => Promise.resolve());
    wc.setWindowOpenHandler = (h) => (wc.openHandler = h);
    return wc;
  };

  it('allows a sandboxed popup in the view session and tracks it until closed', () => {
    const wc = makeWc();
    const popups = wireViewPopups(wc, { parent: 'main', partition: 'persist:x', route });
    const res = wc.openHandler({ url: 'https://accounts.google.com/x', disposition: 'new-window' });
    expect(res.action).toBe('allow');
    expect(res.overrideBrowserWindowOptions.parent).toBe('main');
    expect(res.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:x',
    });
    const popup = new EventEmitter();
    popup.webContents = makeWc();
    wc.emit('did-create-window', popup);
    expect(popups.has(popup)).toBe(true);
    expect(popup.webContents.openHandler({ url: 'https://a.b/c' })).toEqual({ action: 'deny' });
    expect(popup.webContents.loadURL).toHaveBeenCalledWith('https://a.b/c');
    popup.emit('closed');
    expect(popups.size).toBe(0);
  });

  it('caps popups per view and keeps popup navigation on http(s)', () => {
    const wc = makeWc();
    const popups = wireViewPopups(wc, { parent: null, partition: 'p', route });
    const open = () => wc.openHandler({ url: 'https://idp.example/a', disposition: 'new-window' });
    for (let i = 0; i < 3; i++) {
      expect(open().action).toBe('allow');
      const popup = new EventEmitter();
      popup.webContents = makeWc();
      wc.emit('did-create-window', popup);
      if (i === 0) {
        const event = { preventDefault: vi.fn() };
        popup.webContents.emit('will-navigate', event, 'file:///etc/passwd');
        expect(event.preventDefault).toHaveBeenCalled();
      }
    }
    expect(popups.size).toBe(3);
    expect(open()).toEqual({ action: 'deny' });
  });

  it('keeps target=_blank links in the view', () => {
    const wc = makeWc();
    wireViewPopups(wc, { parent: null, partition: 'p', route });
    expect(wc.openHandler({ url: 'https://x.y', disposition: 'foreground-tab' })).toEqual({
      action: 'deny',
    });
    expect(wc.loadURL).toHaveBeenCalledWith('https://x.y');
  });
});
