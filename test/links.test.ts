import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  routeLink,
  openLink,
  setLinkTarget,
  registerShellBrowser,
  interceptAnchorClick,
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
    expect(click('https://github.com/pr/1').defaultPrevented).toBe(true);
    expect(shell).toHaveBeenCalledWith('https://github.com/pr/1');
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
