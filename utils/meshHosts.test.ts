import { describe, it, expect } from 'vitest';
import * as ts from './meshHosts';
// @ts-expect-error - plain JS mirror without type declarations
import * as js from '../server/services/meshHosts.js';

/** Trimmed `tailscale status --json` of a real tailnet */
const STATUS = {
  Version: '1.90.0',
  BackendState: 'Running',
  Self: {
    HostName: 'Desktop',
    DNSName: 'desktop.tail1234.ts.net.',
    OS: 'macOS',
    Online: true,
    TailscaleIPs: ['100.64.0.10', 'fd7a:115c:a1e0::783a:a764'],
  },
  Peer: {
    'nodekey:1': {
      HostName: 'Peer-B',
      DNSName: 'peer-b.tail1234.ts.net.',
      OS: 'linux',
      Online: false,
      TailscaleIPs: ['100.64.0.14'],
    },
    'nodekey:2': {
      HostName: 'localhost',
      DNSName: 'iphone-15-pro-max.tail1234.ts.net.',
      OS: 'iOS',
      Online: true,
      TailscaleIPs: ['100.64.0.15'],
    },
    'nodekey:3': {
      HostName: 'peer-a',
      DNSName: 'peer-a.tail1234.ts.net.',
      OS: 'linux',
      Online: true,
      TailscaleIPs: ['100.64.0.13'],
    },
    'nodekey:4': {
      HostName: 'OnePlus 15',
      DNSName: 'oneplus-15.tail1234.ts.net.',
      OS: 'android',
      Online: true,
      TailscaleIPs: ['100.64.0.11'],
    },
    'nodekey:5': {
      HostName: 'Laptop',
      DNSName: 'laptop.tail1234.ts.net.',
      OS: 'macOS',
      Online: true,
      TailscaleIPs: ['100.64.0.12'],
    },
    'nodekey:6': {
      HostName: 'evil',
      DNSName: '-oProxyCommand=sh.ts.net.',
      OS: 'linux',
      Online: true,
      TailscaleIPs: [],
    },
  },
};

const PEER-A = 'peer-a.tail1234.ts.net';
const OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];

