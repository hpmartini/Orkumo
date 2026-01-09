import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Star, Folder, Play, Square, Globe, X } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';

interface SidebarPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon: React.ReactNode;
  triggerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export const SidebarPopup: React.FC<SidebarPopupProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  triggerRef,
  children,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  // Position popup next to trigger
  useEffect(() => {
    if (!isOpen || !popupRef.current || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const popup = popupRef.current;
    const triggerRect = trigger.getBoundingClientRect();

    // Position to the right of the trigger
    const left = triggerRect.right + 8;
    const top = triggerRect.top;

    // Adjust if popup would go off screen
    const popupRect = popup.getBoundingClientRect();
    let finalTop = top;
    if (finalTop + popupRect.height > window.innerHeight - 20) {
      finalTop = window.innerHeight - popupRect.height - 20;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${finalTop}px`;
  }, [isOpen, triggerRef]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50 w-72 max-h-96 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="popup-title"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gray-850 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          <span id="popup-title">{title}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto max-h-80">
        {children}
      </div>
    </div>,
    document.body
  );
};

// App list item for popup
interface PopupAppItemProps {
  app: AppConfig;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
}

export const PopupAppItem: React.FC<PopupAppItemProps> = ({
  app,
  isSelected,
  onSelect,
  onStart,
  onStop,
  onOpenInBrowser,
}) => {
  const isRunning = app.status === AppStatus.RUNNING;
  const isStarting = app.status === AppStatus.STARTING || app.status === AppStatus.RESTARTING;

  return (
    <div
      className={`px-3 py-2 flex items-center justify-between hover:bg-gray-800 cursor-pointer transition-colors ${
        isSelected ? 'bg-gray-800 border-l-2 border-blue-500' : ''
      }`}
      onClick={() => onSelect(app.id)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isRunning
              ? 'bg-emerald-500'
              : isStarting
              ? 'bg-yellow-500 animate-pulse'
              : app.status === AppStatus.ERROR
              ? 'bg-red-500'
              : 'bg-gray-500'
          }`}
        />
        <span className="text-sm truncate">{app.name}</span>
      </div>

      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {isRunning ? (
          <>
            {onOpenInBrowser && app.addresses?.[0] && (
              <button
                onClick={() => onOpenInBrowser(app.id)}
                className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400 transition-colors"
                title="Open in browser"
              >
                <Globe size={14} />
              </button>
            )}
            {onStop && (
              <button
                onClick={() => onStop(app.id)}
                className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400 transition-colors"
                title="Stop"
              >
                <Square size={14} />
              </button>
            )}
          </>
        ) : (
          onStart && (
            <button
              onClick={() => onStart(app.id)}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-emerald-400 transition-colors"
              title="Start"
              disabled={isStarting}
            >
              <Play size={14} />
            </button>
          )
        )}
      </div>
    </div>
  );
};

// Favorites Popup
interface FavoritesPopupProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  favorites: AppConfig[];
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
}

export const FavoritesPopup: React.FC<FavoritesPopupProps> = ({
  isOpen,
  onClose,
  triggerRef,
  favorites,
  selectedAppId,
  onSelectApp,
  onStart,
  onStop,
  onOpenInBrowser,
}) => {
  const handleSelect = (id: string) => {
    onSelectApp(id);
    onClose();
  };

  return (
    <SidebarPopup
      isOpen={isOpen}
      onClose={onClose}
      title="Favorites"
      icon={<Star size={16} className="text-yellow-500" />}
      triggerRef={triggerRef}
    >
      {favorites.length === 0 ? (
        <div className="px-4 py-6 text-center text-gray-500 text-sm">
          No favorites yet
        </div>
      ) : (
        favorites.map((app) => (
          <PopupAppItem
            key={app.id}
            app={app}
            isSelected={selectedAppId === app.id}
            onSelect={handleSelect}
            onStart={onStart}
            onStop={onStop}
            onOpenInBrowser={onOpenInBrowser}
          />
        ))
      )}
    </SidebarPopup>
  );
};

// Projects Popup with directory grouping
interface ProjectsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  apps: AppConfig[];
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
}

export const ProjectsPopup: React.FC<ProjectsPopupProps> = ({
  isOpen,
  onClose,
  triggerRef,
  apps,
  selectedAppId,
  onSelectApp,
  onStart,
  onStop,
  onOpenInBrowser,
}) => {
  // Group apps by directory
  const grouped = React.useMemo(() => {
    const groups: Record<string, AppConfig[]> = {};
    apps
      .filter((app) => !app.isArchived)
      .forEach((app) => {
        const pathParts = app.path.split('/');
        const displayDir = pathParts.slice(-2, -1)[0] || 'Root';
        if (!groups[displayDir]) {
          groups[displayDir] = [];
        }
        groups[displayDir].push(app);
      });

    // Sort apps within groups
    Object.keys(groups).forEach((dir) => {
      groups[dir].sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }, [apps]);

  const sortedDirs = Object.keys(grouped).sort();

  const handleSelect = (id: string) => {
    onSelectApp(id);
    onClose();
  };

  return (
    <SidebarPopup
      isOpen={isOpen}
      onClose={onClose}
      title="Projects"
      icon={<Folder size={16} className="text-blue-400" />}
      triggerRef={triggerRef}
    >
      {sortedDirs.length === 0 ? (
        <div className="px-4 py-6 text-center text-gray-500 text-sm">
          No projects found
        </div>
      ) : (
        sortedDirs.map((dir) => (
          <div key={dir}>
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-850 sticky top-0">
              {dir}
            </div>
            {grouped[dir].map((app) => (
              <PopupAppItem
                key={app.id}
                app={app}
                isSelected={selectedAppId === app.id}
                onSelect={handleSelect}
                onStart={onStart}
                onStop={onStop}
                onOpenInBrowser={onOpenInBrowser}
              />
            ))}
          </div>
        ))
      )}
    </SidebarPopup>
  );
};
