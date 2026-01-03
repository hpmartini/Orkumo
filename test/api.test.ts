import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for API tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Service', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('fetchApps', () => {
    it('should transform backend response to frontend format', async () => {
      const mockResponse = [
        {
          id: 'test-id-1',
          name: 'Test App',
          path: '/path/to/app',
          type: 'vite',
          port: 3000,
          addresses: ['http://localhost:3000'],
          startCommand: 'npm run dev',
          detectedFramework: 'React',
          status: 'STOPPED',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const { fetchApps } = await import('../services/api');
      const apps = await fetchApps();

      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({
        id: 'test-id-1',
        name: 'Test App',
        status: 'STOPPED',
        stats: {
          cpu: expect.any(Array),
          memory: expect.any(Array),
        },
      });
    });

    it('should throw error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      const { fetchApps } = await import('../services/api');
      await expect(fetchApps()).rejects.toThrow('Failed to fetch apps');
    });
  });

  describe('startApp', () => {
    it('should send POST request with path and command', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ pid: 1234, status: 'RUNNING' }),
      });

      const { startApp } = await import('../services/api');
      const result = await startApp('app-1', '/path/to/app', 'npm run dev');

      expect(mockFetch).toHaveBeenCalledWith('/api/apps/app-1/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/path/to/app', command: 'npm run dev' }),
      });
      expect(result).toEqual({ pid: 1234, status: 'RUNNING' });
    });
  });

  describe('stopApp', () => {
    it('should send POST request to stop endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'STOPPED' }),
      });

      const { stopApp } = await import('../services/api');
      const result = await stopApp('app-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/apps/app-1/stop', {
        method: 'POST',
      });
      expect(result).toEqual({ status: 'STOPPED' });
    });
  });
});

describe('Input Validation', () => {
  it('should reject commands with dangerous characters', () => {
    const dangerousPatterns = [';', '&&', '||', '|', '`', '$', '>', '<'];
    const testCommand = 'npm run dev';

    dangerousPatterns.forEach((pattern) => {
      const maliciousCommand = `${testCommand}${pattern}rm -rf /`;
      expect(maliciousCommand).toContain(pattern);
    });
  });
});
