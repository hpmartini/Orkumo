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
          detectedFramework: 'React',
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
        detectedFramework: 'React',
      });
    });

    it('should throw error when response is not ok', async () => {
      // 4xx is returned without retry; 5xx would go through the 1s/2s/4s backoff
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { fetchApps } = await import('../services/api');
      await expect(fetchApps()).rejects.toThrow('Failed to fetch apps');
    });
  });
});

describe('IDE API', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('fetchInstalledIDEs', () => {
    it('should fetch list of installed IDEs', async () => {
      const mockIDEs = [
        { id: 'vscode', name: 'Visual Studio Code', path: '/usr/bin/code' },
        { id: 'cursor', name: 'Cursor', path: '/usr/bin/cursor' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ides: mockIDEs }),
      });

      const { fetchInstalledIDEs } = await import('../services/api');
      const ides = await fetchInstalledIDEs();

      expect(mockFetch).toHaveBeenCalledWith('/api/ides/installed');
      expect(ides).toEqual(mockIDEs);
    });

    it('should return empty array when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      const { fetchInstalledIDEs } = await import('../services/api');
      const result = await fetchInstalledIDEs();
      expect(result).toEqual([]);
    });
  });
});
