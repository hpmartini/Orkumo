(function() {
  // Check if already injected
  if (window.__DEVORBIT_LOGGER__) return;
  window.__DEVORBIT_LOGGER__ = true;

  // Target origin for postMessage security
  const targetOrigin = window.location.origin;

  // Store original console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  // Serialize arguments (handle objects, arrays, errors)
  function serializeArgs(args) {
    return args.map(arg => {
      if (arg instanceof Error) {
        return {
          type: 'error',
          message: arg.message,
          stack: arg.stack,
        };
      } else if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return '[Circular or Non-Serializable Object]';
        }
      } else {
        return String(arg);
      }
    });
  }

  // Override console methods
  ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
    console[method] = function(...args) {
      // Send to parent via postMessage
      try {
        window.parent.postMessage({
          type: 'devorbit-console',
          method,
          args: serializeArgs(args),
          timestamp: Date.now(),
          url: window.location.href,
        }, targetOrigin);
      } catch (e) {
        // Silent fail if postMessage blocked
      }

      // Call original console method
      originalConsole[method].apply(console, args);
    };
  });

  // Capture unhandled errors
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

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    window.parent.postMessage({
      type: 'devorbit-console',
      method: 'error',
      args: serializeArgs([event.reason]),
      timestamp: Date.now(),
      url: window.location.href,
      uncaught: true,
    }, targetOrigin);
  });

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const startTime = Date.now();
    const url = typeof args[0] === 'string'
      ? args[0]
      : args[0] instanceof Request
        ? args[0].url
        : String(args[0]);

    return originalFetch.apply(this, args).then(response => {
      const duration = Date.now() - startTime;
      window.parent.postMessage({
        type: 'devorbit-network',
        method: 'fetch',
        url: url,
        status: response.status,
        duration,
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

  // Intercept XHR
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._devorbit = { method, url, startTime: Date.now() };
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    const logXHR = function() {
      if (this._devorbit) {
        window.parent.postMessage({
          type: 'devorbit-network',
          method: this._devorbit.method,
          url: this._devorbit.url,
          status: this.status || 0,
          error: this.status === 0 ? 'Network Error' : undefined,
          duration: Date.now() - this._devorbit.startTime,
          timestamp: this._devorbit.startTime,
        }, targetOrigin);
      }
    };

    this.addEventListener('load', logXHR);
    this.addEventListener('error', logXHR);
    this.addEventListener('abort', logXHR);
    this.addEventListener('timeout', logXHR);
    return originalXHRSend.apply(this, arguments);
  };

  console.log('[DevOrbit] Console logging initialized');
})();
