/**
 * DevOrbit Console/Network Logger
 *
 * This script captures console output and network requests and sends them
 * to the DevOrbit dashboard via postMessage.
 *
 * SAFETY FEATURES:
 * - Only runs when embedded in an iframe (not standalone)
 * - Only runs on localhost/127.0.0.1 (development)
 * - Gracefully handles errors without breaking the app
 * - Uses wildcard origin - no port dependency
 */
(function() {
  'use strict';

  // === SAFETY CHECKS ===

  // 1. Don't run if already injected
  if (window.__DEVORBIT_LOGGER__) return;

  // 2. Only run when embedded in an iframe (DevOrbit embeds apps in iframes)
  if (window.self === window.top) return;

  // 3. Only run in development (localhost)
  var hostname = window.location.hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return;

  // Mark as injected
  window.__DEVORBIT_LOGGER__ = true;

  // === CONFIGURATION ===

  // Use wildcard origin - works regardless of DevOrbit's port
  var targetOrigin = '*';

  // Store original methods
  var originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  // === UTILITIES ===

  /**
   * Safely serialize arguments for postMessage
   */
  function serializeArgs(args) {
    return Array.prototype.map.call(args, function(arg) {
      try {
        if (arg instanceof Error) {
          return {
            type: 'error',
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
          };
        } else if (arg === undefined) {
          return 'undefined';
        } else if (arg === null) {
          return 'null';
        } else if (typeof arg === 'function') {
          return '[Function: ' + (arg.name || 'anonymous') + ']';
        } else if (typeof arg === 'symbol') {
          return arg.toString();
        } else if (typeof arg === 'object') {
          // Handle circular references and non-serializable objects
          try {
            return JSON.stringify(arg, function(key, value) {
              if (typeof value === 'function') return '[Function]';
              if (typeof value === 'symbol') return value.toString();
              if (value instanceof Error) return { name: value.name, message: value.message };
              if (value instanceof HTMLElement) return '[HTMLElement: ' + value.tagName + ']';
              if (value instanceof Window) return '[Window]';
              return value;
            }, 2);
          } catch (e) {
            return '[Object: ' + Object.prototype.toString.call(arg) + ']';
          }
        } else {
          return String(arg);
        }
      } catch (e) {
        return '[Serialization Error]';
      }
    });
  }

  /**
   * Safely post message to parent
   */
  function postToParent(data) {
    try {
      window.parent.postMessage(data, targetOrigin);
    } catch (e) {
      // Silent fail - don't break the app
    }
  }

  // === CONSOLE INTERCEPTION ===

  ['log', 'warn', 'error', 'info', 'debug'].forEach(function(method) {
    console[method] = function() {
      // Send to DevOrbit
      postToParent({
        type: 'devorbit-console',
        method: method,
        args: serializeArgs(arguments),
        timestamp: Date.now(),
        url: window.location.href,
      });

      // Call original
      return originalConsole[method].apply(console, arguments);
    };
  });

  // === ERROR HANDLING ===

  window.addEventListener('error', function(event) {
    postToParent({
      type: 'devorbit-console',
      method: 'error',
      args: serializeArgs([event.error || event.message]),
      timestamp: Date.now(),
      url: window.location.href,
      uncaught: true,
      line: event.lineno,
      column: event.colno,
      filename: event.filename,
    });
  });

  window.addEventListener('unhandledrejection', function(event) {
    postToParent({
      type: 'devorbit-console',
      method: 'error',
      args: serializeArgs(['Unhandled Promise Rejection:', event.reason]),
      timestamp: Date.now(),
      url: window.location.href,
      uncaught: true,
    });
  });

  // === FETCH INTERCEPTION ===

  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init) {
      var startTime = Date.now();
      var method = (init && init.method) || 'GET';
      var url;

      try {
        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof Request) {
          url = input.url;
          method = input.method || method;
        } else {
          url = String(input);
        }
      } catch (e) {
        url = '[Unknown URL]';
      }

      return originalFetch.apply(this, arguments)
        .then(function(response) {
          postToParent({
            type: 'devorbit-network',
            method: method,
            url: url,
            status: response.status,
            statusText: response.statusText,
            duration: Date.now() - startTime,
            timestamp: startTime,
          });
          return response;
        })
        .catch(function(error) {
          postToParent({
            type: 'devorbit-network',
            method: method,
            url: url,
            error: error.message,
            duration: Date.now() - startTime,
            timestamp: startTime,
          });
          throw error;
        });
    };
  }

  // === XHR INTERCEPTION ===

  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._devorbit = {
      method: method,
      url: url,
      startTime: null,
    };
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    if (xhr._devorbit) {
      xhr._devorbit.startTime = Date.now();
    }

    var handleComplete = function() {
      if (xhr._devorbit) {
        postToParent({
          type: 'devorbit-network',
          method: xhr._devorbit.method,
          url: xhr._devorbit.url,
          status: xhr.status || 0,
          statusText: xhr.statusText || (xhr.status === 0 ? 'Network Error' : ''),
          duration: Date.now() - xhr._devorbit.startTime,
          timestamp: xhr._devorbit.startTime,
          error: xhr.status === 0 ? 'Network Error or CORS' : undefined,
        });
      }
    };

    xhr.addEventListener('load', handleComplete);
    xhr.addEventListener('error', handleComplete);
    xhr.addEventListener('abort', handleComplete);
    xhr.addEventListener('timeout', handleComplete);

    return originalXHRSend.apply(this, arguments);
  };

  // === INITIALIZATION COMPLETE ===

  // Log that DevOrbit logger is active (visible in DevOrbit console)
  console.log('[DevOrbit] Console/Network logging active');
})();
