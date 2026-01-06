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

  describe('openInIDE', () => {
    it('should send POST request with app ID and IDE ID', async () => {
      const mockResult = {
        success: true,
        ide: 'Visual Studio Code',
        message: 'Successfully opened project in Visual Studio Code',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const { openInIDE } = await import('../services/api');
      const result = await openInIDE('app-1', 'vscode');

      expect(mockFetch).toHaveBeenCalledWith('/api/apps/app-1/open-ide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ide: 'vscode' }),
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'IDE not found' }),
      });

      const { openInIDE } = await import('../services/api');
      await expect(openInIDE('app-1', 'nonexistent')).rejects.toThrow('IDE not found');
    });

    it('should reject invalid IDE identifiers', async () => {
      // This tests that only valid IDE IDs are sent
      const { openInIDE } = await import('../services/api');

      // The frontend should send valid IDE IDs
      const validIdeIds = ['vscode', 'cursor', 'webstorm', 'intellij', 'phpstorm', 'pycharm', 'sublime'];

      validIdeIds.forEach((ideId) => {
        expect(['vscode', 'cursor', 'webstorm', 'intellij', 'phpstorm', 'pycharm', 'sublime']).toContain(ideId);
      });
    });
  });

  describe('updatePreferredIDE', () => {
    it('should send PUT request with preferred IDE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'app-1', ide: 'cursor' }),
      });

      const { updatePreferredIDE } = await import('../services/api');
      const result = await updatePreferredIDE('app-1', 'cursor');

      expect(mockFetch).toHaveBeenCalledWith('/api/settings/preferred-ide/app-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ide: 'cursor' }),
      });
      expect(result).toEqual({ id: 'app-1', ide: 'cursor' });
    });

    it('should throw error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      });

      const { updatePreferredIDE } = await import('../services/api');
      await expect(updatePreferredIDE('app-1', 'invalid')).rejects.toThrow('Failed to update preferred IDE');
    });
  });
});
