import { useEffect, useRef, useCallback, useState } from 'react';
import {
  RefreshCw,
  ExternalLink,
  Monitor,
  Smartphone,
  Tablet,
  AlertCircle,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ElectronBrowserViewProps {
  url: string;
  appId: string;
  /** Callback to hide the browser panel */
  onHide?: () => void;
}

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: Record<Viewport, { width: number | null; label: string; icon: LucideIcon }> = {
  desktop: { width: null, label: 'Desktop', icon: Monitor },
  tablet: { width: 768, label: 'Tablet', icon: Tablet },
  mobile: { width: 375, label: 'Mobile', icon: Smartphone },
};

// Type declaration for Electron API exposed via preload
interface ElectronAPI {
  browserView: {
    create: (viewId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; error?: string }>;
    navigate: (viewId: string, url: string) => Promise<{ success: boolean; error?: string }>;
    resize: (viewId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; error?: string }>;
    destroy: (viewId: string) => Promise<{ success: boolean; error?: string }>;
    openDevTools: (viewId: string) => Promise<{ success: boolean; error?: string }>;
    closeDevTools: (viewId: string) => Promise<{ success: boolean; error?: string }>;
    refresh: (viewId: string) => Promise<{ success: boolean; error?: string }>;
  };
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * ElectronBrowserView - Renders an embedded Chromium browser using Electron's BrowserView
 * This provides access to real Chrome DevTools instead of simulated console/network logs.
 */
export const ElectronBrowserView = ({
  url,
  appId,
  onHide,
}: ElectronBrowserViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewIdRef = useRef<string>(`browser-view-${appId}`);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [currentUrl, setCurrentUrl] = useState(url);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  const api = window.electronAPI?.browserView;

  // Calculate bounds based on container position and viewport
  const calculateBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const viewportWidth = VIEWPORTS[viewport].width;

    // For non-desktop viewports, center the content
    let width = rect.width;
    let x = rect.x;

    if (viewportWidth && viewportWidth < rect.width) {
      width = viewportWidth;
      x = rect.x + (rect.width - viewportWidth) / 2;
    }

    return {
      x: Math.round(x),
      y: Math.round(rect.y),
      width: Math.round(width),
      height: Math.round(rect.height),
    };
  }, [viewport]);

  // Create BrowserView on mount
  useEffect(() => {
    if (!api) {
      setError('BrowserView API not available');
      setIsLoading(false);
      return;
    }

    const viewId = viewIdRef.current;
    let mounted = true;

    const initBrowserView = async () => {
      const bounds = calculateBounds();
      if (!bounds) return;

      setIsLoading(true);
      setError(null);

      // Create the BrowserView
      const createResult = await api.create(viewId, bounds);
      if (!mounted) return;

      if (!createResult.success) {
        // If view already exists, try to use it
        if (createResult.error !== 'View already exists') {
          setError(createResult.error || 'Failed to create browser view');
          setIsLoading(false);
          return;
        }
      }

      // Navigate to URL
      if (url) {
        const navResult = await api.navigate(viewId, url);
        if (!mounted) return;

        if (!navResult.success) {
          setError(navResult.error || 'Failed to navigate');
        }
      }

      setIsLoading(false);
    };

    initBrowserView();

    // Cleanup on unmount
    return () => {
      mounted = false;
      api.destroy(viewId).catch(console.error);
    };
  }, [api, url]);

  // Update bounds when container resizes or viewport changes
  useEffect(() => {
    if (!api || !containerRef.current) return;

    const viewId = viewIdRef.current;

    const updateBounds = () => {
      const bounds = calculateBounds();
      if (bounds) {
        api.resize(viewId, bounds).catch(console.error);
      }
    };

    // Initial update
    updateBounds();

    // Use ResizeObserver to track container size changes
    const observer = new ResizeObserver(() => {
      updateBounds();
    });

    observer.observe(containerRef.current);

    // Also listen for window resize/scroll events
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [api, calculateBounds, viewport]);

  // Handle URL changes
  useEffect(() => {
    if (!api || !url) return;

    const viewId = viewIdRef.current;
    api.navigate(viewId, url).catch(console.error);
    setCurrentUrl(url);
  }, [api, url]);

  const handleRefresh = async () => {
    if (!api) return;

    // Validate URL
    try {
      const parsed = new URL(currentUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setUrlError('Invalid protocol - only http and https are allowed');
        return;
      }
      setUrlError(null);
    } catch {
      setUrlError('Invalid URL format');
      return;
    }

    const viewId = viewIdRef.current;

    // If URL changed, navigate to new URL
    if (currentUrl !== url) {
      const result = await api.navigate(viewId, currentUrl);
      if (!result.success) {
        setUrlError(result.error || 'Failed to navigate');
      }
    } else {
      // Just refresh
      api.refresh(viewId).catch(console.error);
    }
  };

  const handleOpenDevTools = async () => {
    if (!api) return;

    const viewId = viewIdRef.current;
    const result = await api.openDevTools(viewId);
    if (result.success) {
      setDevToolsOpen(true);
    }
  };

  const handleCloseDevTools = async () => {
    if (!api) return;

    const viewId = viewIdRef.current;
    const result = await api.closeDevTools(viewId);
    if (result.success) {
      setDevToolsOpen(false);
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
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm flex items-center justify-between">
        <span>Browser Preview</span>
        <div className="flex items-center gap-2">
          <button
            onClick={devToolsOpen ? handleCloseDevTools : handleOpenDevTools}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
              devToolsOpen
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title={devToolsOpen ? 'Close DevTools' : 'Open DevTools'}
          >
            <Wrench size={12} />
            DevTools
          </button>
          {onHide && (
            <button
              onClick={onHide}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
              title="Hide browser preview"
            >
              <ExternalLink size={14} />
            </button>
          )}
        </div>
      </div>

      {/* URL Bar */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2 p-2">
          <button
            onClick={handleRefresh}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <input
            value={currentUrl}
            onChange={(e) => {
              setCurrentUrl(e.target.value);
              setUrlError(null);
            }}
            className={`flex-1 bg-gray-900 px-3 py-1 rounded text-sm ${
              urlError ? 'border border-red-500/50' : ''
            }`}
            onKeyDown={(e) => e.key === 'Enter' && handleRefresh()}
          />
          <button
            onClick={() => window.open(currentUrl, '_blank')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Open in new window"
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

      {/* BrowserView Container */}
      <div
        ref={containerRef}
        className="flex-1 bg-white relative"
        style={{
          // The BrowserView is positioned absolutely by Electron
          // This container just marks where it should appear
        }}
      >
        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-10">
            <div className="text-center text-red-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-3" />
              <div className="text-lg font-medium mb-2">Browser Preview Error</div>
              <div className="text-sm">{error}</div>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        )}
      </div>
    </div>
  );
};
