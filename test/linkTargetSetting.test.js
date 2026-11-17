import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// SETTINGS_FILE is resolved at import time, so the data dir must be set first
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-link-target-'));
let settingsService;

beforeAll(async () => {
  vi.stubEnv('DEVORBIT_DATA_PATH', dataDir);
  vi.resetModules();
  ({ settingsService } = await import('../server/services/settingsService.js'));
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('linkTarget setting (#140)', () => {
  it('defaults to the built-in browser', () => {
    expect(settingsService.getSettings().linkTarget).toBe('builtin');
  });

  it('persists the choice in settings.json', () => {
    settingsService.setLinkTarget('system');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8'));
    expect(onDisk.linkTarget).toBe('system');
    expect(settingsService.getSettings().linkTarget).toBe('system');
  });

  it('click gestures default to Cmd/middle system, Shift side, Option split, and persist', () => {
    expect(settingsService.getSettings().linkKeys).toEqual({
      cmd: 'system',
      middle: 'system',
      shift: 'side',
      alt: 'builtin',
    });
    const keys = { cmd: 'builtin', middle: 'side', shift: 'system', alt: 'side' };
    settingsService.setLinkKeys(keys);
    expect(settingsService.getSettings().linkKeys).toEqual(keys);
  });
});
