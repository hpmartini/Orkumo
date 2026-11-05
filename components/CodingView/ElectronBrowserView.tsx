import { useEffect, useRef, useCallback, useState, useId } from 'react';
import { RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { BrowserToolbar, type BrowserChromeProps, type Viewport } from './BrowserToolbar';

interface ElectronBrowserViewProps extends BrowserChromeProps {
  url: string;
  appId: string;
}

const VIEWPORT_WIDTHS: Record<Viewport, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
};

/**
 * ElectronBrowserView - Renders an embedded Chromium browser using Electron's BrowserView
 * This provides access to real Chrome DevTools instead of simulated console/network logs.
 */
export const ElectronBrowserView = ({ url, appId, ...chrome }: ElectronBrowserViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Views without an app (agent workspace browser panes) still need a unique native view id
  const fallbackId = useId();
  const viewIdRef = useRef<string>(`browser-view-${appId || fallbackId}`);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [currentUrl, setCurrentUrl] = useState(url);
  // Create reads the latest url without depending on it: a url change navigates (effect below), no rebuild
  const urlRef = useRef(url);
  urlRef.current = url;
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [history, setHistory] = useState({ canGoBack: false, canGoForward: false });

  const api = window.electronAPI?.browserView;

  // Calculate bounds based on container position and viewport
  const calculateBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const viewportWidth = VIEWPORT_WIDTHS[viewport];

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
      const url = urlRef.current;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once per view; url changes navigate below
  }, [api]);

  // Update bounds when container resizes or viewport changes
  useEffect(() => {
    if (!api || !containerRef.current) return;

    const viewId = viewIdRef.current;
    let lastBounds = '';

    const updateBounds = () => {
      // The native view paints above all HTML: collapse it while a modal is open (#140)
      const bounds = document.querySelector('[aria-modal="true"]')
        ? { x: 0, y: 0, width: 0, height: 0 }
        : calculateBounds();
      // body mutations fire constantly (terminals); only send real changes over IPC
      const key = JSON.stringify(bounds);
      if (bounds && key !== lastBounds) {
        lastBounds = key;
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
    const modalObserver = new MutationObserver(updateBounds);
    modalObserver.observe(document.body, { childList: true, subtree: true });

    // Also listen for window resize/scroll events
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);

    return () => {
      observer.disconnect();
      modalObserver.disconnect();
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

  // Navigations inside the view (links, back/forward) update the url field and history buttons
  useEffect(
    () =>
      api?.onNavigate?.(({ viewId, url: navUrl, canGoBack, canGoForward }) => {
        if (viewId !== viewIdRef.current) return;
        setCurrentUrl(navUrl);
        setUrlError(null);
        setHistory({ canGoBack, canGoForward });
      }),
    [api]
  );

  const go = (direction: 'back' | 'forward') => {
    api?.go(viewIdRef.current, direction).catch(console.error);
  };

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
      <BrowserToolbar
        {...chrome}
        url={currentUrl}
        onUrlChange={(next) => {
          setCurrentUrl(next);
          setUrlError(null);
        }}
        onSubmit={handleRefresh}
        loading={isLoading}
        urlError={urlError}
        viewport={viewport}
        onViewportChange={setViewport}
        devToolsOpen={devToolsOpen}
        onToggleDevTools={devToolsOpen ? handleCloseDevTools : handleOpenDevTools}
        history={history}
        onGo={go}
      />

      {/* BrowserView Container */}
      <div
        ref={containerRef}
        className="flex-1 bg-white relative"
        style={
          {
            // The BrowserView is positioned absolutely by Electron
            // This container just marks where it should appear
          }
        }
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
