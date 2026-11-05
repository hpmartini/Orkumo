import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  persistentCookieDetails,
  persistSessionCookies,
  SESSION_COOKIE_DAYS,
} from '../electron/cookiePersistence.js';

const NOW = 1_800_000_000;
const sessionCookie = {
  name: 'sessionKey',
  value: 'v',
  domain: 'claude.ai',
  hostOnly: true,
  path: '/',
  secure: true,
  httpOnly: true,
  session: true,
  sameSite: 'lax',
};

describe('persistentCookieDetails (#186)', () => {
  it('gives a session cookie an expiry and keeps its attributes', () => {
    expect(persistentCookieDetails(sessionCookie, NOW)).toEqual({
      url: 'https://claude.ai/',
      name: 'sessionKey',
      value: 'v',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: NOW + SESSION_COOKIE_DAYS * 86400,
    });
  });

  it('leaves cookies with an expiry alone', () => {
    expect(
      persistentCookieDetails({ ...sessionCookie, session: false, expirationDate: NOW + 5 }, NOW)
    ).toBeNull();
  });

  it('keeps the Domain attribute only for domain cookies', () => {
    const d = persistentCookieDetails(
      { ...sessionCookie, domain: '.claude.ai', hostOnly: false },
      NOW
    );
    expect(d.domain).toBe('.claude.ai');
    expect(d.url).toBe('https://claude.ai/');
    expect('domain' in persistentCookieDetails(sessionCookie, NOW)).toBe(false);
  });

  it('builds an http url for non-secure cookies and keeps the path', () => {
    const d = persistentCookieDetails({ ...sessionCookie, secure: false, path: '/app' }, NOW);
    expect(d.url).toBe('http://claude.ai/app');
  });
});

describe('persistSessionCookies', () => {
  // jar: what cookies.get() returns when the async re-set looks again
  const fakeSession = (jar) => {
    let listener;
    const cookies = {
      on: (_e, fn) => (listener = fn),
      get: vi.fn(() => Promise.resolve(jar)),
      set: vi.fn(() => Promise.resolve()),
    };
    return { session: { cookies }, fire: (...a) => listener({}, ...a), set: cookies.set };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('re-sets added session cookies, ignores removals and persistent ones', async () => {
    const { session, fire, set } = fakeSession([sessionCookie]);
    persistSessionCookies(session);
    fire(sessionCookie, 'explicit', false);
    fire(sessionCookie, 'expired', true);
    fire({ ...sessionCookie, session: false }, 'explicit', false);
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].name).toBe('sessionKey');
  });

  it('does not bring back a cookie the page removed or replaced meanwhile (logout)', async () => {
    for (const jar of [[], [{ ...sessionCookie, value: 'new' }]]) {
      const { session, fire, set } = fakeSession(jar);
      persistSessionCookies(session);
      fire(sessionCookie, 'explicit', false);
      await flush();
      expect(set).not.toHaveBeenCalled();
    }
  });
});

describe('main.js wiring', () => {
  it('persists session cookies of the partition the built-in browser uses', () => {
    const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
    expect(main).toContain("const BROWSER_PREVIEW_PARTITION = 'persist:browser-preview'");
    expect(main).toContain('partition: BROWSER_PREVIEW_PARTITION');
    expect(main).toContain(
      'persistSessionCookies(session.fromPartition(BROWSER_PREVIEW_PARTITION))'
    );
  });
});
