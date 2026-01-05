import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical,
  Star,
  Archive,
  Play,
  Square,
  RefreshCw,
  Globe,
  FolderOpen,
  Terminal,
  Trash2,
  Pencil,
} from 'lucide-react';
import { AppStatus } from '../types';

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
  hidden?: boolean;
}

interface MenuDivider {
  divider: true;
}

type MenuItemOrDivider = MenuItem | MenuDivider;

interface KebabMenuProps {
  items: MenuItemOrDivider[];
  position?: 'left' | 'right';
  size?: 'sm' | 'md';
}

export const KebabMenu: React.FC<KebabMenuProps> = ({
  items,
  position = 'right',
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; openAbove: boolean }>({
    top: 0,
    left: 0,
    openAbove: false,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Calculate menu position when opening
  const calculatePosition = useCallback(() => {
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const menuHeight = 320; // Approximate max menu height
    const menuWidth = 180;
    const padding = 8;

    // Check if menu would overflow bottom of viewport
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;

    // Calculate left position based on 'position' prop
    let left = position === 'left'
      ? buttonRect.right - menuWidth
      : buttonRect.left;

    // Ensure menu doesn't overflow horizontally
    if (left + menuWidth > window.innerWidth - padding) {
      left = window.innerWidth - menuWidth - padding;
    }
    if (left < padding) {
      left = padding;
    }

    setMenuPosition({
      top: openAbove ? buttonRect.top - padding : buttonRect.bottom + padding,
      left,
      openAbove,
    });
  }, [position]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handleScroll = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  // Calculate position when opening
  useEffect(() => {
    if (isOpen) {
      calculatePosition();
    }
  }, [isOpen, calculatePosition]);

  const handleKeyDown = (event: React.KeyboardEvent, item: MenuItem) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!item.disabled) {
        item.onClick();
        setIsOpen(false);
      }
    }
  };

  const visibleItems = items.filter(
    (item) => !('divider' in item) || !item.divider ? !('hidden' in item && item.hidden) : true
  );

  const menuContent = isOpen ? (
    <div
      ref={menuRef}
      className="fixed z-[9999] py-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl min-w-[180px] animate-in fade-in zoom-in-95 duration-150"
      style={{
        top: menuPosition.openAbove ? 'auto' : menuPosition.top,
        bottom: menuPosition.openAbove ? window.innerHeight - menuPosition.top : 'auto',
        left: menuPosition.left,
      }}
      role="menu"
    >
      {visibleItems.map((item, index) => {
        if ('divider' in item && item.divider) {
          return (
            <div
              key={`divider-${index}`}
              className="my-1 border-t border-gray-700"
            />
          );
        }

        const menuItem = item as MenuItem;
        if (menuItem.hidden) return null;

        return (
          <button
            key={menuItem.label}
            onClick={(e) => {
              e.stopPropagation();
              if (!menuItem.disabled) {
                menuItem.onClick();
                setIsOpen(false);
              }
            }}
            onKeyDown={(e) => handleKeyDown(e, menuItem)}
            disabled={menuItem.disabled}
            className={`w-full px-3 py-2 text-left flex items-center gap-3 text-sm transition-colors ${
              menuItem.disabled
                ? 'text-gray-600 cursor-not-allowed'
                : menuItem.variant === 'danger'
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
            role="menuitem"
          >
            <span className="w-4 h-4 flex items-center justify-center">
              {menuItem.icon}
            </span>
            {menuItem.label}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors ${
          size === 'sm' ? 'p-0.5' : 'p-1'
        }`}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreVertical size={size === 'sm' ? 14 : 16} />
      </button>

      {/* Render menu in portal to escape container overflow */}
      {menuContent && createPortal(menuContent, document.body)}
    </div>
  );
};

// Helper function to create menu items for an app
interface AppMenuOptions {
  appId: string;
  status: AppStatus;
  isFavorite?: boolean;
  isArchived?: boolean;
  hasPort?: boolean;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRestart?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onOpenInFinder?: (id: string) => void;
  onOpenInTerminal?: (id: string) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const createAppMenuItems = (options: AppMenuOptions): MenuItemOrDivider[] => {
  const {
    appId,
    status,
    isFavorite,
    isArchived,
    hasPort,
    onStart,
    onStop,
    onRestart,
    onOpenInBrowser,
    onToggleFavorite,
    onToggleArchive,
    onOpenInFinder,
    onOpenInTerminal,
    onRename,
    onDelete,
  } = options;

  const isRunning = status === AppStatus.RUNNING;
  const isStopped =
    status === AppStatus.STOPPED ||
    status === AppStatus.ERROR ||
    status === AppStatus.CANCELLED;
  const isLoading =
    status === AppStatus.STARTING ||
    status === AppStatus.ANALYZING ||
    status === AppStatus.RESTARTING;

  const items: MenuItemOrDivider[] = [];

  // Favorites & Archive
  if (onToggleFavorite) {
    items.push({
      label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />,
      onClick: () => onToggleFavorite(appId),
    });
  }

  if (onToggleArchive) {
    items.push({
      label: isArchived ? 'Unarchive' : 'Archive',
      icon: <Archive size={14} />,
      onClick: () => onToggleArchive(appId),
    });
  }

  if (onRename) {
    items.push({
      label: 'Rename',
      icon: <Pencil size={14} />,
      onClick: () => onRename(appId),
    });
  }

  items.push({ divider: true });

  // App controls
  if (onStart) {
    items.push({
      label: 'Start',
      icon: <Play size={14} fill="currentColor" />,
      onClick: () => onStart(appId),
      disabled: !isStopped || isLoading,
    });
  }

  if (onStop) {
    items.push({
      label: 'Stop',
      icon: <Square size={14} fill="currentColor" />,
      onClick: () => onStop(appId),
      disabled: !isRunning,
    });
  }

  if (onRestart) {
    items.push({
      label: 'Restart',
      icon: <RefreshCw size={14} />,
      onClick: () => onRestart(appId),
      disabled: !isRunning || isLoading,
    });
  }

  items.push({ divider: true });

  // External actions
  if (onOpenInBrowser) {
    items.push({
      label: 'Open in Browser',
      icon: <Globe size={14} />,
      onClick: () => onOpenInBrowser(appId),
      disabled: !hasPort || !isRunning,
    });
  }

  if (onOpenInFinder) {
    items.push({
      label: 'Open in Finder',
      icon: <FolderOpen size={14} />,
      onClick: () => onOpenInFinder(appId),
    });
  }

  if (onOpenInTerminal) {
    items.push({
      label: 'Open in Terminal',
      icon: <Terminal size={14} />,
      onClick: () => onOpenInTerminal(appId),
    });
  }

  // Delete action
  if (onDelete) {
    items.push({ divider: true });
    items.push({
      label: 'Remove from List',
      icon: <Trash2 size={14} />,
      onClick: () => onDelete(appId),
      variant: 'danger',
    });
  }

  return items;
};
