/**
 * Renderer secret (security review H1). The packaged renderer runs on file://, so it calls the API
 * with Origin "null" (fetch) or "file://" (WebSocket), the same origin any sandboxed iframe in any
 * browser can claim. Main marks the requests of its own windows to the local API with a per-launch
 * secret the server (DEVORBIT_RENDERER_SECRET) checks; frames inside them and the built-in browser
 * (own partition, own session) never get it.
 */
import { randomBytes } from 'crypto';

export const RENDERER_SECRET_HEADER = 'X-Orkumo-Renderer';

export const createRendererSecret = () => randomBytes(32).toString('hex');

const API_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const isTopFrame = (frame) => {
  try {
    return frame.parent === null;
  } catch {
    return false; // frame already gone
  }
};

/** Request to the local API on `port` from a top frame of a webContents `isTrustedContents` accepts. */
export function isRendererRequest(details, port, isTrustedContents) {
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }
  if (!['http:', 'ws:'].includes(url.protocol)) return false;
  if (!API_HOSTS.has(url.hostname) || url.port !== String(port)) return false;
  if (details.webContentsId === undefined || !isTrustedContents(details.webContentsId))
    return false;
  return !details.frame || isTopFrame(details.frame);
}

/** Adds the secret header to the renderer's API requests in `ses` (one listener per session). */
export function markRendererRequests(ses, { secret, port, isTrustedContents }) {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!isRendererRequest(details, port, isTrustedContents)) return callback({});
    callback({ requestHeaders: { ...details.requestHeaders, [RENDERER_SECRET_HEADER]: secret } });
  });
}
