import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  routeLink,
  openLink,
  setLinkTarget,
  registerShellBrowser,
  interceptAnchorClick,
  installAnchorInterception,
  linkTargetFor,
  registerPaneBrowser,
  DEFAULT_LINK_KEYS,
} from '../utils/links';

afterEach(() => {
  setLinkTarget('builtin');
  vi.restoreAllMocks();
  delete window.electronAPI;
});

describe('routeLink', () => {
  it('opens http(s) in the configured browser', () => {
    expect(routeLink('https://github.com/x', 'builtin')).toBe('builtin');
    expect(routeLink('http://localhost:5173/', 'builtin')).toBe('builtin');
    expect(routeLink('https://github.com/x', 'system')).toBe('system');
  });

  it.each(['mailto:a@b.de', 'vscode://file/x', 'ssh://host'])(
    'never opens %s in the built-in browser',
    (url) => {
      expect(routeLink(url, 'builtin')).toBe('system');
    }
  );

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'not a url'])(
    'blocks %s',
    (url) => {
      expect(routeLink(url, 'builtin')).toBe('blocked');
      expect(routeLink(url, 'system')).toBe('blocked');
    }
  );
});

describe('openLink', () => {
  it('builtin: hands the url to the pane opener, falling back to the shell panel', () => {
    const shell = vi.fn();
    const unregister = registerShellBrowser(shell);
    const pane = vi.fn();
    openLink('https://a.de', pane);
    expect(pane).toHaveBeenCalledWith('https://a.de');
    openLink('https://b.de');
    expect(shell).toHaveBeenCalledWith('https://b.de');
    unregister();
  });

  it('system: opens externally and leaves the built-in browser alone', () => {
    setLinkTarget('system');
    const pane = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openLink('https://a.de', pane)).toBe('system');
    expect(pane).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://a.de', '_blank', 'noopener,noreferrer');
  });

  it('system in Electron goes through openExternal, not window.open', () => {
    setLinkTarget('system');
    const openExternal = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = { openExternal } as unknown as typeof window.electronAPI;
    const open = vi.spyOn(window, 'open');
    openLink('https://a.de');
    expect(openExternal).toHaveBeenCalledWith('https://a.de');
    expect(open).not.toHaveBeenCalled();
  });

  it('system refused by Electron (localhost in prod) falls back to the built-in browser', async () => {
    setLinkTarget('system');
    const openExternal = vi.fn().mockResolvedValue({ success: false, error: 'Invalid URL' });
    window.electronAPI = { openExternal } as unknown as typeof window.electronAPI;
    const pane = vi.fn();
    openLink('http://localhost:5173/', pane);
    await vi.waitFor(() => expect(pane).toHaveBeenCalledWith('http://localhost:5173/'));
  });

  it('blocked urls open nowhere', () => {
    const pane = vi.fn();
    const open = vi.spyOn(window, 'open');
    expect(openLink('javascript:alert(1)', pane)).toBe('blocked');
    expect(pane).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('interceptAnchorClick', () => {
  const click = (href: string, target = '_blank') => {
    const a = document.createElement('a');
    a.href = href;
    a.target = target;
    document.body.appendChild(a);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'target', { value: a });
    interceptAnchorClick(event);
    a.remove();
    return event;
  };

  it('routes target=_blank http(s) anchors into the shell browser', () => {
    const shell = vi.fn();
    const unregister = registerShellBrowser(shell);
    expect(click('https://example.org/pr/1').defaultPrevented).toBe(true);
    expect(shell).toHaveBeenCalledWith('https://example.org/pr/1');
    unregister();
  });

  it('sees anchors whose row stops propagation; Cmd-click goes to the system browser', () => {
    const shell = vi.fn();
    const unregister = registerShellBrowser(shell);
    const uninstall = installAnchorInterception();
    const row = document.createElement('div');
    row.addEventListener('click', (e) => e.stopPropagation());
    const a = document.createElement('a');
    a.href = 'https://example.org/o/r/issues';
    a.target = '_blank';
    row.appendChild(a);
    document.body.appendChild(row);
    const fire = (init: { metaKey?: boolean } = {}) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      a.dispatchEvent(event);
      return event.defaultPrevented;
    };
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(fire({ metaKey: true })).toBe(true);
    expect(window.open).toHaveBeenCalledWith(
      'https://example.org/o/r/issues',
      '_blank',
      'noopener,noreferrer'
    );
    expect(shell).not.toHaveBeenCalled();
    expect(fire()).toBe(true);
    expect(shell).toHaveBeenCalledWith('https://example.org/o/r/issues');
    uninstall();
    row.remove();
    unregister();
  });

  it('sends Cmd/Ctrl+Shift-clicks to the system browser despite the built-in target', () => {
    const shell = vi.fn();
    const unregister = registerShellBrowser(shell);
    const openExternal = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = { openExternal } as unknown as typeof window.electronAPI;
    const a = document.createElement('a');
    a.href = 'https://example.org/pr/2';
    a.target = '_blank';
    for (const mod of ['metaKey', 'ctrlKey'] as const) {
      const event = new MouseEvent('click', { cancelable: true, [mod]: true, shiftKey: true });
      Object.defineProperty(event, 'target', { value: a });
      interceptAnchorClick(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal).toHaveBeenCalledWith('https://example.org/pr/2');
    expect(shell).not.toHaveBeenCalled();
    unregister();
  });

  it('leaves same-tab anchors and mailto alone', () => {
    const shell = vi.fn();
    const unregister = registerShellBrowser(shell);
    expect(click('https://a.de', '').defaultPrevented).toBe(false);
    expect(click('mailto:a@b.de').defaultPrevented).toBe(false);
    expect(shell).not.toHaveBeenCalled();
    unregister();
  });
});

describe('click gestures', () => {
  const ev = (
    init: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {},
    button = 0
  ) => ({
    button,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  });

  it('defaults: click per setting, Cmd and middle system, Shift side, Option split', () => {
    const k = DEFAULT_LINK_KEYS;
    expect(linkTargetFor(ev(), 'builtin', k)).toBe('builtin');
    expect(linkTargetFor(ev(), 'side', k)).toBe('side');
    expect(linkTargetFor(ev({ metaKey: true }), 'builtin', k)).toBe('system');
    expect(linkTargetFor(ev({ ctrlKey: true }), 'builtin', k)).toBe('system');
    expect(linkTargetFor(ev({}, 1), 'builtin', k)).toBe('system');
    expect(linkTargetFor(ev({ shiftKey: true }), 'system', k)).toBe('side');
    expect(linkTargetFor(ev({ altKey: true }), 'system', k)).toBe('builtin');
  });

  it('terminal: Cmd/Ctrl is the click itself, Shift/Option on top pick', () => {
    const k = DEFAULT_LINK_KEYS;
    expect(linkTargetFor(ev({ metaKey: true }), 'builtin', k, true)).toBe('builtin');
    expect(linkTargetFor(ev({ metaKey: true, shiftKey: true }), 'builtin', k, true)).toBe('side');
    expect(linkTargetFor(ev({ ctrlKey: true, altKey: true }), 'side', k, true)).toBe('builtin');
  });

  it('a link in an agent pane opens a split there; side and foreign panes use the side view', () => {
    const shell = vi.fn();
    const offShell = registerShellBrowser(shell);
    const split = vi.fn();
    const offPane = registerPaneBrowser((paneId, url) => {
      if (paneId !== 'agent-1') return false;
      split(paneId, url);
      return true;
    });
    const anchorIn = (paneId: string) => {
      const pane = document.createElement('div');
      pane.setAttribute('data-agent-pane', paneId);
      const a = document.createElement('a');
      a.href = 'https://example.org/docs';
      a.target = '_blank';
      pane.appendChild(a);
      document.body.appendChild(pane);
      return a;
    };
    const fire = (a: HTMLAnchorElement, init: { shiftKey?: boolean } = {}) => {
      const event = new MouseEvent('click', { cancelable: true, ...init });
      Object.defineProperty(event, 'target', { value: a });
      interceptAnchorClick(event);
      return event.defaultPrevented;
    };
    const own = anchorIn('agent-1');
    expect(fire(own)).toBe(true);
    expect(split).toHaveBeenCalledWith('agent-1', 'https://example.org/docs');
    expect(shell).not.toHaveBeenCalled();
    expect(fire(own, { shiftKey: true })).toBe(true);
    expect(shell).toHaveBeenCalledTimes(1);
    expect(fire(anchorIn('history-9'))).toBe(true);
    expect(split).toHaveBeenCalledTimes(1);
    expect(shell).toHaveBeenCalledTimes(2);
    document.body.innerHTML = '';
    offPane();
    offShell();
  });

  it('middle click (auxclick) is intercepted too', () => {
    const uninstall = installAnchorInterception();
    vi.spyOn(window, 'open').mockReturnValue(null);
    const a = document.createElement('a');
    a.href = 'https://example.org/x';
    a.target = '_blank';
    document.body.appendChild(a);
    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    a.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(window.open).toHaveBeenCalledWith(
      'https://example.org/x',
      '_blank',
      'noopener,noreferrer'
    );
    a.remove();
    uninstall();
  });
});

describe('web mode (no Electron BrowserView)', () => {
  it('github.com refuses iframes: opens externally instead of a blank panel', () => {
    const shell = vi.fn();
    const unregister = registerShellBrowser(shell);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const pr = 'https://github.com/o/r/pull/1';
    expect(openLink(pr)).toBe('system');
    expect(open).toHaveBeenCalledWith(pr, '_blank', 'noopener,noreferrer');
    expect(shell).not.toHaveBeenCalled();
    window.electronAPI = { browserView: {} } as unknown as typeof window.electronAPI;
    expect(openLink(pr)).toBe('builtin');
    expect(shell).toHaveBeenCalledWith(pr);
    unregister();
  });
});
