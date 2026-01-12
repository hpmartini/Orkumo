import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative paths for Electron file:// protocol
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      // Proxy API requests to backend server
      '/api': {
        target: 'http://localhost:3099',
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
});
