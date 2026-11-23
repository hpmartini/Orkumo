/**
 * The web build (Vite `dist`) for browsers that reach this server directly, e.g. Safari on the iPad
 * through `tailscale serve`. Mounted before the token gate: page and assets hold no secrets, every
 * /api request still needs the pairing token (browser pairing: `#pair=<token>`, utils/remoteClient.ts).
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';

export function webApp(dir) {
  const files = express.static(dir, { index: false });
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    files(req, res, async () => {
      // SPA fallback for navigations only; a missing asset must not come back as the page
      if (path.extname(req.path) || !req.accepts('html')) return next();
      try {
        const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
        // The build uses relative asset paths (base './' for Electron's file://); deep links need a root base
        res.type('html').set('Cache-Control', 'no-cache');
        res.send(html.replace('<head>', '<head><base href="/">'));
      } catch {
        next();
      }
    });
  };
}
