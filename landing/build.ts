// Production build of the landing page for GitHub Pages (served under /DevHub/).
/* global Bun */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import tailwind from 'bun-plugin-tailwind';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Page } from './Page';

rmSync('dist-landing', { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ['landing/index.html'],
  outdir: 'dist-landing',
  publicPath: process.env.LANDING_BASE ?? '/DevHub/',
  plugins: [tailwind],
  minify: true,
  // fonts as separate files; inlined they would block the first paint
  loader: { '.woff2': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const out of result.outputs)
  // eslint-disable-next-line no-console -- CLI output
  console.log(out.kind.padEnd(10), out.path.replace(process.cwd() + '/', ''));

// Prerender the page into #root so text paints before the bundle runs; main.tsx hydrates it.
// At runtime Bun resolves image imports to local file paths: swap them for the hashed URLs.
const publicPath = process.env.LANDING_BASE ?? '/DevHub/';
const hashed = new Map(
  result.outputs
    .filter((o) => o.kind === 'asset')
    .map((o) => {
      const file = basename(o.path);
      return [file.replace(/-[a-z0-9]{8}(\.\w+)$/, '$1'), publicPath + file];
    })
);
const markup = renderToString(createElement(Page)).replace(/src="([^"]+)"/g, (whole, src) => {
  const url = hashed.get(basename(src));
  if (src.startsWith('/') && !src.startsWith(publicPath) && !url)
    throw new Error(`no asset for ${src}`);
  return url ? `src="${url}"` : whole;
});
const htmlFile = 'dist-landing/index.html';
const html = readFileSync(htmlFile, 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('#root not found in index.html');
writeFileSync(htmlFile, html.replace('<div id="root"></div>', `<div id="root">${markup}</div>`));
// eslint-disable-next-line no-console -- CLI output
console.log('prerender ', htmlFile, `${markup.length} chars`);
