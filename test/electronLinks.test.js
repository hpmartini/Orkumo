import { describe, it, expect } from 'vitest';
import { windowOpenRoute, isValidExternalUrl } from '../electron/validation.js';
import { routeLink } from '../utils/links';

/** What happens to a window.open from the app or the Web-IDE in Electron (#140), end to end */
function electronOpen(url, setting, isDev = false) {
  if (windowOpenRoute(url) === 'blocked') return 'blocked';
  const route = routeLink(url, setting);
  if (route !== 'system') return route;
  // the system path is the open-external IPC, which keeps its own validation
  return isValidExternalUrl(url, isDev) ? 'system' : 'blocked';
}

describe('windowOpenRoute', () => {
  it.each(['https://github.com/x', 'http://localhost:5173/'])('hands %s to the renderer', (url) => {
    expect(windowOpenRoute(url)).toBe('renderer');
  });

  it.each(['mailto:a@b.de', 'file:///etc/passwd', 'javascript:alert(1)', 'vscode://x', 'nope'])(
    'blocks %s as before',
    (url) => {
      expect(windowOpenRoute(url)).toBe('blocked');
    }
  );
});

describe('Web-IDE link in the desktop app', () => {
  it('opens in the built-in browser by default', () => {
    expect(electronOpen('https://code.visualstudio.com/docs', 'builtin')).toBe('builtin');
    expect(electronOpen('http://localhost:3000/', 'builtin')).toBe('builtin');
  });

  it('opens in the system browser when configured', () => {
    expect(electronOpen('https://code.visualstudio.com/docs', 'system')).toBe('system');
  });

  it('never opens file:, javascript: or other schemes anywhere', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.de']) {
      expect(electronOpen(url, 'builtin')).toBe('blocked');
      expect(electronOpen(url, 'system')).toBe('blocked');
    }
  });
});
