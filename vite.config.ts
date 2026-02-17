import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  // Port configuration from environment or defaults
  const VITE_PORT = parseInt(env.VITE_PORT || '3000', 10);
  const SERVER_PORT = parseInt(env.SERVER_PORT || '3001', 10);

  return {
    // Use relative paths for Electron file:// protocol
    base: './',
    server: {
      port: VITE_PORT,
      host: '0.0.0.0',
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
