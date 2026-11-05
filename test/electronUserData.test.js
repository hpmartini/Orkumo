import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_USER_DATA_DIR } from '../electron/constants.js';

describe('Electron userData after the rename to Orkumo (#196)', () => {
  it('keeps the pre-rename folder name (package.json name of the old builds)', () => {
    expect(LEGACY_USER_DATA_DIR).toBe('devorbit-dashboard');
  });

  it('pins userData in main.js before the app starts', () => {
    const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
    const pin = main.indexOf("app.setPath('userData'");
    expect(pin).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(main.indexOf('requestSingleInstanceLock'));
    expect(pin).toBeLessThan(main.indexOf("app.getPath('userData')"));
  });
});
