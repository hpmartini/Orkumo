import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// node-pty is a native module - keep it out of the unit test (agentService imports it)
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const HOST = 'laptop.tail1234.ts.net';
const ATTACH = [
  '-t',
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=5',
  '-o',
  'ForwardAgent=no',
  '-o',
  'ClearAllForwardings=yes',
  HOST,
  'claude attach af3c86d0',
];
const STATUS = {
  Self: { HostName: 'Desktop', OS: 'macOS' },
  Peer: { a: { HostName: 'Laptop', DNSName: `${HOST}.`, OS: 'macOS', Online: true } },
};

// A fake `tailscale` first in PATH prints status.json, or fails when it is missing
let dir;
let oldPath;
const setStatus = (status) =>
  status
    ? fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status))
    : fs.rmSync(path.join(dir, 'status.json'), { force: true });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-'));
  const bin = path.join(dir, 'tailscale');
  fs.writeFileSync(bin, `#!/bin/sh\ncat "${dir}/status.json" || exit 1\n`);
  fs.chmodSync(bin, 0o755);
  oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  vi.resetModules();
});

afterEach(() => {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('meshService host allowlist', () => {
  it('fills the allowlist on a cold start without a device list', async () => {
    setStatus(STATUS);
    const mesh = await import('../server/services/meshService.js');
    expect(mesh.isRemoteAttachArgs(ATTACH)).toBe(false);
    await mesh.ensureDevices();
    expect(mesh.isRemoteAttachArgs(ATTACH)).toBe(true);
    expect(mesh.isKnownRemoteHost(HOST)).toBe(true);
  });

  it('empties the allowlist when tailscale status fails', async () => {
    setStatus(STATUS);
    const mesh = await import('../server/services/meshService.js');
    await mesh.ensureDevices();
    setStatus(null);
    const result = await mesh.listRemote();
    expect(result.error).toBeTruthy();
    expect(mesh.isRemoteAttachArgs(ATTACH)).toBe(false);
  });
});
