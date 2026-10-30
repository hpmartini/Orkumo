import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Box, Terminal, Globe, Play, Square, FileText } from 'lucide-react';
import { AppStatus } from '../../types';
import { API_BASE_URL } from '../../utils/apiConfig';
import { TIMEOUTS } from '../../config/defaults';

// ============================================================================
// Module-level state for code-server coordination across multiple WebIDEPanel instances
// ============================================================================
// Problem: When multiple tabs are open, each WebIDEPanel independently tries to
// check/start code-server, causing race conditions and cascading failures.
// Solution: Use a shared promise so all panels wait for the same operation.

interface CodeServerResult {
  success: boolean;
  url?: string;
  error?: string;
  installed?: boolean;
}

// The shared promise that all panels wait on
let codeServerPromise: Promise<CodeServerResult> | null = null;

// Track when code-server was last confirmed ready (prevents unnecessary restarts)
let lastCodeServerReadyTime = 0;

// Minimum time between restart attempts (prevents cascade restarts from multiple panels)
const MIN_RESTART_INTERVAL_MS = TIMEOUTS.ideRestartInterval;

// Subscribers to be notified when code-server status changes
type StatusCallback = (status: string) => void;
const statusSubscribers = new Set<StatusCallback>();

const notifyStatusChange = (status: string) => {
  statusSubscribers.forEach((cb) => cb(status));
};

