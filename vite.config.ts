import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { PORTS } from './config/defaults.js';

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  // Port configuration from environment or defaults
  const VITE_PORT = parseInt(env.VITE_PORT || String(PORTS.devhub), 10);
  const SERVER_PORT = parseInt(env.SERVER_PORT || String(PORTS.server), 10);
  // Shown in Settings → Updates in the browser, which has no Electron app version to ask
  const APP_VERSION = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
  ).version;

  return {
    // Use relative paths for Electron file:// protocol
    base: './',
    server: {
      port: VITE_PORT,
      // Fail loudly instead of drifting to the next free port: Electron loads
      // VITE_PORT directly, so a silent fallback makes it load whatever other
      // project happens to own the configured port.
      strictPort: true,
      // Remote mode: the proxy calls the API from localhost and would skip the token, so stay off the LAN.
      host: env.DEVORBIT_REMOTE === 'true' ? '127.0.0.1' : '0.0.0.0',
      // UI preference writes (data/settings.json) must not full-reload the dev page
      watch: { ignored: ['**/data/**', '**/.playwright-mcp/**'] },
      proxy: {
        // Proxy API requests to backend server
        '/api': {
          target: `http://localhost:${SERVER_PORT}`,
          changeOrigin: true,
          ws: true, // Enable WebSocket proxying
        },
      },
    },
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Below es2021 esbuild lowers `r ||= {}` in xterm 6's pre-minified requestMode and drops the
      // `let r` (evanw/esbuild#4508): the first DECRQM query of a TUI (omp, opencode, vim) throws and
      // the terminal never renders again. Production-only, dev does not minify (xtermjs/xterm.js#5800).
      target: 'es2021',
    },
  };
});
