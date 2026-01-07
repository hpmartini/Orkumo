/**
 * DevOrbit Vite Plugin
 *
 * Add this to your vite.config.ts to enable console/network capture in DevOrbit:
 *
 * import { devorbitPlugin } from './node_modules/devorbit-vite-plugin.js';
 * // or copy this file to your project
 *
 * export default defineConfig({
 *   plugins: [devorbitPlugin(), react()],
 * });
 */

export function devorbitPlugin() {
  return {
    name: 'devorbit-logger',
    transformIndexHtml(html) {
      // Only inject in development
      if (process.env.NODE_ENV === 'production') return html;

      const script = `
<script>
(function() {
  if (window.__DEVORBIT_LOGGER__) return;
  window.__DEVORBIT_LOGGER__ = true;
  const targetOrigin = '*';
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };
  function serializeArgs(args) {
    return args.map(arg => {
      if (arg instanceof Error) {
        return { type: 'error', message: arg.message, stack: arg.stack };
      } else if (typeof arg === 'object' && arg !== null) {
        try { return JSON.stringify(arg, null, 2); }
        catch (e) { return '[Circular]'; }
      }
      return String(arg);
    });
  }
  ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
    console[method] = function(...args) {
      try {
        window.parent.postMessage({
          type: 'devorbit-console',
          method,
          args: serializeArgs(args),
          timestamp: Date.now(),
          url: window.location.href,
        }, targetOrigin);
      } catch (e) {}
      originalConsole[method].apply(console, args);
    };
  });
  window.addEventListener('error', (event) => {
    window.parent.postMessage({
      type: 'devorbit-console',
      method: 'error',
      args: serializeArgs([event.error || event.message]),
      timestamp: Date.now(),
      url: window.location.href,
      uncaught: true,
    }, targetOrigin);
  });
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const startTime = Date.now();
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
    return originalFetch.apply(this, args).then(response => {
      window.parent.postMessage({
        type: 'devorbit-network',
        method: 'fetch',
        url: url,
        status: response.status,
        duration: Date.now() - startTime,
        timestamp: startTime,
      }, targetOrigin);
      return response;
    }).catch(error => {
      window.parent.postMessage({
        type: 'devorbit-network',
        method: 'fetch',
        url: url,
        error: error.message,
        timestamp: startTime,
      }, targetOrigin);
      throw error;
    });
  };
})();
</script>`;
      return html.replace('<head>', '<head>' + script);
    },
  };
}
