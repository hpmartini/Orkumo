import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { viewShortcut, goHistory, wireBrowserViewNav } from '../electron/browserViewNav.js';

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
