import { useState, useEffect } from 'react';
import { RefreshCw, ExternalLink, Monitor, Smartphone, Tablet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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

export const BrowserPreviewPanel = ({ url, appId }: BrowserPreviewPanelProps) => {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(url);

  // Sync currentUrl with url prop when it changes (e.g., app restarts on different port)
  useEffect(() => {
    setCurrentUrl(url);
  }, [url]);

  const handleRefresh = () => {
    // Basic URL validation to prevent javascript: and data: URIs
    try {
      const parsed = new URL(currentUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.error('Invalid protocol - only http and https are allowed');
        return;
      }
      setIframeKey(prev => prev + 1);
    } catch (e) {
      console.error('Invalid URL');
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
      <div className="flex items-center gap-2 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={handleRefresh}
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <input
          value={currentUrl}
          onChange={(e) => setCurrentUrl(e.target.value)}
          className="flex-1 bg-gray-900 px-3 py-1 rounded text-sm"
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

      {/* Viewport Controls */}
      <div className="flex gap-1 p-2 bg-gray-850 border-b border-gray-700">
        {Object.entries(VIEWPORTS).map(([key, { label, icon: Icon }]) => (
          <button
            key={key}
            onClick={() => setViewport(key as Viewport)}
            className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
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

      {/* iframe Container */}
      <div className="flex-1 flex overflow-auto bg-white p-4">
        <div
          className="w-full"
          style={{ width: VIEWPORTS[viewport].width }}
        >
          <iframe
            key={iframeKey}
            src={currentUrl}
            className="w-full h-full bg-white shadow-lg"
            style={{ border: '1px solid #e5e7eb' }}
            // Security note: allow-same-origin is needed for local dev servers
            // that use postMessage. This is safe for local development only.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="App Preview"
          />
        </div>
      </div>
    </div>
  );
}
