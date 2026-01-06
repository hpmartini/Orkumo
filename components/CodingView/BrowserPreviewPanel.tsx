import { useState, useEffect, useRef, useMemo } from 'react';
import {
  RefreshCw,
  ExternalLink,
  Monitor,
  Smartphone,
  Tablet,
  AlertCircle,
  Terminal as TerminalIcon,
  Globe,
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ConsoleLog, NetworkLog } from '../../types';
import { ConsoleLogEntry } from './ConsoleLogEntry';
import { NetworkLogEntry } from './NetworkLogEntry';
import { DevToolsErrorBoundary } from './DevToolsErrorBoundary';

interface BrowserPreviewPanelProps {
  url: string;
  // appId will be used for panel state persistence in Phase 2
  appId: string;
}

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Record<Viewport, { width: string; label: string; icon: LucideIcon }> = {
  desktop: { width: '100%', label: 'Desktop', icon: Monitor },
  tablet: { width: '768px', label: 'Tablet', icon: Tablet },
  mobile: { width: '375px', label: 'Mobile', icon: Smartphone },
};

const MAX_LOGS = 500;

export const BrowserPreviewPanel = ({ url, appId }: BrowserPreviewPanelProps) => {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [networkLogs, setNetworkLogs] = useState<NetworkLog[]>([]);
  const [showDevTools, setShowDevTools] = useState(true);
  const [activeTab, setActiveTab] = useState<'console' | 'network'>('console');
  const [filter, setFilter] = useState<'all' | 'log' | 'warn' | 'error'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync currentUrl with url prop when it changes (e.g., app restarts on different port)
  useEffect(() => {
    setCurrentUrl(url);
    setUrlError(null); // Clear error when URL prop updates
    setConsoleLogs([]); // Clear old logs
    setNetworkLogs([]);
  }, [url]);

  // Listen for console and network messages from iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Validate origin - only accept from localhost/127.0.0.1
      const allowedOrigins = ['http://localhost', 'http://127.0.0.1', 'https://localhost', 'https://127.0.0.1'];
      if (!allowedOrigins.some(origin => event.origin.startsWith(origin))) {
        return;
      }

      // Handle console messages
      if (event.data?.type === 'devorbit-console') {
        const log: ConsoleLog = {
          id: crypto.randomUUID(),
          method: event.data.method,
          args: event.data.args,
          timestamp: event.data.timestamp,
          url: event.data.url,
          uncaught: event.data.uncaught,
        };

        setConsoleLogs((prev) => {
          const newLogs = prev.length >= MAX_LOGS
            ? [...prev.slice(1), log]
            : [...prev, log];
          return newLogs;
        });
      }
      // Handle network messages
      else if (event.data?.type === 'devorbit-network') {
        const log: NetworkLog = {
          id: crypto.randomUUID(),
          method: event.data.method,
          url: event.data.url,
          status: event.data.status,
          error: event.data.error,
          duration: event.data.duration,
          timestamp: event.data.timestamp,
        };

        setNetworkLogs((prev) => {
          const newLogs = prev.length >= MAX_LOGS
            ? [...prev.slice(1), log]
            : [...prev, log];
          return newLogs;
        });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Inject logger script when iframe loads
  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;

    try {
      // Only inject if same-origin or localhost
      const iframeUrl = new URL(currentUrl);
      if (iframeUrl.hostname === 'localhost' || iframeUrl.hostname === '127.0.0.1') {
        const script = iframe.contentDocument?.createElement('script');
        if (script) {
          script.src = '/iframe-logger.js';
          iframe.contentDocument?.head.appendChild(script);
        }
      }
    } catch (e) {
      // Cross-origin iframe, cannot inject
      console.warn('Cannot inject logger into cross-origin iframe');
    }
  };

  const clearLogs = () => {
    setConsoleLogs([]);
    setNetworkLogs([]);
  };

  // Memoize filtered console logs
  const filteredConsoleLogs = useMemo(
    () =>
      consoleLogs.filter(
        (log) =>
          (filter === 'all' || log.method === filter) &&
          (searchTerm === '' ||
            log.args.some((arg) =>
              String(arg).toLowerCase().includes(searchTerm.toLowerCase())
            ))
      ),
    [consoleLogs, filter, searchTerm]
  );

  const handleRefresh = () => {
    // Basic URL validation to prevent javascript: and data: URIs
    try {
      const parsed = new URL(currentUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setUrlError('Invalid protocol - only http and https are allowed');
        return;
      }
      setUrlError(null);
      setIframeKey(prev => prev + 1);
    } catch (e) {
      setUrlError('Invalid URL format');
    }
  };

  if (!url) {
    return (
      <div className="h-full flex flex-col bg-gray-900">
        <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm">
          Browser Preview
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <ExternalLink className="w-12 h-12 mx-auto opacity-50 mb-3" />
            <div>Application not running</div>
            <div className="text-sm mt-2">Start the app to see preview</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm">
        Browser Preview
      </div>

      {/* URL Bar */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2 p-2">
          <button
            onClick={handleRefresh}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <input
            value={currentUrl}
            onChange={(e) => {
              setCurrentUrl(e.target.value);
              setUrlError(null); // Clear error on input change
            }}
            className={`flex-1 bg-gray-900 px-3 py-1 rounded text-sm ${
              urlError ? 'border border-red-500/50' : ''
            }`}
            onKeyDown={(e) => e.key === 'Enter' && handleRefresh()}
          />
          <button
            onClick={() => window.open(currentUrl, '_blank')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
        {urlError && (
          <div className="px-2 pb-2 flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="w-3 h-3" />
            {urlError}
          </div>
        )}
      </div>

      {/* Viewport Controls */}
      <div className="flex gap-1 p-2 bg-gray-850 border-b border-gray-700" role="group" aria-label="Viewport size selector">
        {Object.entries(VIEWPORTS).map(([key, { label, icon: Icon }]) => (
          <button
            key={key}
            onClick={() => setViewport(key as Viewport)}
            aria-label={`Switch to ${label} viewport`}
            aria-pressed={viewport === key}
            className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              viewport === key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Split: iframe + devtools */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* iframe Container */}
        <div className="flex-1 overflow-auto bg-white p-4">
          <div
            className="w-full h-full"
            style={{ width: VIEWPORTS[viewport].width }}
          >
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={currentUrl}
              onLoad={handleIframeLoad}
              className="w-full h-full bg-white shadow-lg"
              style={{ border: '1px solid #e5e7eb' }}
              // Security note: allow-same-origin + allow-scripts is required for local dev servers
              // that use postMessage and hot reload. This combination allows iframe to access parent,
              // but is acceptable because:
              // 1. This dashboard is for LOCAL DEVELOPMENT ONLY (not production)
              // 2. All previewed apps are trusted code running on localhost
              // 3. This enables essential features like HMR (Hot Module Replacement)
              // For production deployments, consider removing allow-same-origin or using different origin
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="App Preview"
            />
          </div>
        </div>

        {/* DevTools Panel */}
        {showDevTools && (
          <div className="h-64 border-t border-gray-700 flex flex-col bg-gray-950">
            {/* DevTools Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-700">
              <div className="flex gap-2" role="tablist">
                <button
                  role="tab"
                  aria-selected={activeTab === 'console'}
                  aria-controls="console-panel"
                  onClick={() => setActiveTab('console')}
                  className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                    activeTab === 'console'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <TerminalIcon className="w-3 h-3" />
                  Console ({consoleLogs.length})
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'network'}
                  aria-controls="network-panel"
                  onClick={() => setActiveTab('network')}
                  className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                    activeTab === 'network'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  Network ({networkLogs.length})
                </button>
              </div>

              {/* Console Controls */}
              {activeTab === 'console' && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {(['all', 'log', 'warn', 'error'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2 py-1 rounded text-xs transition-colors ${
                          filter === f
                            ? 'bg-gray-700 text-white'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 bg-gray-800 rounded px-2">
                    <Search className="w-3 h-3 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-transparent px-1 py-1 text-sm w-32 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={clearLogs}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                    title="Clear logs"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setShowDevTools(false)}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                    title="Hide DevTools"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Network Controls */}
              {activeTab === 'network' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={clearLogs}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                    title="Clear logs"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setShowDevTools(false)}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                    title="Hide DevTools"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Logs Content */}
            <div className="flex-1 overflow-auto p-2 font-mono text-xs">
              {activeTab === 'console' ? (
                <div id="console-panel" role="tabpanel">
                  {consoleLogs.length === 0 ? (
                    <div className="text-gray-600 text-center py-4">
                      No console output yet
                    </div>
                  ) : filteredConsoleLogs.length === 0 ? (
                    <div className="text-gray-600 text-center py-4">
                      No logs match the current filter
                    </div>
                  ) : (
                    filteredConsoleLogs.map((log) => (
                      <DevToolsErrorBoundary key={log.id}>
                        <ConsoleLogEntry log={log} />
                      </DevToolsErrorBoundary>
                    ))
                  )}
                </div>
              ) : (
                <div id="network-panel" role="tabpanel">
                  {networkLogs.length === 0 ? (
                    <div className="text-gray-600 text-center py-4">No network requests yet</div>
                  ) : (
                    networkLogs.map((log) => (
                      <DevToolsErrorBoundary key={log.id}>
                        <NetworkLogEntry log={log} />
                      </DevToolsErrorBoundary>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Show DevTools Button (when hidden) */}
        {!showDevTools && (
          <button
            onClick={() => setShowDevTools(true)}
            className="py-1.5 bg-gray-900 border-t border-gray-700 text-sm hover:bg-gray-800 flex items-center justify-center gap-2"
          >
            <ChevronUp className="w-3 h-3" />
            Show DevTools ({consoleLogs.length} console, {networkLogs.length} network)
          </button>
        )}
      </div>
    </div>
  );
}
