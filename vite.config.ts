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

  return {
    // Use relative paths for Electron file:// protocol
    base: './',
    server: {
      port: VITE_PORT,
      // Fail loudly instead of drifting to the next free port: Electron loads
      // VITE_PORT directly, so a silent fallback makes it load whatever other
      // project happens to own the configured port.
      strictPort: true,
      host: '0.0.0.0',
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
