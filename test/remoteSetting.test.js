import { describe, it, expect, afterEach } from 'vitest';
import * as remoteAccess from '../server/services/remoteAccess.js';

// Admin setting "Remote-/Cluster-Zugang": turns remote access on at boot like DEVORBIT_REMOTE=true
afterEach(() => delete process.env.DEVORBIT_REMOTE);

describe('applyRemoteSetting', () => {
  it('saved on, no env: remote access is on, not forced by env', () => {
    remoteAccess.applyRemoteSetting(true);
    expect(remoteAccess.isRemoteEnabled()).toBe(true);
    expect(remoteAccess.remoteEnv()).toBe(null);
  });

  it('saved off, no env: stays off', () => {
    remoteAccess.applyRemoteSetting(false);
    expect(remoteAccess.isRemoteEnabled()).toBe(false);
  });

  it('an explicit env wins over the setting, both ways', () => {
    process.env.DEVORBIT_REMOTE = 'false';
    remoteAccess.applyRemoteSetting(true);
    expect(remoteAccess.isRemoteEnabled()).toBe(false);
    expect(remoteAccess.remoteEnv()).toBe('false');
    process.env.DEVORBIT_REMOTE = 'true';
    remoteAccess.applyRemoteSetting(false);
    expect(remoteAccess.isRemoteEnabled()).toBe(true);
    expect(remoteAccess.remoteEnv()).toBe('true');
  });
});
