import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';

interface AppTab {
  appId: string;
  name: string;
  status: AppStatus;
  port?: number;
}

interface AppTabsProps {
  tabs: AppTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
  onOpenNewTab?: () => void;
}

export const AppTabs: React.FC<AppTabsProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  onOpenNewTab,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Check scroll state
  const updateScrollState = () => {
    if (containerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    }
  };

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [tabs]);

  const scroll = (direction: 'left' | 'right') => {
    if (containerRef.current) {
      const scrollAmount = 200;
      containerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
      setTimeout(updateScrollState, 300);
    }
  };

  // Keyboard shortcut: Cmd/Ctrl+W to close active tab
  // Only intercept this specific shortcut to avoid interfering with other browser/system shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+W (Mac) or Ctrl+W (Windows/Linux) to close current tab
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifierKey = isMac ? e.metaKey : e.ctrlKey;

      if (modifierKey && e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey) {
        // Only prevent default if we have an active tab to close
        if (activeTabId && tabs.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          onCloseTab(activeTabId);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [tabs, activeTabId, onCloseTab]);

  // Middle-click handler to close tabs
  const handleMouseDown = (e: React.MouseEvent, appId: string) => {
    // Middle mouse button (button 1)
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      onCloseTab(appId);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && onReorderTabs) {
      onReorderTabs(draggedIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const getStatusColor = (status: AppStatus) => {
    switch (status) {
      case AppStatus.RUNNING:
        return 'bg-emerald-500';
      case AppStatus.STARTING:
      case AppStatus.RESTARTING:
        return 'bg-yellow-500 animate-pulse';
      case AppStatus.ERROR:
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center bg-gray-900 border-b border-gray-800 h-10">
      {/* Scroll left button */}
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="px-1 h-full hover:bg-gray-800 text-gray-400 hover:text-white shrink-0"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      {/* Tabs container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center overflow-x-auto scrollbar-hide"
        onScroll={updateScrollState}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.appId}
            draggable={!!onReorderTabs}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelectTab(tab.appId)}
            onMouseDown={(e) => handleMouseDown(e, tab.appId)}
            onAuxClick={(e) => {
              // Prevent default middle-click behavior (e.g., auto-scroll)
              if (e.button === 1) {
                e.preventDefault();
              }
            }}
            className={`group relative flex items-center gap-2 px-3 h-10 min-w-[120px] max-w-[200px] cursor-pointer border-r border-gray-800 shrink-0 transition-colors ${
              activeTabId === tab.appId
                ? 'bg-gray-800 text-white'
                : 'bg-gray-900 text-gray-400 hover:bg-gray-850 hover:text-gray-200'
            } ${draggedIndex === index ? 'opacity-50' : ''} ${
              dragOverIndex === index ? 'bg-blue-900/30' : ''
            }`}
            role="tab"
            aria-selected={activeTabId === tab.appId}
            tabIndex={0}
          >
            {/* Active tab indicator */}
            {activeTabId === tab.appId && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />
            )}

            {/* Status dot */}
            <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusColor(tab.status)}`} />

            {/* Tab name */}
            <span className="truncate text-sm flex-1">{tab.name}</span>

            {/* Port badge */}
            {tab.port && tab.status === AppStatus.RUNNING && (
              <span className="text-xs text-gray-500">:{tab.port}</span>
            )}

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.appId);
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-700 text-gray-500 hover:text-white transition-all"
              aria-label={`Close ${tab.name}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Scroll right button */}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="px-1 h-full hover:bg-gray-800 text-gray-400 hover:text-white shrink-0"
          aria-label="Scroll tabs right"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* New tab button */}
      {onOpenNewTab && (
        <button
          onClick={onOpenNewTab}
          className="px-2 h-full hover:bg-gray-800 text-gray-400 hover:text-white shrink-0 border-l border-gray-800"
          aria-label="Open new tab"
          title="Open app selector"
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
};

// Helper to create tabs from running apps
export const createTabsFromApps = (apps: AppConfig[]): AppTab[] => {
  return apps
    .filter((app) => app.status === AppStatus.RUNNING || app.status === AppStatus.STARTING || app.status === AppStatus.RESTARTING)
    .map((app) => ({
      appId: app.id,
      name: app.name,
      status: app.status,
      port: app.port,
    }));
};

// Hook to manage tab state with localStorage persistence
export const useAppTabs = (apps: AppConfig[]) => {
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('devorbit-open-tabs');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const saved = localStorage.getItem('devorbit-active-tab');
    return saved || null;
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('devorbit-open-tabs', JSON.stringify(openTabIds));
  }, [openTabIds]);

  useEffect(() => {
    if (activeTabId) {
      localStorage.setItem('devorbit-active-tab', activeTabId);
    } else {
      localStorage.removeItem('devorbit-active-tab');
    }
  }, [activeTabId]);

  // Auto-open tabs for running apps
  useEffect(() => {
    const runningIds = apps
      .filter((app) => app.status === AppStatus.RUNNING || app.status === AppStatus.STARTING)
      .map((app) => app.id);

    setOpenTabIds((prev) => {
      const newIds = runningIds.filter((id) => !prev.includes(id));
      if (newIds.length > 0) {
        return [...prev, ...newIds];
      }
      return prev;
    });
  }, [apps]);

  // Build tabs array
  const tabs: AppTab[] = openTabIds
    .map((id) => apps.find((app) => app.id === id))
    .filter((app): app is AppConfig => app !== undefined)
    .map((app) => ({
      appId: app.id,
      name: app.name,
      status: app.status,
      port: app.port,
    }));

  const openTab = useCallback((appId: string) => {
    setOpenTabIds((prev) => {
      if (!prev.includes(appId)) {
        return [...prev, appId];
      }
      return prev;
    });
    setActiveTabId(appId);
  }, []);

  const closeTab = useCallback((appId: string) => {
    setOpenTabIds((prev) => {
      const newIds = prev.filter((id) => id !== appId);
      // If closing the active tab, update activeTabId
      setActiveTabId((prevActiveId) => {
        if (prevActiveId === appId) {
          return newIds.length > 0 ? newIds[newIds.length - 1] : null;
        }
        return prevActiveId;
      });
      return newIds;
    });
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setOpenTabIds((prev) => {
      const newOrder = [...prev];
      const [moved] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, moved);
      return newOrder;
    });
  }, []);

  const selectTab = useCallback((appId: string) => {
    setOpenTabIds((prev) => {
      if (!prev.includes(appId)) {
        return [...prev, appId];
      }
      return prev;
    });
    setActiveTabId(appId);
  }, []);

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    reorderTabs,
    selectTab,
    setActiveTabId,
  };
};
