import React, { useState, useEffect } from 'react';
import { Rocket, Workflow, Kanban, Code2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ContextTabs } from './ContextTabs';
import { isElectron } from '../utils/apiConfig';

type TitleBarProps = React.ComponentProps<typeof ContextTabs> & {
  /** The rocket opens the dashboard */
  onOpenDashboard: () => void;
};

const VIEWS = [
  { path: '/workflows', label: 'Workflows', icon: Workflow },
  { path: '/board', label: 'Board', icon: Kanban },
  { path: '/code', label: 'Code (VS Code)', icon: Code2 },
];

/** Toggles for the work modes: the route is the state, a second click returns to the agents */
export const ViewToggles: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <div
      className="flex items-center gap-1 px-2 shrink-0"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {VIEWS.map(({ path, label, icon: Icon }) => {
        const active = pathname === path;
        return (
          <button
            key={path}
            onClick={() => navigate(active ? '/agents' : path)}
            aria-pressed={active}
            aria-label={label}
            title={active ? `Close ${label}` : label}
            className={`p-1.5 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${
              active ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
};

export const TitleBar: React.FC<TitleBarProps> = ({ onOpenDashboard, ...tabs }) => {
  // Track fullscreen state to hide traffic light spacer when in fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // Use Electron IPC for fullscreen detection (works with native macOS fullscreen)
    const electronAPI = window.electronAPI;

    if (electronAPI?.onFullscreenChange) {
      // Get initial state
      electronAPI.getFullscreenState?.().then((state: boolean) => {
        setIsFullscreen(state);
      });

      // Subscribe to changes
      const cleanup = electronAPI.onFullscreenChange((fullscreen: boolean) => {
        setIsFullscreen(fullscreen);
      });

      return cleanup;
    }

    // Fallback for non-Electron: use document.fullscreenElement
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    setIsFullscreen(!!document.fullscreenElement);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

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

      {/* App logo - always visible, flush left in fullscreen */}
      <button
        onClick={onOpenDashboard}
        className={`flex items-center gap-2 shrink-0 h-full text-blue-500 hover:text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${showTrafficLightSpacer ? 'px-3' : 'pl-3 pr-2'}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Dashboard"
        aria-label="Open dashboard"
      >
        <Rocket size={18} />
      </button>

      {/* Context tabs - not draggable so tabs are clickable; the free space after them drags */}
      <div
        className="flex items-center h-full min-w-0 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <ContextTabs {...tabs} />
      </div>
      <div className="flex-1 h-full" />

      <ViewToggles />

      {/* Window controls spacer for Windows (if needed in future) */}
      {/* <div className="w-[140px] shrink-0" /> */}
    </div>
  );
};
