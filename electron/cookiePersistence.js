/**
 * Logins in the built-in browser survive an app restart (#186).
 * Chromium drops cookies without an expiry (session cookies) on quit; Chrome only keeps them through
 * session restore, which Electron lacks. claude.ai sets its login cookie that way, so every restart logged out.
 */

export const SESSION_COOKIE_DAYS = 30;

/**
 * Pure: the cookies.set() details that make a session cookie persistent, or null to leave it alone.
 * shortcut: Electron's Cookie has no Partitioned/partitionKey field, so a partitioned (CHIPS) session cookie
 * from a third-party frame comes back unpartitioned; upgrade once Electron exposes partitionKey.
 */
export function persistentCookieDetails(cookie, nowSeconds) {
  if (!cookie.session) return null;
  const host = cookie.domain.replace(/^\./, '');
  const details = {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: nowSeconds + SESSION_COOKIE_DAYS * 24 * 60 * 60,
  };
  // host-only cookies (and __Host- ones) must not get a Domain attribute, it would widen them to subdomains
  if (!cookie.hostOnly) details.domain = cookie.domain;
  return details;
}

/** Re-sets every session cookie of this session with an expiry; the re-set cookie is no longer a session one */
export function persistSessionCookies(session) {
  session.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed) return;
    const details = persistentCookieDetails(cookie, Math.floor(Date.now() / 1000));
    if (!details) return;
    // the event is async: if the page removed or replaced the cookie meanwhile (logout), don't bring it back
    session.cookies
      .get({ url: details.url, name: cookie.name })
      .then((now) => {
        const current = now.find((c) => c.domain === cookie.domain && c.path === cookie.path);
        if (current?.session && current.value === cookie.value) return session.cookies.set(details);
      })
      .catch((err) => {
        console.warn(
          `[cookies] could not persist ${cookie.name} for ${cookie.domain}: ${err.message}`
        );
      });
  });
}
