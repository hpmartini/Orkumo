import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Zap,
  Globe,
  Box,
  FolderOpen,
  Package,
  Settings2,
  Check,
  X,
  Pencil,
  Star,
  Archive,
  Terminal,
  Code,
  MoreHorizontal,
  ChevronUp,
} from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import type { PerAppStateHelpers } from '../hooks/usePerAppState';
import { StatusBadge } from './StatusBadge';
import { PerformanceCharts } from './PerformanceCharts';
import { XTerminal } from './XTerminal';
import { IDESelector } from './IDESelector';
import { CodingView } from './CodingView';
import { DockerControls } from './DockerControls';

interface AppDetailProps {
  app: AppConfig | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onAnalyze: (id: string) => void;
  onOpenInBrowser: (id: string) => void;
  onInstallDeps?: (id: string) => void;
  onSetPort?: (id: string, port: number) => void;
  onSetCommand?: (id: string, command: string | null) => void;
  onRename?: (id: string, newName: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onOpenInFinder?: (id: string) => void;
  onOpenInTerminal?: (id: string) => void;
  preferredIDE?: string | null;
  // View tab bar control
  isViewTabBarHidden?: boolean;
  onToggleViewTabBar?: () => void;
  activeView?: ViewMode;
  onViewChange?: (view: ViewMode) => void;
  // Per-app state (terminals, editor, devtools)
  perAppState?: PerAppStateHelpers;
}

export type ViewMode = 'details' | 'coding';

export const AppDetail: React.FC<AppDetailProps> = ({
  app,
  onStart,
  onStop,
  onRestart,
  onAnalyze,
  onOpenInBrowser,
  onInstallDeps,
  onSetPort,
  onSetCommand,
  onRename,
  onToggleFavorite,
  onToggleArchive,
  onOpenInFinder,
  onOpenInTerminal,
  preferredIDE,
  isViewTabBarHidden = false,
  onToggleViewTabBar,
  activeView: controlledActiveView,
  onViewChange,
  perAppState,
}) => {
  // Use controlled or uncontrolled view mode
  const [internalActiveView, setInternalActiveView] = useState<ViewMode>('details');
  const activeView = controlledActiveView ?? internalActiveView;
  const setActiveView = useCallback(
    (view: ViewMode) => {
      if (onViewChange) {
        onViewChange(view);
      } else {
        setInternalActiveView(view);
      }
    },
    [onViewChange]
  );
  const [showPortEditor, setShowPortEditor] = useState(false);
  const [portValue, setPortValue] = useState('');
  const [showCommandEditor, setShowCommandEditor] = useState(false);
  const [commandValue, setCommandValue] = useState('');
  const [showNameEditor, setShowNameEditor] = useState(false);
  const [nameValue, setNameValue] = useState('');

  // Ref for the single terminal container that holds the XTerminal
  // This container is positioned absolutely and moved between views using CSS
  const terminalWrapperRef = useRef<HTMLDivElement>(null);

  // Refs for position targets in Details and Coding views
  const detailsTerminalSlotRef = useRef<HTMLDivElement>(null);
  const codingTerminalSlotRef = useRef<HTMLDivElement>(null);

  // Position the terminal wrapper based on active view
  useEffect(() => {
    const wrapper = terminalWrapperRef.current;
    if (!wrapper) return;

    const targetSlot =
      activeView === 'details' ? detailsTerminalSlotRef.current : codingTerminalSlotRef.current;

    if (targetSlot) {
      // Move the wrapper element into the target slot
      targetSlot.appendChild(wrapper);
    }
  }, [activeView]);

  if (!app) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 h-[60vh]">
        <Box size={48} className="mb-4 opacity-20" />
        <p>Select an application to view details</p>
      </div>
    );
  }

  const isLoading =
    app.status === AppStatus.STARTING ||
    app.status === AppStatus.ANALYZING ||
    app.status === AppStatus.RESTARTING;

  const canStart =
    app.status === AppStatus.STOPPED ||
    app.status === AppStatus.ERROR ||
    app.status === AppStatus.CANCELLED;

  const canStop = app.status === AppStatus.RUNNING;

  const canAnalyze =
    app.status !== AppStatus.RUNNING &&
    app.status !== AppStatus.ANALYZING &&
    app.status !== AppStatus.STARTING;

  const canInstall = app.status === AppStatus.STOPPED || app.status === AppStatus.ERROR;

  const handlePortSubmit = () => {
    const port = parseInt(portValue, 10);
    if (port && port > 0 && port < 65536 && onSetPort) {
      onSetPort(app.id, port);
      setShowPortEditor(false);
      setPortValue('');
    }
  };

  const handleCommandSubmit = () => {
    const trimmedCommand = commandValue.trim();
    if (onSetCommand) {
      onSetCommand(app.id, trimmedCommand || null);
      setShowCommandEditor(false);
      setCommandValue('');
    }
  };

  const handleNameSubmit = () => {
    const trimmedName = nameValue.trim();
    if (trimmedName && trimmedName !== app.name && onRename) {
      onRename(app.id, trimmedName);
      setShowNameEditor(false);
      setNameValue('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* View Switcher Tabs */}
      {!isViewTabBarHidden && (
        <div
          className="flex items-center justify-center border-b border-gray-700 bg-gray-850 relative"
          role="tablist"
          aria-label="Application view switcher"
        >
          <div className="flex">
            <button
              onClick={() => setActiveView('details')}
              role="tab"
              aria-selected={activeView === 'details'}
              aria-controls="details-panel"
              className={`px-6 py-2.5 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${
                activeView === 'details'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveView('coding')}
              role="tab"
              aria-selected={activeView === 'coding'}
              aria-controls="coding-panel"
              className={`px-6 py-2.5 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${
                activeView === 'coding'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Coding
            </button>
          </div>
          {onToggleViewTabBar && (
            <button
              onClick={onToggleViewTabBar}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Hide tab bar (press C to toggle views)"
            >
              <ChevronUp size={16} />
            </button>
          )}
        </div>
      )}

      {/* View Content - Both views are always mounted, visibility controlled by CSS */}
      <div className="flex-1 overflow-hidden relative">
        {/* Details View */}
        <div
          id="details-panel"
          role="tabpanel"
          aria-labelledby="details-tab"
          className={`space-y-6 p-6 max-w-7xl mx-auto h-full overflow-auto ${
            activeView === 'details' ? 'block' : 'hidden'
          }`}
        >
          {/* Header */}
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-3">
                {/* App Name & Status */}
                <div className="flex items-center gap-3">
                  {showNameEditor ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleNameSubmit();
                          if (e.key === 'Escape') setShowNameEditor(false);
                        }}
                        placeholder={app.name}
                        className="text-2xl font-bold bg-gray-900 border border-gray-600 rounded-lg px-3 py-1 text-white focus:outline-none focus:border-blue-500 w-64"
                        autoFocus
                      />
                      <button
                        onClick={handleNameSubmit}
                        className="p-2 text-emerald-400 hover:bg-gray-700 rounded-lg transition-colors"
                        title="Save"
                      >
                        <Check size={20} />
                      </button>
                      <button
                        onClick={() => {
                          setShowNameEditor(false);
                          setNameValue('');
                        }}
                        className="p-2 text-gray-400 hover:bg-gray-700 rounded-lg transition-colors"
                        title="Cancel"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ) : (
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3 group">
                      {app.name}
                      {onRename && (
                        <button
                          onClick={() => {
                            setNameValue(app.name);
                            setShowNameEditor(true);
                          }}
                          className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Rename application"
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </h1>
                  )}
                  <StatusBadge status={app.status} />
                  {onToggleFavorite && (
                    <button
                      onClick={() => onToggleFavorite(app.id)}
                      className={`p-1.5 rounded-lg transition-all ${
                        app.isFavorite
                          ? 'text-yellow-400 hover:bg-yellow-500/20'
                          : 'text-gray-500 hover:text-yellow-400 hover:bg-gray-700'
                      }`}
                      title={app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Star size={20} fill={app.isFavorite ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </div>

                {/* Directory Path */}
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <FolderOpen size={16} className="text-blue-400 shrink-0" />
                  <span
                    className="font-mono bg-gray-900/50 px-2 py-0.5 rounded truncate max-w-md"
                    title={app.path}
                  >
                    {app.path}
                  </span>
                </div>

                {/* Technology/Framework */}
                {app.detectedFramework && (
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Package size={16} className="text-purple-400 shrink-0" />
                    <span>{app.detectedFramework}</span>
                  </div>
                )}

                {/* Start Command */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">Command:</span>
                  {showCommandEditor ? (
                    <div className="flex items-center gap-1 flex-1 max-w-md">
                      <input
                        type="text"
                        value={commandValue}
                        onChange={(e) => setCommandValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCommandSubmit();
                          if (e.key === 'Escape') setShowCommandEditor(false);
                        }}
                        placeholder={app.startCommand || 'npm run dev'}
                        className="flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm font-mono text-white focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={handleCommandSubmit}
                        className="p-1 text-emerald-400 hover:bg-gray-700 rounded"
                        title="Save"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setShowCommandEditor(false)}
                        className="p-1 text-gray-400 hover:bg-gray-700 rounded"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setCommandValue(app.startCommand || 'npm run dev');
                        setShowCommandEditor(true);
                      }}
                      disabled={!onSetCommand}
                      className="flex items-center gap-1 text-gray-300 text-sm font-mono bg-gray-900/50 px-2 py-0.5 rounded hover:bg-gray-900 transition-colors disabled:cursor-default disabled:hover:bg-gray-900/50 group"
                      title={onSetCommand ? 'Click to edit command' : undefined}
                    >
                      {app.startCommand || 'npm run dev'}
                      {onSetCommand && (
                        <Settings2
                          size={12}
                          className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      )}
                    </button>
                  )}
                </div>

                {/* Port & Addresses */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs">Port:</span>
                    {showPortEditor ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={portValue}
                          onChange={(e) => setPortValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handlePortSubmit();
                            if (e.key === 'Escape') setShowPortEditor(false);
                          }}
                          placeholder={String(app.port || 3000)}
                          className="w-20 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-blue-500"
                          min="1"
                          max="65535"
                          autoFocus
                        />
                        <button
                          onClick={handlePortSubmit}
                          className="p-1 text-emerald-400 hover:bg-gray-700 rounded"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setShowPortEditor(false)}
                          className="p-1 text-gray-400 hover:bg-gray-700 rounded"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setPortValue(String(app.port || 3000));
                          setShowPortEditor(true);
                        }}
                        className="flex items-center gap-1 text-cyan-400 font-mono text-sm hover:text-cyan-300 transition-colors"
                        title="Click to change port"
                      >
                        {app.port || 3000}
                        <Settings2 size={12} className="opacity-50" />
                      </button>
                    )}
                  </div>
                  {app.addresses && app.addresses.length > 0 && (
                    <span className="text-gray-500 text-xs">({app.addresses.join(', ')})</span>
                  )}
                </div>
              </div>

              {/* Action Buttons - Option 1: Primary + Overflow Menu */}
              <div className="flex gap-2 flex-wrap items-center">
                {/* Primary Actions */}
                {canStop ? (
                  <button
                    onClick={() => onStop(app.id)}
                    className="flex items-center justify-center gap-2 px-4 h-10 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-all"
                  >
                    <Square size={18} fill="currentColor" /> Stop
                  </button>
                ) : (
                  <>
                    {/* Run and Code button - starts app and switches to coding view */}
                    <button
                      onClick={() => {
                        onStart(app.id);
                        setActiveView('coding');
                      }}
                      disabled={!canStart || isLoading}
                      className="flex items-center justify-center gap-2 px-4 h-10 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Start app and switch to coding view"
                    >
                      {isLoading ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <>
                          <Play size={16} fill="currentColor" />
                          <Code size={16} />
                        </>
                      )}
                      <span className="hidden sm:inline">Run & Code</span>
                    </button>
                    <button
                      onClick={() => onStart(app.id)}
                      disabled={!canStart || isLoading}
                      className="flex items-center justify-center gap-2 px-4 h-10 bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <Play size={18} fill="currentColor" />
                      )}
                      {app.status === AppStatus.STARTING ? 'Starting...' : 'Run'}
                    </button>
                  </>
                )}

                <button
                  onClick={() => onRestart(app.id)}
                  disabled={app.status !== AppStatus.RUNNING}
                  className="flex items-center justify-center gap-2 px-3 h-10 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Restart application"
                >
                  <RefreshCw size={18} />
                </button>

                {/* Toggle Code View - positioned between restart and install */}
                <button
                  onClick={() => setActiveView(activeView === 'coding' ? 'details' : 'coding')}
                  className="flex items-center justify-center gap-2 px-3 h-10 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg transition-all"
                  title={activeView === 'coding' ? 'Switch to Details view' : 'Switch to Code view'}
                >
                  <Code size={18} />
                  <span className="hidden sm:inline">
                    {activeView === 'coding' ? 'Details' : 'Code'}
                  </span>
                </button>

                {onInstallDeps && (
                  <button
                    onClick={() => onInstallDeps(app.id)}
                    disabled={!canInstall}
                    className="flex items-center justify-center gap-2 px-3 h-10 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Install dependencies (npm install)"
                  >
                    <Package size={18} />
                    <span className="hidden sm:inline">Install</span>
                  </button>
                )}

                <button
                  onClick={() => onAnalyze(app.id)}
                  disabled={!canAnalyze}
                  className="flex items-center justify-center gap-2 px-3 h-10 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
                  title="Use AI to detect config"
                >
                  {app.status === AppStatus.ANALYZING ? (
                    <RefreshCw className="animate-spin" size={18} />
                  ) : (
                    <Zap size={18} />
                  )}
                  <span className="hidden sm:inline">AI Config</span>
                </button>

                <button
                  onClick={() => onOpenInBrowser(app.id)}
                  disabled={app.status !== AppStatus.RUNNING}
                  className="flex items-center justify-center gap-2 px-3 h-10 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
                  title="Open in browser"
                >
                  <Globe size={18} />
                </button>

                {/* More Menu - Secondary Actions in overflow */}
                <div className="flex items-center">
                  <MoreActionsMenu
                    appId={app.id}
                    preferredIDE={preferredIDE}
                    isArchived={app.isArchived}
                    onOpenInFinder={onOpenInFinder}
                    onOpenInTerminal={onOpenInTerminal}
                    onToggleArchive={onToggleArchive}
                  />
                </div>
              </div>
            </div>

            {/* AI Analysis Result */}
            {app.aiAnalysis && (
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-3">
                <Zap className="text-blue-400 shrink-0 mt-0.5" size={16} />
                <p className="text-sm text-blue-200">{app.aiAnalysis}</p>
              </div>
            )}
          </div>

          {/* Performance Charts */}
          <PerformanceCharts cpuHistory={app.stats.cpu} memoryHistory={app.stats.memory} />

          {/* Docker Controls - shown for docker-compose projects */}
          {app.type === 'docker-compose' && (
            <DockerControls appId={app.id} dockerComposeFile={app.dockerComposeFile} />
          )}

          {/* Terminal slot for Details view - the terminal wrapper will be moved here */}
          <div ref={detailsTerminalSlotRef} className="h-[400px]" />
        </div>

        {/* Coding View - Always mounted, hidden when not active */}
        <div
          id="coding-panel"
          role="tabpanel"
          aria-labelledby="coding-tab"
          className={`absolute inset-0 ${activeView === 'coding' ? 'block' : 'hidden'}`}
        >
          <CodingView
            app={app}
            terminalSlotRef={codingTerminalSlotRef}
            editorType={perAppState?.editorType}
            onEditorTypeChange={perAppState?.setEditorType}
            showDevTools={perAppState?.showDevTools}
            onShowDevToolsChange={perAppState?.setShowDevTools}
            devToolsTab={perAppState?.devToolsTab}
            onDevToolsTabChange={perAppState?.setDevToolsTab}
            consoleFilter={perAppState?.consoleFilter}
            onConsoleFilterChange={perAppState?.setConsoleFilter}
            isBrowserHidden={perAppState?.isBrowserHidden}
            onBrowserHiddenChange={perAppState?.setIsBrowserHidden}
            isTerminalHidden={perAppState?.isTerminalHidden}
            onTerminalHiddenChange={perAppState?.setIsTerminalHidden}
            onStart={() => onStart(app.id)}
            onStop={() => onStop(app.id)}
            onRestart={() => onRestart(app.id)}
            onSwitchToDetails={() => setActiveView('details')}
          />
        </div>

        {/* Single XTerminal instance wrapper - moves between view slots via DOM manipulation */}
        <div ref={terminalWrapperRef} className="h-full">
          <XTerminal
            logs={app.logs}
            isRunning={app.status === AppStatus.RUNNING}
            cwd={app.path}
            sharedState={
              perAppState
                ? {
                    tabs: perAppState.terminalTabs,
                    activeTabId: perAppState.activeTerminalTabId,
                    showLogsTab: perAppState.showLogsTab,
                  }
                : undefined
            }
            sharedActions={
              perAppState
                ? {
                    setTabs: perAppState.setTerminalTabs,
                    setActiveTabId: perAppState.setActiveTerminalTabId,
                    setShowLogsTab: perAppState.setShowLogsTab,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
};

// More Actions Menu Component for overflow actions
interface MoreActionsMenuProps {
  appId: string;
  preferredIDE?: string | null;
  isArchived?: boolean;
  onOpenInFinder?: (id: string) => void;
  onOpenInTerminal?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
}

const MoreActionsMenu: React.FC<MoreActionsMenuProps> = ({
  appId,
  preferredIDE,
  isArchived,
  onOpenInFinder,
  onOpenInTerminal,
  onToggleArchive,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showIDESelector, setShowIDESelector] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowIDESelector(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center gap-2 px-3 h-10 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all"
        title="More actions"
      >
        <MoreHorizontal size={18} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
          {onOpenInFinder && (
            <button
              onClick={() => {
                onOpenInFinder(appId);
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              <FolderOpen size={16} />
              Open in Finder
            </button>
          )}

          {onOpenInTerminal && (
            <button
              onClick={() => {
                onOpenInTerminal(appId);
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              <Terminal size={16} />
              Open in Terminal
            </button>
          )}

          <button
            onClick={() => {
              setShowIDESelector(!showIDESelector);
            }}
            className="w-full px-3 py-2 text-left flex items-center gap-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <Code size={16} />
            Open in IDE
          </button>

          {showIDESelector && (
            <div className="px-2 py-2 border-t border-gray-700">
              <IDESelector
                appId={appId}
                preferredIDE={preferredIDE}
                onSuccess={() => {
                  setIsOpen(false);
                  setShowIDESelector(false);
                }}
              />
            </div>
          )}

          {onToggleArchive && (
            <>
              <div className="my-1 border-t border-gray-700" />
              <button
                onClick={() => {
                  onToggleArchive(appId);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <Archive size={16} />
                {isArchived ? 'Unarchive' : 'Archive'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
