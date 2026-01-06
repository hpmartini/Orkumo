import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';

// Mock dependencies
vi.mock('child_process');
vi.mock('fs');
vi.mock('os');

describe('IDEService', () => {
  let IDEService;
  let ideService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset modules to get fresh imports
    vi.resetModules();

    // Mock os.platform to return a consistent value
    os.platform.mockReturnValue('darwin');

    // Import the service after mocking
    const module = await import('../server/services/ideService.js');
    IDEService = module.default;
    ideService = module.ideService;
  });

  describe('detectInstalledIDEs', () => {
    it('should detect installed IDEs on macOS', async () => {
      // Mock fs.promises.access to simulate VS Code and Cursor installed
      fs.promises = {
        access: vi.fn((path) => {
          if (path.includes('Visual Studio Code') || path.includes('Cursor')) {
            return Promise.resolve();
          }
          return Promise.reject(new Error('Not found'));
        }),
      };

      const installed = await ideService.detectInstalledIDEs();

      expect(installed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'vscode',
            name: 'Visual Studio Code',
            path: expect.stringContaining('Visual Studio Code'),
          }),
          expect.objectContaining({
            id: 'cursor',
            name: 'Cursor',
            path: expect.stringContaining('Cursor'),
          }),
        ])
      );
    });

    it('should return empty array when no IDEs are installed', async () => {
      fs.promises = {
        access: vi.fn(() => Promise.reject(new Error('Not found'))),
      };

      const installed = await ideService.detectInstalledIDEs();

      expect(installed).toEqual([]);
    });

    it('should check multiple paths on Linux', async () => {
      os.platform.mockReturnValue('linux');

      // Create a new service instance for Linux
      const linuxService = new IDEService();

      fs.promises = {
        access: vi.fn((path) => {
          // Only the snap path exists
          if (path === '/snap/bin/code') {
            return Promise.resolve();
          }
          return Promise.reject(new Error('Not found'));
        }),
      };

      const installed = await linuxService.detectInstalledIDEs();

      expect(installed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'vscode',
            name: 'Visual Studio Code',
            path: '/snap/bin/code',
          }),
        ])
      );
    });
  });

  describe('openInIDE', () => {
    beforeEach(() => {
      fs.promises = {
        access: vi.fn(() => Promise.resolve()),
      };
    });

    it('should open project in IDE on macOS', async () => {
      const mockChild = {
        on: vi.fn(),
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      const promise = ideService.openInIDE('/path/to/project', 'vscode');

      // Wait a bit for the timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith('open', [
        '-a',
        '/Applications/Visual Studio Code.app',
        '/path/to/project',
      ], {
        detached: true,
        stdio: 'ignore',
      });
      expect(result).toEqual({
        success: true,
        ide: 'Visual Studio Code',
        message: 'Successfully opened project in Visual Studio Code',
      });
    });

    it('should open project in IDE on Linux', async () => {
      os.platform.mockReturnValue('linux');
      const linuxService = new IDEService();

      fs.promises = {
        access: vi.fn(() => Promise.resolve()),
      };

      const mockChild = {
        on: vi.fn(),
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      const promise = linuxService.openInIDE('/path/to/project', 'vscode');

      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith('/usr/bin/code', ['/path/to/project'], {
        detached: true,
        stdio: 'ignore',
      });
      expect(result.success).toBe(true);
    });

    it('should open project in IDE on Windows without shell injection', async () => {
      os.platform.mockReturnValue('win32');
      const winService = new IDEService();

      fs.promises = {
        access: vi.fn(() => Promise.resolve()),
      };

      const mockChild = {
        on: vi.fn(),
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      const promise = winService.openInIDE('/path/to/project', 'vscode');

      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await promise;

      // Verify spawn is called with the IDE executable directly (no cmd.exe)
      expect(spawn).toHaveBeenCalledWith(
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        ['/path/to/project'],
        {
          detached: true,
          stdio: 'ignore',
        }
      );
      expect(result.success).toBe(true);
    });

    it('should reject when IDE is not installed', async () => {
      fs.promises = {
        access: vi.fn((path) => {
          if (path.includes('Visual Studio Code')) {
            return Promise.reject(new Error('Not found'));
          }
          return Promise.resolve();
        }),
      };

      await expect(ideService.openInIDE('/path/to/project', 'vscode')).rejects.toThrow(
        "IDE 'Visual Studio Code' is not installed"
      );
    });

    it('should reject when project path does not exist', async () => {
      fs.promises = {
        access: vi.fn((path) => {
          if (path === '/nonexistent/path') {
            return Promise.reject(new Error('Not found'));
          }
          return Promise.resolve();
        }),
      };

      await expect(ideService.openInIDE('/nonexistent/path', 'vscode')).rejects.toThrow(
        'Project directory does not exist: /nonexistent/path'
      );
    });

    it('should reject when IDE is not supported on platform', async () => {
      await expect(ideService.openInIDE('/path/to/project', 'unsupported-ide')).rejects.toThrow(
        "IDE 'unsupported-ide' is not supported on darwin"
      );
    });

    it('should handle spawn errors', async () => {
      fs.promises = {
        access: vi.fn(() => Promise.resolve()),
      };

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Failed to spawn'));
          }
        }),
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      await expect(ideService.openInIDE('/path/to/project', 'vscode')).rejects.toThrow(
        'Failed to launch IDE: Failed to spawn'
      );
    });
  });

  describe('Security', () => {
    it('should not allow command injection through project path', async () => {
      fs.promises = {
        access: vi.fn(() => Promise.resolve()),
      };

      const mockChild = {
        on: vi.fn(),
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      const maliciousPath = '/path/to/project; rm -rf /';
      const promise = ideService.openInIDE(maliciousPath, 'vscode');

      await new Promise((resolve) => setTimeout(resolve, 150));

      await promise;

      // Verify that spawn is called with arguments array (no shell interpretation)
      expect(spawn).toHaveBeenCalledWith('open', [
        '-a',
        '/Applications/Visual Studio Code.app',
        maliciousPath, // Passed as-is in args array, not interpreted by shell
      ], expect.any(Object));
    });

    it('should not allow command injection on Windows', async () => {
      os.platform.mockReturnValue('win32');
      const winService = new IDEService();

      fs.promises = {
        access: vi.fn(() => Promise.resolve()),
      };

      const mockChild = {
        on: vi.fn(),
        unref: vi.fn(),
      };
      spawn.mockReturnValue(mockChild);

      const maliciousPath = 'C:\\project & calc.exe';
      const promise = winService.openInIDE(maliciousPath, 'vscode');

      await new Promise((resolve) => setTimeout(resolve, 150));

      await promise;

      // Verify spawn is called without cmd.exe (direct execution)
      expect(spawn).toHaveBeenCalledWith(
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        [maliciousPath],
        expect.any(Object)
      );
    });
  });
});
