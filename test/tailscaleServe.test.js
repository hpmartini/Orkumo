// Pairing address from `tailscale serve status --json`: the share that relays to this server's port.
import { describe, it, expect } from 'vitest';
import { serveUrlFrom } from '../server/services/tailscale.js';

const status = {
  TCP: { 443: { HTTPS: true }, 3443: { HTTPS: true } },
  Web: {
    'mac.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } } },
    'mac.tail1.ts.net:3443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3099/s3cret' } } },
  },
};

describe('serveUrlFrom', () => {
  it('finds the share that proxies to this port, with its port', () => {
    expect(serveUrlFrom(status, 3099)).toBe('https://mac.tail1.ts.net:3443');
  });

  it('drops the default HTTPS port', () => {
    expect(serveUrlFrom(status, 8787)).toBe('https://mac.tail1.ts.net');
  });

  it('is null when no share points at this server', () => {
    expect(serveUrlFrom(status, 4000)).toBeNull();
    expect(serveUrlFrom({}, 3099)).toBeNull();
    expect(serveUrlFrom(null, 3099)).toBeNull();
  });
});