describe.each([
  ['utils/meshHosts.ts', ts],
  ['server/services/meshHosts.js', js as typeof ts],
])('%s', (_label, mesh) => {
  const devices = mesh.parseTailscaleStatus(STATUS);

  describe('parseTailscaleStatus', () => {
    it('keeps macOS/linux peers, drops Self, iOS, Android and malformed hosts', () => {
      expect(devices).toEqual([
        { host: 'laptop.tail1234.ts.net', name: 'Laptop', os: 'macOS', online: true },
        { host: 'peer-b.tail1234.ts.net', name: 'Peer-B', os: 'linux', online: false },
        { host: PEER-A, name: 'peer-a', os: 'linux', online: true },
      ]);
    });

    it('falls back to the Tailscale IP without MagicDNS and survives a logged-out status', () => {
      expect(
        mesh.parseTailscaleStatus({
          Peer: { a: { HostName: 'box', OS: 'linux', Online: true, TailscaleIPs: ['100.1.2.3'] } },
        })
      ).toEqual([{ host: '100.1.2.3', name: 'box', os: 'linux', online: true }]);
      expect(mesh.parseTailscaleStatus({ BackendState: 'NeedsLogin' })).toEqual([]);
      expect(mesh.parseTailscaleStatus(null)).toEqual([]);
    });
  });

  describe('isKnownHost', () => {
    it('accepts an online device of the list', () => {
      expect(mesh.isKnownHost(PEER-A, devices)).toBe(true);
    });

    it('rejects shell metacharacters, option injection and foreign or offline hosts', () => {
      expect(mesh.isKnownHost(`${PEER-A};rm -rf ~`, devices)).toBe(false);
      expect(mesh.isKnownHost('$(id).ts.net', devices)).toBe(false);
      expect(mesh.isKnownHost('-oProxyCommand=sh', devices)).toBe(false);
      expect(mesh.isKnownHost('example.com', devices)).toBe(false);
      expect(mesh.isKnownHost('peer-b.tail1234.ts.net', devices)).toBe(false);
      expect(mesh.isKnownHost(undefined, devices)).toBe(false);
    });
  });

  describe('isSessionId', () => {
    it('accepts background and interactive ids, rejects hostile ones', () => {
      expect(mesh.isSessionId('a1b2c3d4')).toBe(true);
      expect(mesh.isSessionId('interactive-4242')).toBe(true);
      expect(mesh.isSessionId('-oProxyCommand=sh')).toBe(false);
      expect(mesh.isSessionId('abc;id')).toBe(false);
      expect(mesh.isSessionId('interactive-undefined x')).toBe(false);
      expect(mesh.isSessionId(42)).toBe(false);
    });
  });

  describe('ssh args', () => {
    it('lists with BatchMode, ConnectTimeout and one fixed remote command', () => {
      expect(mesh.buildSshListArgs(PEER-A)).toEqual([
        '-n',
        ...OPTS,
        PEER-A,
        'claude agents --json',
      ]);
    });

    it('builds logs and attach for a session id', () => {
      expect(mesh.buildSshLogsArgs(PEER-A, 'af3c86d0')).toEqual([
        '-n',
        ...OPTS,
        PEER-A,
        'claude logs af3c86d0',
      ]);
      expect(mesh.buildSshAttachArgs(PEER-A, 'af3c86d0')).toEqual([
        '-t',
        ...OPTS,
        PEER-A,
        'claude attach af3c86d0',
      ]);
    });

    it('refuses invalid hosts and session ids instead of building a command', () => {
      expect(() => mesh.buildSshListArgs('-oProxyCommand=sh')).toThrow('Invalid host');
      expect(() => mesh.buildSshLogsArgs(PEER-A, 'a;reboot')).toThrow('Invalid session id');
      expect(() => mesh.buildSshAttachArgs(PEER-A, '$(id)')).toThrow('Invalid session id');
    });
  });

  describe('isAttachArgs (PTY allowlist)', () => {
    const attach = ['-t', ...OPTS, PEER-A, 'claude attach af3c86d0'];

    it('accepts exactly the built attach args of a known host', () => {
      expect(mesh.isAttachArgs(attach, devices)).toBe(true);
    });

    it('rejects extra options, other commands, foreign hosts and bad ids', () => {
      expect(mesh.isAttachArgs(['-oProxyCommand=sh', ...attach], devices)).toBe(false);
      expect(
        mesh.isAttachArgs([...attach.slice(0, -1), 'claude attach a; rm -rf ~'], devices)
      ).toBe(false);
      expect(mesh.isAttachArgs([...attach.slice(0, -1), 'bash'], devices)).toBe(false);
      expect(
        mesh.isAttachArgs(['-t', ...OPTS, 'example.com', 'claude attach af3c86d0'], devices)
      ).toBe(false);
      expect(mesh.isAttachArgs([], devices)).toBe(false);
      expect(mesh.isAttachArgs('nope', devices)).toBe(false);
    });
  });

  describe('classifySshFailure', () => {
    it('maps ssh and remote errors to device states', () => {
      expect(
        mesh.classifySshFailure(255, 'user@peer-a: Permission denied (publickey,password).\n')
      ).toEqual({
        state: 'ssh-denied',
        reason: 'user@peer-a: Permission denied (publickey,password).',
      });
      expect(mesh.classifySshFailure(255, 'Host key verification failed.').state).toBe(
        'ssh-denied'
      );
      expect(
        mesh.classifySshFailure(255, 'ssh: connect to host x port 22: Operation timed out').state
      ).toBe('offline');
      expect(mesh.classifySshFailure(null, '', true)).toEqual({
        state: 'offline',
        reason: 'timed out',
      });
      expect(mesh.classifySshFailure(127, 'zsh:1: command not found: claude').state).toBe(
        'claude-missing'
      );
      expect(mesh.classifySshFailure(1, 'boom')).toEqual({ state: 'error', reason: 'boom' });
    });
  });
});
