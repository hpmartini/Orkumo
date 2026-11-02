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
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    // Pages gzips text responses; without it local Lighthouse runs measure a slower site
    if (!/\.(html|css|js|svg)$/.test(rel) || !req.headers.get('accept-encoding')?.includes('gzip'))
      return new Response(file);
    return new Response(Bun.gzipSync(await file.bytes()), {
      headers: { 'Content-Type': file.type, 'Content-Encoding': 'gzip' },
    });
  },
});
// eslint-disable-next-line no-console -- CLI output
console.log(`landing on http://localhost:${port}${BASE}`);
