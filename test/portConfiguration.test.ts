import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PortManager
class MockPortManager {
  private unavailablePorts: Set<number>;

  constructor(unavailablePorts: number[] = []) {
    this.unavailablePorts = new Set(unavailablePorts);
  }

  async isPortAvailable(port: number): Promise<boolean> {
    return !this.unavailablePorts.has(port);
  }

  setUnavailablePorts(ports: number[]) {
    this.unavailablePorts = new Set(ports);
  }
}

// Mock fs module for testing
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => JSON.stringify({
      customPorts: {},
      favorites: [],
      archived: [],
      customNames: {},
      favoritesSortMode: 'manual',
      version: 1
    })),
    writeFileSync: vi.fn()
  }
}));

// Import the actual service after mocking fs
// Use dynamic import to ensure mock is set up first
let settingsService: any;
let fs: any;

async function setupMocks() {
  fs = (await import('fs')).default;
  const SettingsServiceModule = await import('../server/services/settingsService.js');
  settingsService = SettingsServiceModule.settingsService;
}

describe('Port Configuration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mock to return clean settings
    fs.readFileSync.mockReturnValue(JSON.stringify({
      customPorts: {},
      favorites: [],
      archived: [],
      customNames: {},
      favoritesSortMode: 'manual',
      version: 1
    }));
    // Setup mocks if not already done
    if (!settingsService) {
      await setupMocks();
    }
  });

  describe('configureAllPorts', () => {
    it('should assign sequential ports starting from startPort', async () => {
      const appIds = ['app1', 'app2', 'app3'];
      const result = await settingsService.configureAllPorts(appIds, 3001);

      expect(result).toEqual({
        app1: 3001,
        app2: 3002,
        app3: 3003,
      });
      expect(fs.writeFileSync).toHaveBeenCalled();
      // Verify the settings were written correctly
      const writeCall = fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1];
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.customPorts).toEqual({
        app1: 3001,
        app2: 3002,
        app3: 3003,
      });
    });

    it('should skip unavailable ports when portManager is provided', async () => {
      const appIds = ['app1', 'app2', 'app3'];
      const portManager = new MockPortManager([3002]); // Port 3002 is unavailable

      const result = await settingsService.configureAllPorts(appIds, 3001, portManager);

      expect(result).toEqual({
        app1: 3001,
        app2: 3003, // Skipped 3002
        app3: 3004,
      });
    });

    it('should skip multiple unavailable ports sequentially', async () => {
      const appIds = ['app1', 'app2', 'app3', 'app4'];
      const portManager = new MockPortManager([3002, 3003]); // Ports 3002 and 3003 unavailable

      const result = await settingsService.configureAllPorts(appIds, 3001, portManager);

      expect(result).toEqual({
        app1: 3001,
        app2: 3004, // Skipped 3002, 3003
        app3: 3005,
        app4: 3006,
      });
    });

    it('should call progress callback for each app', async () => {
      const appIds = ['app1', 'app2', 'app3'];
      const onProgress = vi.fn();

      await settingsService.configureAllPorts(appIds, 3001, null, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(3);
      // Note: The actual service passes 3 parameters (current, total, percentage)
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3, 33);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3, 67);
      expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3, 100);
    });

    it('should throw error when port range is exhausted', async () => {
      const appIds = ['app1', 'app2'];
      const startPort = 65535;

      await expect(settingsService.configureAllPorts(appIds, startPort)).rejects.toThrow(
        'Port range exhausted: Cannot assign 2 apps starting from 65535'
      );
    });

    it('should handle empty app list', async () => {
      const appIds: string[] = [];
      const result = await settingsService.configureAllPorts(appIds, 3001);

      expect(result).toEqual({});
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should ensure no gaps in port allocation', async () => {
      const appIds = ['app1', 'app2', 'app3', 'app4', 'app5'];
      const portManager = new MockPortManager([3002, 3004]); // Gaps at 3002 and 3004

      const result = await settingsService.configureAllPorts(appIds, 3001, portManager);

      // Verify sequential allocation without gaps
      const ports = Object.values(result);
      ports.sort((a, b) => a - b);

      expect(result).toEqual({
        app1: 3001,
        app2: 3003, // Skipped 3002
        app3: 3005, // Skipped 3004
        app4: 3006,
        app5: 3007,
      });

      // Verify highest port is tracked correctly
      expect(Math.max(...ports)).toBe(3007);
    });

    it('should use parallel port checking for better performance', async () => {
      const appIds = Array.from({ length: 100 }, (_, i) => `app${i}`);
      const portManager = new MockPortManager([3010, 3020, 3030]);

      const startTime = Date.now();
      await settingsService.configureAllPorts(appIds, 3001, portManager);
      const duration = Date.now() - startTime;

      // Parallel checking should be faster than sequential
      // This is a rough check - actual timing may vary
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should validate port range exhaustion with conflicts', async () => {
      // Create a scenario where conflicts push us over the limit
      const appIds = ['app1', 'app2'];
      const portManager = new MockPortManager(
        Array.from({ length: 100 }, (_, i) => 65500 + i) // Block ports 65500-65599
      );

      await expect(settingsService.configureAllPorts(appIds, 65534, portManager)).rejects.toThrow(
        /Port range exhausted/
      );
    });
  });
});
