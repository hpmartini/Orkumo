#!/usr/bin/env node
// Serves <root>/<tag>/<file> the way github.com serves hpmartini/Orkumo releases, for the #126 e2e:
//   /hpmartini/Orkumo/releases.atom                         feed, newest release first (creation order, like GitHub)
//   /api/v3/repos/hpmartini/Orkumo/releases/latest          newest non-prerelease (GitHub Enterprise API path,
//                                                           used by electron-updater for a non-github.com host)
//   /hpmartini/Orkumo/releases/download/<tag>/<file>        assets
// Usage: fake-github.mjs <root> <port>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import semver from 'semver';

const [root, port] = process.argv.slice(2);
const base = '/hpmartini/Orkumo/releases';

const tags = () =>
  fs
    .readdirSync(root)
    .filter((t) => semver.valid(t))
    .map((t) => [t, fs.statSync(path.join(root, t)).birthtimeMs])
    .sort((a, b) => b[1] - a[1] || semver.rcompare(a[0], b[0]))
    .map(([t]) => t);

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    console.log(`${req.method} ${url.pathname}`);
    if (url.pathname === `${base}.atom`) {
      const entries = tags()
        .map(
          (t) =>
            `<entry><id>tag:${t}</id><title>${t}</title><link rel="alternate" type="text/html" href="https://github.com${base}/tag/${t}"/><content>Notes ${t}</content></entry>`
        )
        .join('');
      res.writeHead(200, { 'content-type': 'application/atom+xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`);
    }
    if (url.pathname === `/api/v3/repos/hpmartini/Orkumo/releases/latest`) {
      // release.yml enforces rc tag <=> "Pre-release" flag, so the tag decides here
      const final = tags().find((t) => !semver.prerelease(t));
      if (!final) {
        res.writeHead(404);
        return res.end('{"message":"Not Found"}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tag_name: final }));
    }
    const m = url.pathname.startsWith(`${base}/download/`) && url.pathname.slice(`${base}/download/`.length);
    if (m) {
      const file = path.resolve(root, ...m.split('/').map(decodeURIComponent));
      if (file.startsWith(path.resolve(root)) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const size = fs.statSync(file).size;
        // multi-range (differential download) is answered with the full file; electron-updater then falls back
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Number(range[2]) : size - 1;
          res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'content-length': size });
        return fs.createReadStream(file).pipe(res);
      }
    }
    res.writeHead(404);
    res.end('not found');
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`fake github on ${port}`));
