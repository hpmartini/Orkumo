import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  forgetToken,
  installRemoteAuth,
  isRejectedToken,
  normalizeServerUrl,
  parseOpenLink,
  parsePairingLink,
  readPairing,
  savePairing,
  withToken,
} from './remoteClient';
import { serverOrigin, isNativeApp, API_BASE_URL } from './apiConfig';

const PAIRING = { url: 'https://mac.tail1.ts.net', token: 'secret' };

describe('normalizeServerUrl', () => {
  it('defaults to https and strips paths', () => {
    expect(normalizeServerUrl(' mac.tail1.ts.net/foo ')).toBe('https://mac.tail1.ts.net');
    expect(normalizeServerUrl('http://100.64.0.1:3001')).toBe('http://100.64.0.1:3001');
  });
  it('rejects empty and non-http input', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeServerUrl('ftp://mac')).toBeNull();
  });
});

describe('deep links', () => {
  it('parses a pairing link', () => {
    const link = `devorbit://pair?url=${encodeURIComponent(PAIRING.url)}&token=secret`;
    expect(parsePairingLink(link)).toEqual(PAIRING);
  });
  it('rejects incomplete or foreign pairing links', () => {
    expect(parsePairingLink('devorbit://pair?url=https://mac')).toBeNull();
    expect(parsePairingLink('https://evil.example/pair?url=x&token=y')).toBeNull();
  });
  it('accepts only app-internal open paths', () => {
    expect(parseOpenLink('devorbit://open?path=/agents')).toBe('/agents');
    expect(parseOpenLink('devorbit://open?path=//evil.example')).toBeNull();
    expect(parseOpenLink('devorbit://open?path=https://evil.example')).toBeNull();
  });
});

describe('pairing storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a pairing', () => {
    savePairing(PAIRING);
    expect(readPairing()).toEqual(PAIRING);
  });
  it('forgetToken keeps the URL, drops the token and remembers it as rejected', () => {
    savePairing(PAIRING);
    forgetToken();
    expect(readPairing()).toBeNull();
    expect(isRejectedToken('secret')).toBe(true);
    expect(isRejectedToken('other')).toBe(false);
  });
});

describe('withToken', () => {
  it('adds the token only for the paired server, http and ws alike', () => {
    expect(withToken('https://mac.tail1.ts.net/api/events', PAIRING)).toBe(
      'https://mac.tail1.ts.net/api/events?token=secret'
    );
    expect(withToken('wss://mac.tail1.ts.net/api/pty?sessionId=a', PAIRING)).toBe(
      'wss://mac.tail1.ts.net/api/pty?sessionId=a&token=secret'
    );
    expect(withToken('https://other.example/x', PAIRING)).toBe('https://other.example/x');
  });
});

describe('installRemoteAuth', () => {
  const original = {
    fetch: window.fetch,
    EventSource: window.EventSource,
    WebSocket: window.WebSocket,
  };
  afterEach(() => Object.assign(window, original));
  // jsdom has no EventSource
  beforeEach(() => {
    window.EventSource = class {} as unknown as typeof EventSource;
  });

  it('sends the token header to the paired server only and reports 401', async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    let status = 200;
    window.fetch = vi.fn(async (...[input, init]: Parameters<typeof fetch>) => {
      calls.push([input, init]);
      return new Response(null, { status });
    }) as typeof fetch;
    const onUnauthorized = vi.fn();
    installRemoteAuth(PAIRING, onUnauthorized);

    await fetch('https://mac.tail1.ts.net/api/agents');
    expect(new Headers(calls[0][1]?.headers).get('X-DevOrbit-Token')).toBe('secret');

    await fetch('https://other.example/x');
    expect(calls[1][1]).toBeUndefined();

    status = 401;
    await fetch('https://mac.tail1.ts.net/api/agents');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('appends the token to WebSocket URLs', () => {
    const seen: string[] = [];
    window.WebSocket = class {
      constructor(url: string) {
        seen.push(url);
      }
    } as unknown as typeof WebSocket;
    installRemoteAuth(PAIRING, () => {});
    new WebSocket('wss://mac.tail1.ts.net/api/pty?sessionId=a');
    expect(seen[0]).toBe('wss://mac.tail1.ts.net/api/pty?sessionId=a&token=secret');
  });
});

describe('apiConfig', () => {
  it('stays same-origin in the browser (desktop unchanged)', () => {
    expect(isNativeApp).toBe(false);
    expect(API_BASE_URL).toBe('/api');
  });
  it('uses the paired server in the iOS app and localhost in Electron', () => {
    expect(serverOrigin(true, PAIRING, false)).toBe('https://mac.tail1.ts.net');
    expect(serverOrigin(false, null, true)).toMatch(/^http:\/\/localhost:\d+$/);
    expect(serverOrigin(false, null, false)).toBe('');
  });
});
