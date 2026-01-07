import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// We need to import the service after mocking
const { detectClaudeCLI } = await import('../server/services/ptyService.js');

describe('PTY Service - detectClaudeCLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Claude CLI Detection', () => {
    it('should detect Claude CLI when installed', async () => {
      // Mock successful 'which claude' call
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '/usr/local/bin/claude\n', ''), 0);
        } else if (cmd === 'claude --version') {
          setTimeout(() => callback(null, 'v1.2.3\n', ''), 0);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toEqual({
        installed: true,
        path: '/usr/local/bin/claude',
        version: 'v1.2.3',
      });
    });

    it('should return not installed when which command fails', async () => {
      // Mock failed 'which claude' call
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(new Error('Command not found'), '', 'not found'), 0);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toEqual({
        installed: false,
      });
    });

    it('should return unknown version when version command fails', async () => {
      // Mock successful 'which' but failed 'version'
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '/usr/local/bin/claude\n', ''), 0);
        } else if (cmd === 'claude --version') {
          setTimeout(() => callback(new Error('Version failed'), '', ''), 0);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toEqual({
        installed: true,
        path: '/usr/local/bin/claude',
        version: 'unknown',
      });
    });

    it('should timeout after 5 seconds', async () => {
      // Mock exec that never calls callback
      vi.mocked(exec).mockImplementation(() => {
        // Never call the callback to simulate hanging
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();

      // Advance time by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        installed: false,
        error: 'Detection timeout',
      });
    });

    it('should kill hanging processes on timeout', async () => {
      const killSpy = vi.fn();
      const mockProcess = { kill: killSpy };

      // Mock exec that returns a process object but never calls callback
      vi.mocked(exec).mockImplementation(() => {
        return mockProcess as any;
      });

      const resultPromise = detectClaudeCLI();

      // Advance time by 5 seconds to trigger timeout
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toEqual({
        installed: false,
        error: 'Detection timeout',
      });

      // Verify process was killed
      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    });

    it('should not resolve twice if timeout occurs during version check', async () => {
      const resolveSpy = vi.fn();

      // Mock 'which' succeeds immediately, but 'version' hangs
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '/usr/local/bin/claude\n', ''), 0);
        }
        // claude --version never calls callback (hangs)
        return {} as any;
      });

      const resultPromise = detectClaudeCLI().then((result) => {
        resolveSpy(result);
        return result;
      });

      // Fast-forward past the timeout
      await vi.advanceTimersByTimeAsync(5000);
      await resultPromise;

      // Should only resolve once
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith({
        installed: false,
        error: 'Detection timeout',
      });
    });

    it('should handle exec timeout option correctly', async () => {
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        // Verify timeout option is passed
        expect(options).toHaveProperty('timeout', 5000);

        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '/usr/local/bin/claude\n', ''), 0);
        } else if (cmd === 'claude --version') {
          setTimeout(() => callback(null, 'v1.0.0\n', ''), 0);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();
      await vi.runAllTimersAsync();
      await resultPromise;

      // Verify exec was called with timeout options
      expect(exec).toHaveBeenCalledWith(
        'which claude',
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        'claude --version',
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function)
      );
    });

    it('should clear timeout when detection succeeds', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '/usr/local/bin/claude\n', ''), 0);
        } else if (cmd === 'claude --version') {
          setTimeout(() => callback(null, 'v1.0.0\n', ''), 0);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();
      await vi.runAllTimersAsync();
      await resultPromise;

      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should trim whitespace from path and version', async () => {
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '  /usr/local/bin/claude  \n', ''), 0);
        } else if (cmd === 'claude --version') {
          setTimeout(() => callback(null, '  v1.2.3  \n', ''), 0);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.path).toBe('/usr/local/bin/claude');
      expect(result.version).toBe('v1.2.3');
    });
  });

  describe('Race Condition Prevention', () => {
    it('should not resolve if already resolved by timeout', async () => {
      const resolveCalls: any[] = [];

      // Mock hanging exec
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          // Simulate slow response that arrives after timeout
          setTimeout(() => {
            callback(null, '/usr/local/bin/claude\n', '');
          }, 6000);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI().then((result) => {
        resolveCalls.push(result);
        return result;
      });

      // Advance past timeout (5s)
      await vi.advanceTimersByTimeAsync(5000);

      // Advance past the delayed callback (6s total)
      await vi.advanceTimersByTimeAsync(1000);

      await resultPromise;

      // Should only have resolved once (via timeout)
      expect(resolveCalls).toHaveLength(1);
      expect(resolveCalls[0]).toEqual({
        installed: false,
        error: 'Detection timeout',
      });
    });

    it('should not resolve if version check arrives after timeout', async () => {
      const resolveCalls: any[] = [];

      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (cmd === 'which claude') {
          setTimeout(() => callback(null, '/usr/local/bin/claude\n', ''), 100);
        } else if (cmd === 'claude --version') {
          // Version check arrives after global timeout
          setTimeout(() => callback(null, 'v1.0.0\n', ''), 6000);
        }
        return {} as any;
      });

      const resultPromise = detectClaudeCLI().then((result) => {
        resolveCalls.push(result);
        return result;
      });

      // Advance to trigger 'which' success
      await vi.advanceTimersByTimeAsync(100);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5000);

      await resultPromise;

      // Should have timed out, not resolved with version
      expect(resolveCalls).toHaveLength(1);
      expect(resolveCalls[0]).toEqual({
        installed: false,
        error: 'Detection timeout',
      });
    });
  });
});
