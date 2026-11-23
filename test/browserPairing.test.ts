// Safari on the iPad: the browser link `https://<server>/#pair=<token>` pairs the web app, which then
// sends the token like the iOS app (relative /api URLs included).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { browserPairing, installRemoteAuth, withToken } from '../utils/remoteClient';

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('browserPairing', () => {
  it('takes the token from #pair=, stores it for this origin and drops it from the address', () => {
    window.history.replaceState(null, '', '/agents#pair=tok123');
    expect(browserPairing()).toEqual({ url: window.location.origin, token: 'tok123' });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/agents');
    expect(browserPairing()).toEqual({ url: window.location.origin, token: 'tok123' });
  });

  it('is null without a link and without a stored pairing', () => {
    expect(browserPairing()).toBeNull();
  });

  it('ignores a pairing stored for another server', () => {
    localStorage.setItem(
      'devorbit.pairing',
      JSON.stringify({ url: 'https://other.ts.net', token: 'x' })
    );
    expect(browserPairing()).toBeNull();
  });
});

describe('token on relative URLs (same-origin web app)', () => {
  const pairing = () => ({ url: window.location.origin, token: 'tok123' });

  it('adds the token to a relative SSE/WebSocket URL', () => {
    expect(withToken('/api/agents/stream', pairing())).toContain('token=tok123');
  });

  it('sends the header on a relative fetch', async () => {
    const seen: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return new Response('{}');
      })
    );
    vi.stubGlobal('EventSource', class {}); // jsdom has none
    vi.stubGlobal('WebSocket', class {});
    installRemoteAuth(pairing(), () => {});
    await fetch('/api/config');
    expect(seen[0]?.get('X-DevOrbit-Token')).toBe('tok123');
  });
});
