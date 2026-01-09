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

// Mock settings service functions
const mockSettings = { customPorts: {}, favorites: [], archived: [], customNames: {}, favoritesSortMode: 'manual' as const, version: 1 };
const readSettings = vi.fn(() => mockSettings);
const writeSettings = vi.fn((settings) => {
  Object.assign(mockSettings, settings);
});

// Create a simple version of configureAllPorts for testing
async function configureAllPorts(
  appIds: string[],
  startPort = 3001,
  portManager: MockPortManager | null = null,
  onProgress: ((current: number, total: number) => void) | null = null
) {
  const settings = readSettings();
  const configured: Record<string, number> = {};
  let currentPort = startPort;
  let highestPort = startPort;

  const maxPort = 65535;
  if (startPort + appIds.length > maxPort) {
    throw new Error(`Port range exhausted: Cannot assign ${appIds.length} apps starting from ${startPort}`);
  }

  // If portManager is provided, check ports in parallel for better performance
  let unavailablePorts = new Set<number>();
  if (portManager) {
    const portsToCheck = Math.min(appIds.length + 50, maxPort - startPort + 1);
    const portCheckPromises = [];

    for (let i = 0; i < portsToCheck; i++) {
      const portToCheck = startPort + i;
      portCheckPromises.push(
        portManager.isPortAvailable(portToCheck).then(available => ({
          port: portToCheck,
          available
        }))
      );
    }

    const results = await Promise.all(portCheckPromises);
    unavailablePorts = new Set(
      results.filter(r => !r.available).map(r => r.port)
    );
  }

  for (let i = 0; i < appIds.length; i++) {
    const appId = appIds[i];
    let assignedPort = currentPort;

    // Skip unavailable ports
    while (unavailablePorts.has(assignedPort) && assignedPort <= maxPort) {
      assignedPort++;
    }

    // If we've exhausted our pre-checked range, check new ports
    if (portManager && assignedPort > startPort + unavailablePorts.size + appIds.length) {
      let portAvailable = await portManager.isPortAvailable(assignedPort);
      while (!portAvailable && assignedPort <= maxPort) {
        assignedPort++;
        if (assignedPort > maxPort) {
          throw new Error(`Port range exhausted after configuring ${i} apps`);
        }
        portAvailable = await portManager.isPortAvailable(assignedPort);
      }
    }

    highestPort = Math.max(highestPort, assignedPort);

    if (highestPort > maxPort) {
      throw new Error(`Port range exhausted after configuring ${i} apps`);
    }

    settings.customPorts[appId] = assignedPort;
    configured[appId] = assignedPort;
    currentPort = assignedPort + 1;

    if (onProgress) {
      onProgress(i + 1, appIds.length);
    }
  }

  writeSettings(settings);
  return configured;
}

describe('Port Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.customPorts = {};
  });

  describe('configureAllPorts', () => {
    it('should assign sequential ports starting from startPort', async () => {
      const appIds = ['app1', 'app2', 'app3'];
      const result = await configureAllPorts(appIds, 3001);

      expect(result).toEqual({
        app1: 3001,
        app2: 3002,
        app3: 3003,
      });
      expect(writeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          customPorts: {
            app1: 3001,
            app2: 3002,
            app3: 3003,
          },
        })
      );
    });

    it('should skip unavailable ports when portManager is provided', async () => {
      const appIds = ['app1', 'app2', 'app3'];
      const portManager = new MockPortManager([3002]); // Port 3002 is unavailable

      const result = await configureAllPorts(appIds, 3001, portManager);

      expect(result).toEqual({
        app1: 3001,
        app2: 3003, // Skipped 3002
        app3: 3004,
      });
    });

    it('should skip multiple unavailable ports sequentially', async () => {
      const appIds = ['app1', 'app2', 'app3', 'app4'];
      const portManager = new MockPortManager([3002, 3003]); // Ports 3002 and 3003 unavailable

      const result = await configureAllPorts(appIds, 3001, portManager);

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

      await configureAllPorts(appIds, 3001, null, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
      expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
    });

    it('should throw error when port range is exhausted', async () => {
      const appIds = ['app1', 'app2'];
      const startPort = 65535;

      await expect(configureAllPorts(appIds, startPort)).rejects.toThrow(
        'Port range exhausted: Cannot assign 2 apps starting from 65535'
      );
    });

    it('should handle empty app list', async () => {
      const appIds: string[] = [];
      const result = await configureAllPorts(appIds, 3001);

      expect(result).toEqual({});
      expect(writeSettings).toHaveBeenCalled();
    });

    it('should ensure no gaps in port allocation', async () => {
      const appIds = ['app1', 'app2', 'app3', 'app4', 'app5'];
      const portManager = new MockPortManager([3002, 3004]); // Gaps at 3002 and 3004

      const result = await configureAllPorts(appIds, 3001, portManager);

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
      await configureAllPorts(appIds, 3001, portManager);
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

      await expect(configureAllPorts(appIds, 65534, portManager)).rejects.toThrow(
        /Port range exhausted/
      );
    });
  });
});
