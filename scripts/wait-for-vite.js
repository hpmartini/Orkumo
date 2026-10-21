#!/usr/bin/env node
/**
 * Wait for the Vite dev server before Electron loads it.
 *
 * The port has to be read from .env.local rather than hardcoded: Electron
 * resolves the same VITE_PORT, so waiting on a different port means waiting
 * on whatever other project happens to own it.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import waitOn from 'wait-on';
import { PORTS } from '../config/defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const port = parseInt(process.env.VITE_PORT || String(PORTS.devhub), 10);
const resource = `http-get://localhost:${port}`;

console.log(`[wait-for-vite] Waiting for Vite dev server at ${resource} ...`);

try {
  await waitOn({ resources: [resource], timeout: 60000, validateStatus: () => true });
  console.log(`[wait-for-vite] Vite dev server is up on port ${port}`);
} catch (error) {
  console.error(`[wait-for-vite] Vite dev server did not come up on port ${port}:`, error.message);
  process.exit(1);
}
