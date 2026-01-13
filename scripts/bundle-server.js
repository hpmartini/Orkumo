#!/usr/bin/env node
/**
 * Bundle the server with all its dependencies for Electron packaging.
 * Native modules (node-pty, pidusage) are kept external as they need
 * to be loaded from the unpacked asar.
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const outdir = path.resolve('dist-server');

// Ensure output directory exists
if (!existsSync(outdir)) {
  mkdirSync(outdir, { recursive: true });
}

async function bundle() {
  try {
    const result = await esbuild.build({
      entryPoints: ['server/index.js'],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: path.join(outdir, 'index.js'),
      // Only keep native modules external - they'll be loaded from app.asar.unpacked
      external: [
        'node-pty',
        'pidusage',
      ],
      // Better debugging
      sourcemap: true,
      // Minify for smaller size
      minify: true,
      // Keep names for better stack traces
      keepNames: true,
      // Handle __dirname/__filename in ESM
      define: {
        'import.meta.url': 'import.meta.url',
      },
      banner: {
        js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`.trim(),
      },
    });

    console.log('Server bundled successfully!');
    console.log(`Output: ${path.join(outdir, 'index.js')}`);

    if (result.warnings.length > 0) {
      console.log('Warnings:', result.warnings);
    }
  } catch (error) {
    console.error('Bundle failed:', error);
    process.exit(1);
  }
}

bundle();
