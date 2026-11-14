// Backend target (docs/MODULES.md, "Backend target"): read once at load, so every case imports the
// modules fresh (dynamic import after vi.resetModules) after preparing localStorage.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

const PEER = '/modules/mesh/peer/darkbook';
const KEY = 'orkumo.backend';

const load = async () => {
  vi.resetModules();
  return {
    target: await import('./backendTarget'),
    api: await import('./apiConfig'),
  };
};

let reload: Mock;

beforeEach(() => {
  localStorage.clear();
  reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('backendTarget', () => {
  it('is null without a stored backend', async () => {
    const { target, api } = await load();
    expect(target.getBackend()).toBeNull();
    expect(api.API_BASE_URL).toBe('/api');
    expect(api.getWsUrl('/api/pty')).toMatch(/^wss?:\/\/[^/]+\/api\/pty$/);
    expect(api.getSSEUrl('/api/agents/stream')).toBe('/api/agents/stream');
  });

  it('reads a valid stored backend and routes API, WebSocket and SSE through its prefix', async () => {
    localStorage.setItem(KEY, JSON.stringify({ prefix: PEER, label: 'darkbook' }));
    const { target, api } = await load();
    expect(target.getBackend()).toEqual({ prefix: PEER, label: 'darkbook' });
    expect(api.API_BASE_URL).toBe(`/api${PEER}`);
    expect(api.getWsUrl('/api/pty')).toMatch(new RegExp(`^wss?://[^/]+/api${PEER}/pty$`));
    expect(api.getWsUrl()).toMatch(new RegExp(`/api${PEER}/pty$`));
    // Agent target prefixes stay on top of it
    expect(api.getWsUrl('/api/modules/x/pty')).toMatch(new RegExp(`/api${PEER}/modules/x/pty$`));
    // Paths outside /api/ are left alone
    expect(api.getWsUrl('/other')).toMatch(/^wss?:\/\/[^/]+\/other$/);
    expect(api.getSSEUrl('/api/agents/stream')).toBe(`/api${PEER}/agents/stream`);
  });

  it.each([
    ['not JSON', '{'],
    ['host route', JSON.stringify({ prefix: '/agents', label: 'x' })],
    ['other origin', JSON.stringify({ prefix: 'http://evil/modules/a', label: 'x' })],
    ['traversal', JSON.stringify({ prefix: '/modules/../agents', label: 'x' })],
    ['upper-case module id', JSON.stringify({ prefix: '/modules/Mesh', label: 'x' })],
    ['empty label', JSON.stringify({ prefix: PEER, label: ' ' })],
    ['label too long', JSON.stringify({ prefix: PEER, label: 'x'.repeat(81) })],
    ['label not a string', JSON.stringify({ prefix: PEER, label: 3 })],
    ['null', 'null'],
  ])('drops an invalid stored backend (%s)', async (_, raw) => {
    localStorage.setItem(KEY, raw);
    const { target, api } = await load();
    expect(target.getBackend()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(api.API_BASE_URL).toBe('/api');
  });

  it('accepts a label of 80 characters', async () => {
    localStorage.setItem(KEY, JSON.stringify({ prefix: PEER, label: 'x'.repeat(80) }));
    const { target } = await load();
    expect(target.getBackend()?.label).toHaveLength(80);
  });

  it('connectBackend stores a valid backend and reloads', async () => {
    const { target } = await load();
    target.connectBackend(PEER, 'darkbook');
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      prefix: PEER,
      label: 'darkbook',
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('connectBackend ignores invalid input', async () => {
    const { target } = await load();
    target.connectBackend('/api/agents', 'x');
    target.connectBackend(PEER, '');
    target.connectBackend('/modules/mesh/peer/a b', 'x');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('disconnectBackend removes the backend and reloads', async () => {
    localStorage.setItem(KEY, JSON.stringify({ prefix: PEER, label: 'darkbook' }));
    const { target } = await load();
    target.disconnectBackend();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
