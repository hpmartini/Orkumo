// Serves dist-landing under /DevHub/ like GitHub Pages does, for local checks (404s, Lighthouse).
/* global Bun */
const BASE = '/DevHub/';
const port = Number(process.env.PORT ?? 4173);

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/DevHub') return Response.redirect(BASE, 301);
    if (!pathname.startsWith(BASE)) return new Response('Not found', { status: 404 });
    const rel = pathname.slice(BASE.length) || 'index.html';
    if (rel.includes('..')) return new Response('Not found', { status: 404 });
    const file = Bun.file(`dist-landing/${rel}`);
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
  },
});
// eslint-disable-next-line no-console -- CLI output
console.log(`landing on http://localhost:${port}${BASE}`);
