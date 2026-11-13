// electron/rendererSecret.js: which requests main marks with the renderer secret (security review H1)
import { describe, it, expect } from 'vitest';
import { isRendererRequest, markRendererRequests } from '../electron/rendererSecret.js';

const TOP = { parent: null };
const SUB = { parent: TOP };
const ours = (id) => id === 1;
const req = (url, extra = {}) => ({ url, webContentsId: 1, frame: TOP, ...extra });

describe('isRendererRequest', () => {
  it('marks our windows’ top-frame requests to the local API, fetch and WebSocket', () => {
    for (const url of [
      'http://127.0.0.1:3099/api/config',
      'http://localhost:3099/api/agents',
      'ws://localhost:3099/api/pty?x=1',
    ])
      expect(isRendererRequest(req(url), 3099, ours)).toBe(true);
  });

  it('skips frames inside our windows, other webContents and other targets', () => {
    expect(isRendererRequest(req('http://127.0.0.1:3099/api', { frame: SUB }), 3099, ours)).toBe(
      false
    );
    expect(
      isRendererRequest(req('http://127.0.0.1:3099/api', { webContentsId: 7 }), 3099, ours)
    ).toBe(false);
    expect(
      isRendererRequest(req('http://127.0.0.1:3099/api', { webContentsId: undefined }), 3099, ours)
    ).toBe(false);
    expect(isRendererRequest(req('http://127.0.0.1:3000/api'), 3099, ours)).toBe(false);
    expect(isRendererRequest(req('https://evil.example:3099/api'), 3099, ours)).toBe(false);
    expect(isRendererRequest(req('file:///app/index.html'), 3099, ours)).toBe(false);
  });

  it('treats a frame that is gone as foreign', () => {
    const gone = {
      get parent() {
        throw new Error('Render frame was disposed');
      },
    };
    expect(isRendererRequest(req('http://127.0.0.1:3099/api', { frame: gone }), 3099, ours)).toBe(
      false
    );
  });
});

describe('markRendererRequests', () => {
  it('adds the header only to marked requests', () => {
    let listener;
    const ses = { webRequest: { onBeforeSendHeaders: (fn) => (listener = fn) } };
    markRendererRequests(ses, { secret: 's3cret', port: 3099, isTrustedContents: ours });
    const run = (details) => new Promise((resolve) => listener(details, resolve));

    return Promise.all([
      run({ ...req('http://127.0.0.1:3099/api'), requestHeaders: { Accept: '*/*' } }),
      run({ ...req('http://127.0.0.1:3099/api', { frame: SUB }), requestHeaders: {} }),
    ]).then(([marked, unmarked]) => {
      expect(marked.requestHeaders).toEqual({ Accept: '*/*', 'X-Orkumo-Renderer': 's3cret' });
      expect(unmarked).toEqual({});
    });
  });
});
