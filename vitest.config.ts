import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest keeps an inherited NODE_ENV (agent shells export `production`); React's prod build has no act()
process.env.NODE_ENV = 'test';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
    include: ['**/*.{test,spec}.{ts,tsx,js}'],
    // agents-ui ships extensionless ESM for bundlers: Vite resolves it, plain Node would not
    server: { deps: { inline: ['@hpmartini/agents-ui'] } },
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/'],
    },
  },
});
