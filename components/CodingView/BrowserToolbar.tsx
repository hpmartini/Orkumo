import type { HTMLAttributes, ReactNode } from 'react';
import {
  RefreshCw,
  ExternalLink,
  Monitor,
  Smartphone,
  Tablet,
  AlertCircle,
  Wrench,
  X,
  GripVertical,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { openInSystemBrowser } from '../../utils/links';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_OPTIONS: Record<Viewport, { label: string; icon: LucideIcon }> = {
  desktop: { label: 'Desktop', icon: Monitor },
  tablet: { label: 'Tablet', icon: Tablet },
  mobile: { label: 'Mobile', icon: Smartphone },
};

export interface BrowserChromeProps {
  /** Callback to close the browser; shows the close button */
  onHide?: () => void;
  /** Accessible name of the close button */
  closeLabel?: string;
  /** Extra buttons before close (e.g. the pane's "own tab") */
  actions?: ReactNode;
  /** Drag props of a split pane; render a grip so URL field and buttons stay clickable */
  dragHandleProps?: HTMLAttributes<HTMLElement>;
}

interface BrowserToolbarProps extends BrowserChromeProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  urlError: string | null;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  devToolsOpen: boolean;
  onToggleDevTools: () => void;
  /** Back/forward state of the native view; the iframe variant has no history */
  history?: { canGoBack: boolean; canGoForward: boolean };
  onGo?: (direction: 'back' | 'forward') => void;
}

const iconButton = 'p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 shrink-0';

/** The one bar of the built-in browser (#185): navigation, viewport, DevTools, close */
export function BrowserToolbar({
  url,
  onUrlChange,
  onSubmit,
  loading,
  urlError,
  viewport,
  onViewportChange,
  devToolsOpen,
  onToggleDevTools,
  onHide,
  closeLabel = 'Hide browser preview',
  actions,
  dragHandleProps,
  history,
  onGo,
}: BrowserToolbarProps) {
  const historyButton = `${iconButton} disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400`;
  return (
    <div className="bg-gray-850 border-b border-gray-700 shrink-0">
      <div role="toolbar" aria-label="Browser" className="flex items-center gap-1 h-9 px-1.5">
        {dragHandleProps && (
          <span
            {...dragHandleProps}
            aria-hidden="true"
            title="Drag to move pane"
            className={`p-1 text-gray-500 cursor-grab active:cursor-grabbing shrink-0 ${dragHandleProps.className ?? ''}`}
          >
            <GripVertical size={14} />
          </span>
        )}
        {onGo && (
          <>
            <button
              onClick={() => onGo('back')}
              disabled={!history?.canGoBack}
              className={historyButton}
              title="Back"
              aria-label="Back"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              onClick={() => onGo('forward')}
              disabled={!history?.canGoForward}
              className={historyButton}
              title="Forward"
              aria-label="Forward"
            >
              <ArrowRight size={14} />
            </button>
          </>
        )}
        <button onClick={onSubmit} className={iconButton} title="Refresh" aria-label="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <input
          value={url}
          aria-label="URL"
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          className={`flex-1 min-w-0 bg-gray-900 px-2.5 py-1 rounded text-sm ${
            urlError ? 'border border-red-500/50' : ''
          }`}
        />
        <div role="group" aria-label="Viewport size selector" className="flex shrink-0">
          {(Object.keys(VIEWPORT_OPTIONS) as Viewport[]).map((key) => {
            const { label, icon: Icon } = VIEWPORT_OPTIONS[key];
            return (
              <button
                key={key}
                onClick={() => onViewportChange(key)}
                aria-label={`Switch to ${label} viewport`}
                aria-pressed={viewport === key}
                title={label}
                className={`p-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  viewport === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
        <button
          onClick={onToggleDevTools}
          aria-pressed={devToolsOpen}
          aria-label={devToolsOpen ? 'Close DevTools' : 'Open DevTools'}
          title={devToolsOpen ? 'Close DevTools' : 'Open DevTools'}
          className={devToolsOpen ? 'p-1.5 rounded bg-blue-600 text-white shrink-0' : iconButton}
        >
          <Wrench size={14} />
        </button>
        <button
          onClick={() => openInSystemBrowser(url)}
          className={iconButton}
          title="Open in system browser"
          aria-label="Open in system browser"
        >
          <ExternalLink size={14} />
        </button>
        {actions}
        {onHide && (
          <button
            onClick={onHide}
            className="p-1.5 rounded text-gray-400 hover:text-red-300 hover:bg-gray-700 shrink-0"
            title="Close"
            aria-label={closeLabel}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {urlError && (
        <div className="px-2 pb-1.5 flex items-center gap-2 text-red-400 text-xs">
          <AlertCircle className="w-3 h-3" />
          {urlError}
        </div>
      )}
    </div>
  );
}
