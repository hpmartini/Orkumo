import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// SETTINGS_FILE is resolved at import time, so the data dir must be set first
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devorbit-link-target-'));
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
});
