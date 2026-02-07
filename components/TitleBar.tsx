import React, { useState, useEffect } from 'react';
import { Terminal, Globe, Rocket } from 'lucide-react';
import { AppTabs } from './AppTabs';
import { AppStatus } from '../types';
import { isElectron } from '../utils/apiConfig';

interface AppTab {
  appId: string;
  name: string;
  status: AppStatus;
  port?: number;
}

interface TitleBarProps {
  tabs: AppTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
  onOpenNewTab?: () => void;
  // Pane visibility controls (only shown when in app/coding view)
  showPaneControls?: boolean;
  isTerminalVisible?: boolean;
  isBrowserVisible?: boolean;
  onToggleTerminal?: () => void;
  onToggleBrowser?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  onOpenNewTab,
  showPaneControls = false,
  isTerminalVisible = true,
  isBrowserVisible = true,
  onToggleTerminal,
  onToggleBrowser,
}) => {
  // Track fullscreen state to hide traffic light spacer when in fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    // Also check for macOS native fullscreen via media query
    const mediaQuery = window.matchMedia('(display-mode: fullscreen)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsFullscreen(e.matches);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    mediaQuery.addEventListener('change', handleMediaChange);

    // Initial check
    setIsFullscreen(!!document.fullscreenElement || mediaQuery.matches);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  // In non-Electron (browser) mode, only show the titlebar when tabs are present
  // and don't include the traffic light spacer

  // For browser mode without tabs, don't show anything
  if (!isElectron && tabs.length === 0) {
    return null;
  }

  // Show traffic light spacer only in Electron and NOT in fullscreen
  const showTrafficLightSpacer = isElectron && !isFullscreen;

  return (
    <div
      className="fixed top-0 left-0 right-0 h-10 bg-gray-900 border-b border-gray-800 flex items-center z-50"
      style={
        {
          // Make the titlebar draggable (macOS window dragging) - only in Electron
          WebkitAppRegion: isElectron ? 'drag' : undefined,
        } as React.CSSProperties
      }
    >
      {/* Traffic light spacer for macOS - only in Electron and not fullscreen */}
      {showTrafficLightSpacer && <div className="w-[78px] shrink-0" />}

      {/* App logo - always visible */}
      <div
        className="flex items-center gap-2 px-3 shrink-0 text-blue-500"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Rocket size={18} />
      </div>

      {/* Tabs area - takes remaining space, not draggable so tabs are clickable */}
      <div
        className="flex-1 flex items-center h-full min-w-0 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {tabs.length > 0 ? (
          <AppTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onReorderTabs={onReorderTabs}
            onOpenNewTab={onOpenNewTab}
            isInTitleBar
          />
        ) : (
          // Empty state - just show app name in center when no tabs
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-medium">
            DevOrbit Dashboard
          </div>
        )}
      </div>

      {/* Pane controls - right side, like VS Code */}
      {showPaneControls && (
        <div
          className="flex items-center gap-1 px-2 shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={onToggleTerminal}
            className={`p-1.5 rounded transition-colors ${
              isTerminalVisible
                ? 'bg-gray-700 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
            title={isTerminalVisible ? 'Hide Terminal' : 'Show Terminal'}
          >
            <Terminal size={14} />
          </button>
          <button
            onClick={onToggleBrowser}
            className={`p-1.5 rounded transition-colors ${
              isBrowserVisible
                ? 'bg-gray-700 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
            title={isBrowserVisible ? 'Hide Browser' : 'Show Browser'}
          >
            <Globe size={14} />
          </button>
        </div>
      )}

      {/* Window controls spacer for Windows (if needed in future) */}
      {/* <div className="w-[140px] shrink-0" /> */}
    </div>
  );
};
