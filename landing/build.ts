// Production build of the landing page for GitHub Pages (served under /DevHub/).
/* global Bun */
import { rmSync } from 'node:fs';
import tailwind from 'bun-plugin-tailwind';

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