// Shared function to ensure code-server is running (called by all panels)
const ensureCodeServerRunning = async (
  apiBaseUrl: string,
  _iframeTimeout: number // Kept for API compatibility but not used directly
): Promise<CodeServerResult> => {
  // If an operation is already in progress, return the same promise
  if (codeServerPromise) {
    console.log('[CodeServerManager] Operation in progress, waiting for existing promise');
    return codeServerPromise;
  }

  // Start new operation
  codeServerPromise = (async (): Promise<CodeServerResult> => {
    const maxRetries = 2;

    const checkAndStart = async (retryCount = 0): Promise<CodeServerResult> => {
      try {
        console.log('[CodeServerManager] Checking code-server status...');
        notifyStatusChange('Checking if VS Code Server is installed...');

        const statusRes = await fetch(`${apiBaseUrl}/code-server/status`);
        if (!statusRes.ok) {
          throw new Error(`Backend returned ${statusRes.status}: ${statusRes.statusText}`);
        }

        const status = await statusRes.json();
        console.log('[CodeServerManager] code-server status:', status);

        // Check if installed
        if (!status.installed) {
          return {
            success: false,
            installed: false,
            error:
              `VS Code Server (code-server) is not installed.\n\n` +
              `To install it, run one of these commands in your terminal:\n\n` +
              `macOS (Homebrew):\n  brew install code-server\n\n` +
              `npm (any platform):\n  npm install -g code-server\n\n` +
              `After installation, click "Retry".`,
          };
        }

        // If already running, add warmup delay
        if (status.running) {
          console.log('[CodeServerManager] code-server already running, warming up...');
          notifyStatusChange('VS Code Server is running. Warming up...');

          const WARMUP_DELAY_MS = 2000;
          await new Promise((resolve) => setTimeout(resolve, WARMUP_DELAY_MS));

          notifyStatusChange('Loading editor...');
          lastCodeServerReadyTime = Date.now();
          return { success: true, url: 'http://127.0.0.1:8080' };
        }

        // Not running - start it
        notifyStatusChange('Starting VS Code Server...');
        console.log('[CodeServerManager] Starting code-server...');

        const startRes = await fetch(`${apiBaseUrl}/code-server/start`, { method: 'POST' });
        const startResult = await startRes.json();

        if (startResult.success) {
          console.log('[CodeServerManager] code-server started, warming up...');
          notifyStatusChange('VS Code Server started. Warming up...');

          const STARTUP_WARMUP_DELAY_MS = TIMEOUTS.ideWarmupDelay;
          await new Promise((resolve) => setTimeout(resolve, STARTUP_WARMUP_DELAY_MS));

          notifyStatusChange('Loading editor...');
          lastCodeServerReadyTime = Date.now();
          return { success: true, url: 'http://127.0.0.1:8080' };
        } else {
          // Start failed - try restart if we have retries left
          if (retryCount < maxRetries) {
            console.log('[CodeServerManager] Start failed, attempting restart...');
            notifyStatusChange('Start failed. Attempting restart...');
            return restartAndRetry(retryCount + 1);
          }
          return {
            success: false,
            error:
              `Failed to start VS Code Server: ${startResult.error}\n\n` +
              `Try these steps:\n` +
              `1. Open Terminal and run: code-server\n` +
              `2. Check if port 8080 is in use: lsof -i:8080\n` +
              `3. Kill conflicting process: kill -9 $(lsof -ti:8080)`,
          };
        }
      } catch (error) {
        console.error('[CodeServerManager] Error checking/starting code-server:', error);

        if (retryCount < maxRetries) {
          console.log('[CodeServerManager] Error occurred, retrying...');
          notifyStatusChange(`Connection error. Retrying (${retryCount + 1}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return checkAndStart(retryCount + 1);
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('fetch') ||
          errorMessage.includes('network') ||
          errorMessage.includes('Failed to fetch')
        ) {
          return {
            success: false,
            error:
              'Could not connect to backend server.\n\n' +
              'The DevOrbit backend server may not be running.\n' +
              'This is an internal error - please restart the application.',
          };
        }
        return {
          success: false,
          error: `Error: ${errorMessage}\n\nTry clicking "Retry".`,
        };
      }
    };

    const restartAndRetry = async (retryCount: number): Promise<CodeServerResult> => {
      try {
        notifyStatusChange('Stopping VS Code Server...');
        await fetch(`${apiBaseUrl}/code-server/stop`, { method: 'POST' });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        notifyStatusChange('Restarting VS Code Server...');
        return checkAndStart(retryCount);
      } catch (error) {
        console.error('[CodeServerManager] Failed to restart code-server:', error);
        return {
          success: false,
          error:
            'Failed to restart VS Code Server.\n\n' +
            'Try manually restarting:\n' +
            '1. Kill code-server: pkill -f code-server\n' +
            '2. Click "Retry"',
        };
      }
    };

    return checkAndStart(0);
  })();

  try {
    const result = await codeServerPromise;
    return result;
  } finally {
    // Clear the promise after completion so future retries can start fresh
    codeServerPromise = null;
  }
};

// Force restart code-server (e.g., after iframe timeout)
const forceRestartCodeServer = async (apiBaseUrl: string): Promise<CodeServerResult> => {
  // If already restarting, wait for it
  if (codeServerPromise) {
    console.log('[CodeServerManager] Restart in progress, waiting...');
    return codeServerPromise;
  }

  // Prevent restart if code-server was recently confirmed ready
  // This avoids unnecessary restarts when multiple panels timeout simultaneously
  const timeSinceReady = Date.now() - lastCodeServerReadyTime;
  if (timeSinceReady < MIN_RESTART_INTERVAL_MS) {
    console.log(
      `[CodeServerManager] Skipping restart - code-server was ready ${Math.round(timeSinceReady / 1000)}s ago (min interval: ${MIN_RESTART_INTERVAL_MS / 1000}s)`
    );
    // Return success since code-server was recently working
    return { success: true, url: 'http://127.0.0.1:8080' };
  }

  codeServerPromise = (async (): Promise<CodeServerResult> => {
    try {
      notifyStatusChange('Stopping VS Code Server...');
      await fetch(`${apiBaseUrl}/code-server/stop`, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      notifyStatusChange('Restarting VS Code Server...');
      const startRes = await fetch(`${apiBaseUrl}/code-server/start`, { method: 'POST' });
      const startResult = await startRes.json();

      if (startResult.success) {
        notifyStatusChange('VS Code Server started. Warming up...');
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.ideWarmupDelay));
        notifyStatusChange('Loading editor...');
        lastCodeServerReadyTime = Date.now();
        return { success: true, url: 'http://127.0.0.1:8080' };
      }
      return { success: false, error: startResult.error || 'Failed to restart' };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to restart VS Code Server. Try manually restarting.',
      };
    }
  })();

  try {
    return await codeServerPromise;
  } finally {
    codeServerPromise = null;
  }
};

// ============================================================================
// End of module-level code-server coordination
// ============================================================================

interface WebIDEPanelProps {
  directory: string;
  /** Show button to restore terminal panel */
  showTerminalButton?: boolean;
  /** Callback to show terminal panel */
  onShowTerminal?: () => void;
  /** Show button to restore browser panel */
  showBrowserButton?: boolean;
  /** Callback to show browser panel */
  onShowBrowser?: () => void;
  /** Current app status for flow controls */
  appStatus?: AppStatus;
  /** Callback to start the app */
  onStart?: () => void;
  /** Callback to stop the app */
  onStop?: () => void;
  /** Callback to restart the app */
  onRestart?: () => void;
  /** Callback to switch to details view */
  onSwitchToDetails?: () => void;
}

export const WebIDEPanel = ({
  directory,
  showTerminalButton,
  onShowTerminal,
  showBrowserButton,
  onShowBrowser,
  appStatus,
  onStart,
  onStop,
  onRestart,
  onSwitchToDetails,
}: WebIDEPanelProps) => {
  const [codeServerLoading, setCodeServerLoading] = useState(true);
  const [codeServerError, setCodeServerError] = useState<string | null>(null);
  const [codeServerStatus, setCodeServerStatus] = useState<string>('Initializing...');
  const [codeServerRetryTrigger, setCodeServerRetryTrigger] = useState(0);
  // Ref, not state: the timer is re-armed after restarts and cleared in effect cleanup,
  // which would otherwise see a stale null from the render that created the effect
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track when code-server is confirmed ready - prevents iframe from loading prematurely
  const [codeServerReady, setCodeServerReady] = useState(false);

  // Ref for iframe to enable manual reload
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Copilot info dismissal state - persisted in localStorage
  const [copilotInfoDismissed, setCopilotInfoDismissed] = useState(() => {
    try {
      return localStorage.getItem('devorbit-copilot-info-dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const dismissCopilotInfo = () => {
    setCopilotInfoDismissed(true);
    try {
      localStorage.setItem('devorbit-copilot-info-dismissed', 'true');
    } catch {
      // Ignore localStorage errors
    }
  };

  // Get code-server URL from environment or use default (memoized)
  // Default to http://127.0.0.1:8080 for local development
  // Use /code-server/ when running through Docker nginx proxy
  const codeServerUrl = useMemo(() => {
    return import.meta.env.VITE_CODE_SERVER_URL || 'http://127.0.0.1:8080';
  }, []);

  // Get iframe load timeout from environment or use default (15 seconds)
  const iframeTimeout = useMemo(() => {
    const timeout = import.meta.env.VITE_CODE_SERVER_TIMEOUT;
    return timeout ? parseInt(timeout, 10) : 15000;
  }, []);

  // Validate that a path is safe and within allowed directories
  const validatePath = useCallback((path: string): boolean => {
    const normalizedPath = path.replace(/\\/g, '/');

    // Check for path traversal attempts
    if (normalizedPath.includes('..')) {
      console.error(`[WebIDEPanel] Path traversal attempt blocked: ${path}`);
      return false;
    }

    // Deny access to sensitive directories (security-critical)
    // These patterns protect SSH keys, cloud credentials, and other secrets
    const deniedPatterns = [
      '/.ssh/',
      '/.aws/',
      '/.config/gcloud/',
      '/.kube/',
      '/.docker/',
      '/.gnupg/',
      '/.password-store/',
      '/credentials',
      '/secrets',
      '/.npmrc',
      '/.pypirc',
      '/.gitconfig',
    ];

    const isDenied = deniedPatterns.some((pattern) => normalizedPath.includes(pattern));
    if (isDenied) {
      console.error(`[WebIDEPanel] Access to sensitive directory blocked: ${path}`);
      return false;
    }

    // Ensure path starts with allowed prefixes
    // Restricted to specific project directories to prevent access to system files
    const allowedPrefixes = [
      '/home/coder/Projects/',
      '/home/coder/PROJECTS/',
      '/Users/', // macOS - consider tightening to specific user directories in production
    ];

    const isAllowed = allowedPrefixes.some((prefix) => {
      const normalizedPrefix = prefix.replace(/\\/g, '/');
      return normalizedPath.startsWith(normalizedPrefix);
    });

    if (!isAllowed) {
      console.error(`[WebIDEPanel] Path not in allowed directories: ${path}`);
      return false;
    }

    return true;
  }, []);

  // Get the path for code-server
  // When running locally (not in Docker), use the path as-is
  // When running in Docker, convert host path to container path
  const getContainerPath = useCallback(
    (hostPath: string) => {
      // Validate path first to prevent path traversal attacks
      if (!validatePath(hostPath)) {
        throw new Error(`Invalid or unsafe path: ${hostPath}`);
      }

      const normalizedPath = hostPath.replace(/\\/g, '/');

      // Check if we're using local code-server (not Docker)
      // If URL is localhost/127.0.0.1, use the path directly
      const isLocalCodeServer =
        codeServerUrl.includes('127.0.0.1') || codeServerUrl.includes('localhost');

      if (isLocalCodeServer) {
        // Local code-server can access host paths directly
        if (import.meta.env.DEV) {
          console.log(`[WebIDEPanel] Using local path: ${normalizedPath}`);
        }
        return normalizedPath;
      }

      // Docker: code-server mounts volumes at /home/coder/Projects and /home/coder/PROJECTS
      // Convert host path to container path
      const projectsMatches = normalizedPath.match(/\/Projects\//g);
      const PROJECTSMatches = normalizedPath.match(/\/PROJECTS\//g);

      let containerPath: string | null = null;

      if (projectsMatches && projectsMatches.length > 0) {
        const lastIndex = normalizedPath.lastIndexOf('/Projects/');
        const relativePath = normalizedPath.substring(lastIndex + '/Projects/'.length);
        containerPath = `/home/coder/Projects/${relativePath}`;
        if (import.meta.env.DEV) {
          console.log(`[WebIDEPanel] Mapped path: ${hostPath} -> ${containerPath}`);
        }
      } else if (PROJECTSMatches && PROJECTSMatches.length > 0) {
        const lastIndex = normalizedPath.lastIndexOf('/PROJECTS/');
        const relativePath = normalizedPath.substring(lastIndex + '/PROJECTS/'.length);
        containerPath = `/home/coder/PROJECTS/${relativePath}`;
        if (import.meta.env.DEV) {
          console.log(`[WebIDEPanel] Mapped path: ${hostPath} -> ${containerPath}`);
        }
      }

      if (!containerPath) {
        if (import.meta.env.DEV) {
          console.warn(`[WebIDEPanel] Could not map path to container: ${hostPath}`);
        }
        return normalizedPath;
      }

      return containerPath;
    },
    [validatePath, codeServerUrl]
  );

  // Memoize iframe src URL to avoid unnecessary recalculations
  const iframeSrc = useMemo(() => {
    const containerPath = getContainerPath(directory);
    return `${codeServerUrl}/?folder=${encodeURIComponent(containerPath)}`;
  }, [codeServerUrl, directory, getContainerPath]);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    // Ignore load events for about:blank (used when code-server is not ready)
    if (!codeServerReady) {
      console.log('[WebIDEPanel] Ignoring iframe load for about:blank');
      return;
    }

    // Clear timeout since iframe loaded successfully
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setCodeServerLoading(false);
    setCodeServerError(null);
    // Update global ready time - this prevents other panels from triggering unnecessary restarts
    lastCodeServerReadyTime = Date.now();
    console.log('[WebIDEPanel] Iframe loaded successfully, updated lastCodeServerReadyTime');
  }, [codeServerReady]);

  // Track retry count for iframe timeout handling
  const iframeRetryCount = useRef(0);
  const maxIframeRetries = 2;

  // Debounce for iframe error handling - prevents multiple panels from triggering errors simultaneously
  const lastErrorTime = useRef(0);

  // Check and auto-start code-server on mount and on retry
  // Uses the shared module-level ensureCodeServerRunning to coordinate across multiple panels
  useEffect(() => {
    setCodeServerLoading(true);
    setCodeServerError(null);
    setCodeServerStatus('Initializing...');
    setCodeServerReady(false); // Reset ready state - prevents iframe from loading prematurely
    iframeRetryCount.current = 0;

    // Subscribe to status updates from the shared manager
    const handleStatusChange = (status: string) => {
      setCodeServerStatus(status);
    };
    statusSubscribers.add(handleStatusChange);

    // Use the shared manager to ensure code-server is running
    // All panels will wait for the same promise instead of starting independent operations
    let cancelled = false;
    console.log('[WebIDEPanel] Using shared ensureCodeServerRunning');
    ensureCodeServerRunning(API_BASE_URL, iframeTimeout).then((result) => {
      if (cancelled) return;
      if (result.success) {
        console.log('[WebIDEPanel] code-server ready, enabling iframe load');

        // NOW set codeServerReady to true - this triggers the iframe to load
        setCodeServerReady(true);

        // Set timeout for iframe load - but only this panel manages its own iframe
        armLoadTimeout();
      } else {
        setCodeServerLoading(false);
        setCodeServerError(result.error || 'Failed to start VS Code Server');
      }
    });

    // (Re-)arms the iframe load timeout; also called after each restart so a
    // restart that still yields no load ends in the error state, not an endless spinner
    function armLoadTimeout() {
      const actualTimeout = Math.min(iframeTimeout, 15000);
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = setTimeout(() => {
        // Debounce: if another panel already triggered an error within 1 second, skip
        const now = Date.now();
        if (now - lastErrorTime.current < 1000) {
          console.log('[WebIDEPanel] Iframe timeout debounced');
          return;
        }
        lastErrorTime.current = now;

        if (iframeRetryCount.current < maxIframeRetries) {
          iframeRetryCount.current++;
          console.log('[WebIDEPanel] Iframe timeout, attempting shared restart...');
          setCodeServerStatus('Editor not responding. Restarting VS Code Server...');
          setCodeServerReady(false); // Disable iframe during restart

          // Use shared restart to prevent race conditions
          forceRestartCodeServer(API_BASE_URL).then((restartResult) => {
            if (cancelled) return;
            if (restartResult.success) {
              setCodeServerReady(true); // Re-enable iframe after restart
              armLoadTimeout(); // iframe may still not load: retry or surface the error
            } else {
              setCodeServerLoading(false);
              setCodeServerError(restartResult.error || 'Failed to restart VS Code Server');
            }
          });
        } else {
          setCodeServerLoading(false);
          setCodeServerError(
            'VS Code Server is running but not responding.\n\n' +
              'This could be due to:\n' +
              '• code-server crashed or hung\n' +
              '• Port 8080 is blocked\n' +
              '• Browser security restrictions\n\n' +
              'Try clicking "Retry".'
          );
        }
      }, actualTimeout);
    }

    // Clean up timeout and unsubscribe when component unmounts or retries
    return () => {
      statusSubscribers.delete(handleStatusChange);
      cancelled = true;
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [iframeTimeout, codeServerRetryTrigger]);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span>Web IDE</span>

          {/* Flow Controls */}
          {appStatus !== undefined && (
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-700">
              {appStatus === AppStatus.RUNNING ? (
                <>
                  <button
                    onClick={onStop}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 rounded transition-colors"
                    title="Stop application"
                  >
                    <Square size={12} fill="currentColor" />
                    Stop
                  </button>
                  <button
                    onClick={onRestart}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    title="Restart application"
                  >
                    <RefreshCw size={12} />
                  </button>
                </>
              ) : (
                <button
                  onClick={onStart}
                  disabled={
                    appStatus === AppStatus.STARTING ||
                    appStatus === AppStatus.ANALYZING ||
                    appStatus === AppStatus.RESTARTING
                  }
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Start application"
                >
                  {appStatus === AppStatus.STARTING || appStatus === AppStatus.RESTARTING ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} fill="currentColor" />
                  )}
                  {appStatus === AppStatus.STARTING ? 'Starting...' : 'Run'}
                </button>
              )}
            </div>
          )}

          {/* Panel visibility buttons */}
          {showTerminalButton && onShowTerminal && (
            <button
              onClick={onShowTerminal}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              title="Show Terminal"
            >
              <Terminal size={12} />
              Terminal
            </button>
          )}
          {showBrowserButton && onShowBrowser && (
            <button
              onClick={onShowBrowser}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              title="Show Browser Preview"
            >
              <Globe size={12} />
              Browser
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Details button - switch back to details view */}
          {onSwitchToDetails && (
            <button
              onClick={onSwitchToDetails}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 rounded transition-colors"
              title="Switch to Details view"
            >
              <FileText size={12} />
              Details
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* Loading state with status message */}
        {codeServerLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
            <div className="text-center max-w-md px-4">
              <RefreshCw className="w-10 h-10 mx-auto mb-3 animate-spin text-blue-500" />
              <div className="text-base font-medium text-gray-200 mb-2">Loading VS Code Server</div>
              <div className="text-sm text-gray-400">{codeServerStatus}</div>
            </div>
          </div>
        )}

        {/* Error state */}
        {codeServerError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
            <div className="text-center max-w-md px-4">
              <Box className="w-12 h-12 mx-auto mb-3 text-gray-500" />
              <div className="text-base font-medium text-gray-300 mb-2">
                VS Code Server Unavailable
              </div>
              <div className="text-sm text-gray-400 mb-4 whitespace-pre-line">
                {codeServerError}
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => {
                    // Trigger full check-and-start cycle again
                    setCodeServerRetryTrigger((prev) => prev + 1);
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                  aria-label="Retry loading VS Code Server"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Iframe is always mounted to preserve state, but src is only set when code-server is ready.
              This prevents:
              1. ERR_CONNECTION_REFUSED errors from iframes loading before code-server starts
              2. Iframe destruction/recreation during restarts which can cause page reload issues */}
        <iframe
          ref={iframeRef}
          src={codeServerReady ? iframeSrc : 'about:blank'}
          className="w-full h-full border-0"
          title="VS Code Server"
          onLoad={handleIframeLoad}
          // Security: allow-same-origin is required for code-server authentication
          // code-server uses cookies for session management which requires same-origin access
          // This is safe because code-server is served through our nginx proxy on the same origin
          sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-same-origin"
          allow="clipboard-read; clipboard-write; keyboard-map"
          aria-label="VS Code web editor"
        />

        {/* Copilot Alternatives Info - shown on first code-server load */}
        {!codeServerLoading && !codeServerError && !copilotInfoDismissed && (
          <div className="absolute bottom-4 right-4 bg-gray-800/95 backdrop-blur-sm p-4 rounded-lg text-sm max-w-xs z-20 border border-gray-700 shadow-xl">
            <div className="flex items-start gap-2 mb-2">
              <span className="text-amber-400 font-medium">GitHub Copilot unavailable</span>
            </div>
            <p className="text-gray-400 text-xs mb-2">
              code-server uses the Open VSX registry, which doesn't include proprietary extensions
              like GitHub Copilot.
            </p>
            <p className="text-gray-300 text-xs mb-2">Try these free alternatives:</p>
            <ul className="text-gray-300 text-xs space-y-1 mb-3">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                <span>
                  <strong>Codeium</strong> - Free AI completion
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                <span>
                  <strong>TabNine</strong> - AI autocomplete
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
                <span>
                  <strong>Continue</strong> - Open source AI
                </span>
              </li>
            </ul>
            <button
              onClick={dismissCopilotInfo}
              className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
            >
              Got it, don't show again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
