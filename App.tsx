import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, Menu, X, GripVertical } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import {
  Sidebar,
  DashboardOverview,
  AppList,
  FavoritesList,
  AppDetail,
  SystemAlerts,
  Recommendations,
  ErrorBoundary,
  AdminPanel,
  AppTabs,
  useAppTabs,
} from './components';
import { useApps } from './hooks';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { generateProjectUrl } from './utils/routing';
import { KeyboardShortcuts } from './types';
import { APP_NAME } from './constants';

type ActiveTab = 'dashboard' | 'apps';

function AppContent() {
  const navigate = useNavigate();
  const params = useParams();
  const projectId = params.projectId;

  const {
    apps,
    loading,
    error: _error,
    selectedAppId,
    selectedApp,
    settings,
    setSelectedAppId,
    handleStartApp,
    handleStopApp,
    handleRestartApp,
    handleAnalyzeApp,
    handleOpenInBrowser,
    handleOpenInFinder,
    handleOpenInTerminal,
    handleToggleFavorite,
    handleToggleArchive,
    handleInstallDeps,
    handleSetPort,
    handleRename,
    handleReorderFavorites,
    handleSetFavoritesSortMode,
    refreshApps,
    runningCount,
    totalCpu,
  } = useApps();

  // App tabs management
  const { tabs, activeTabId, closeTab, reorderTabs, selectTab } = useAppTabs(apps);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Details/Coding view state
  const [detailsViewMode, setDetailsViewMode] = useState<'details' | 'coding'>('details');
  const [isViewTabBarHidden, setIsViewTabBarHidden] = useState(() => {
    const saved = localStorage.getItem('devOrbitViewTabBarHidden');
    return saved === 'true';
  });

  // Sidebar popup state (for keyboard shortcuts)
  const [showFavoritesPopup, setShowFavoritesPopup] = useState(false);
  const [showProjectsPopup, setShowProjectsPopup] = useState(false);

  // Persist view tab bar hidden state
  useEffect(() => {
    localStorage.setItem('devOrbitViewTabBarHidden', String(isViewTabBarHidden));
  }, [isViewTabBarHidden]);

  const handleToggleViewTabBar = useCallback(() => {
    setIsViewTabBarHidden(prev => !prev);
  }, []);

  const handleToggleDetailsView = useCallback(() => {
    setDetailsViewMode(prev => prev === 'details' ? 'coding' : 'details');
  }, []);

  const handleToggleFavoritesPopup = useCallback(() => {
    setShowFavoritesPopup(prev => !prev);
    setShowProjectsPopup(false);
  }, []);

  const handleToggleProjectsPopup = useCallback(() => {
    setShowProjectsPopup(prev => !prev);
    setShowFavoritesPopup(false);
  }, []);

  // Use refs to avoid re-running the effect when callbacks change
  const selectTabRef = useRef(selectTab);
  const setSelectedAppIdRef = useRef(setSelectedAppId);
  const navigateRef = useRef(navigate);

  // Keep refs up to date
  useEffect(() => {
    selectTabRef.current = selectTab;
    setSelectedAppIdRef.current = setSelectedAppId;
    navigateRef.current = navigate;
  }, [selectTab, setSelectedAppId, navigate]);

  // Sync URL params with selected app
  useEffect(() => {
    // Wait for apps to load to avoid race condition
    if (loading) return;

    if (projectId) {
      // Validate that the project exists
      const projectExists = apps.find(app => app.id === projectId);
      if (projectExists) {
        setSelectedAppIdRef.current(projectId);
        selectTabRef.current(projectId);
        setActiveTab('apps');
      } else {
        // Invalid/stale project ID - redirect to dashboard
        navigateRef.current('/', { replace: true });
      }
    } else {
      setActiveTab('dashboard');
    }
  }, [projectId, apps, loading]);

  // Resizable sidebar
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 400;
  const DEFAULT_SIDEBAR_WIDTH = 256; // 16rem = 256px
  const COLLAPSED_SIDEBAR_WIDTH = 64; // Width when collapsed

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('devOrbitSidebarWidth');
    return saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('devOrbitSidebarCollapsed');
    return saved === 'true';
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Persist sidebar width and collapsed state
  useEffect(() => {
    localStorage.setItem('devOrbitSidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('devOrbitSidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Calculate actual sidebar width based on collapsed state
  const actualSidebarWidth = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth;

  const handleToggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleSelectDashboard = () => {
    navigate('/');
    setMobileMenuOpen(false);
  };

  const handleSelectApp = (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (app) {
      navigate(generateProjectUrl(app.name, id));
    }
    setMobileMenuOpen(false);
  };

  const handleTabSelect = (id: string) => {
    selectTab(id); // Update activeTabId for visual sync
    const app = apps.find((a) => a.id === id);
    if (app) {
      navigate(generateProjectUrl(app.name, id));
    }
  };

  const handleTabClose = (id: string) => {
    // Calculate remaining tabs BEFORE calling closeTab to avoid race condition
    // (tabs state won't update until after this function completes)
    const remainingTabs = tabs.filter((t) => t.appId !== id);

    // Close the tab
    closeTab(id);

    // If closing the active tab, switch to dashboard or another tab
    if (selectedAppId === id) {
      if (remainingTabs.length > 0) {
        const nextApp = apps.find((a) => a.id === remainingTabs[remainingTabs.length - 1].appId);
        if (nextApp) {
          navigate(generateProjectUrl(nextApp.name, nextApp.id));
        }
      } else {
        navigate('/');
      }
    }
  };

  // Rename handler that prompts for the new name
  const handleRenamePrompt = useCallback(
    (id: string) => {
      const app = apps.find((a) => a.id === id);
      if (!app) return;

      const newName = window.prompt('Enter new name:', app.name);
      if (newName && newName.trim() && newName !== app.name) {
        handleRename(id, newName.trim());
      }
    },
    [apps, handleRename]
  );

  // Keyboard shortcuts
  const keyboardShortcutActions = useMemo(() => [
    { id: 'toggleSidebar' as keyof KeyboardShortcuts, handler: handleToggleSidebarCollapse },
    { id: 'goToDashboard' as keyof KeyboardShortcuts, handler: () => navigate('/') },
    { id: 'goToDashboardAlt' as keyof KeyboardShortcuts, handler: () => navigate('/') },
    { id: 'openSettings' as keyof KeyboardShortcuts, handler: () => setAdminPanelOpen(true) },
    { id: 'toggleDetailsCoding' as keyof KeyboardShortcuts, handler: handleToggleDetailsView },
    { id: 'openFavorites' as keyof KeyboardShortcuts, handler: handleToggleFavoritesPopup },
    { id: 'openProjects' as keyof KeyboardShortcuts, handler: handleToggleProjectsPopup },
    { id: 'goToTab1' as keyof KeyboardShortcuts, handler: () => tabs[0] && handleTabSelect(tabs[0].appId) },
    { id: 'goToTab2' as keyof KeyboardShortcuts, handler: () => tabs[1] && handleTabSelect(tabs[1].appId) },
    { id: 'goToTab3' as keyof KeyboardShortcuts, handler: () => tabs[2] && handleTabSelect(tabs[2].appId) },
    { id: 'goToTab4' as keyof KeyboardShortcuts, handler: () => tabs[3] && handleTabSelect(tabs[3].appId) },
    { id: 'goToTab5' as keyof KeyboardShortcuts, handler: () => tabs[4] && handleTabSelect(tabs[4].appId) },
    { id: 'goToTab6' as keyof KeyboardShortcuts, handler: () => tabs[5] && handleTabSelect(tabs[5].appId) },
    { id: 'goToTab7' as keyof KeyboardShortcuts, handler: () => tabs[6] && handleTabSelect(tabs[6].appId) },
    { id: 'goToTab8' as keyof KeyboardShortcuts, handler: () => tabs[7] && handleTabSelect(tabs[7].appId) },
    { id: 'goToTab9' as keyof KeyboardShortcuts, handler: () => tabs[8] && handleTabSelect(tabs[8].appId) },
  ], [handleToggleSidebarCollapse, navigate, tabs, handleTabSelect, handleToggleDetailsView, handleToggleFavoritesPopup, handleToggleProjectsPopup]);

  useKeyboardShortcuts({
    shortcuts: settings?.keyboardShortcuts,
    actions: keyboardShortcutActions,
    enabled: !adminPanelOpen, // Disable when admin panel is open
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="animate-spin text-blue-500" size={32} />
          <p className="text-gray-400 font-mono">Scanning directory structure...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gray-900 text-gray-100 font-sans flex overflow-hidden"
      style={{ '--sidebar-width': `${actualSidebarWidth}px` } as React.CSSProperties}
    >
      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#f3f4f6',
            border: '1px solid #374151',
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: '#f3f4f6' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#f3f4f6' },
          },
        }}
      />

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - fixed position, doesn't scroll with content */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50
          transform transition-all duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
        style={{ width: actualSidebarWidth }}
      >
        <Sidebar
          apps={apps}
          selectedAppId={selectedAppId}
          activeTab={activeTab}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebarCollapse}
          onSelectDashboard={handleSelectDashboard}
          onSelectApp={handleSelectApp}
          onToggleFavorite={handleToggleFavorite}
          onToggleArchive={handleToggleArchive}
          onStart={handleStartApp}
          onStop={handleStopApp}
          onRestart={handleRestartApp}
          onOpenInBrowser={handleOpenInBrowser}
          onOpenInFinder={handleOpenInFinder}
          onOpenInTerminal={handleOpenInTerminal}
          onRename={handleRenamePrompt}
          onRefresh={refreshApps}
          onOpenSettings={() => setAdminPanelOpen(true)}
          mainDirectory="Projects"
          keyboardShortcuts={settings?.keyboardShortcuts}
          showViewSwitcher={isViewTabBarHidden}
          detailsViewMode={detailsViewMode}
          onViewModeChange={setDetailsViewMode}
          onShowViewTabBar={handleToggleViewTabBar}
          showFavoritesPopupExternal={showFavoritesPopup}
          showProjectsPopupExternal={showProjectsPopup}
          onFavoritesPopupChange={setShowFavoritesPopup}
          onProjectsPopupChange={setShowProjectsPopup}
        />
        {/* Resize handle - only show when not collapsed */}
        {!sidebarCollapsed && (
          <div
            ref={resizeRef}
            onMouseDown={handleMouseDown}
            className={`
              hidden md:flex absolute top-0 right-0 w-1 h-full cursor-col-resize
              items-center justify-center group
              hover:bg-blue-500/30 transition-colors
              ${isResizing ? 'bg-blue-500/50' : ''}
            `}
          >
            <div
              className={`
              absolute right-0 w-4 h-12 flex items-center justify-center
              rounded-r bg-gray-800/80 border border-l-0 border-gray-700
              opacity-0 group-hover:opacity-100 transition-opacity
              ${isResizing ? 'opacity-100' : ''}
            `}
            >
              <GripVertical size={12} className="text-gray-500" />
            </div>
          </div>
        )}
      </div>

      {/* Main Content - with left margin for fixed sidebar */}
      <main className="flex-1 flex flex-col relative ml-0 md:ml-[var(--sidebar-width)] overflow-auto">
        {/* App Tabs - fixed at top, only show when tabs exist */}
        {tabs.length > 0 && (
          <div className="fixed top-0 right-0 left-0 md:left-[var(--sidebar-width)] z-30 bg-gray-900">
            <AppTabs
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleTabSelect}
              onCloseTab={handleTabClose}
              onReorderTabs={reorderTabs}
            />
          </div>
        )}

        {/* Mobile header - only shown on small screens */}
        <header
          className={`fixed ${tabs.length > 0 ? 'top-10' : 'top-0'} right-0 left-0 z-20 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 flex items-center gap-3 md:hidden`}
        >
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2 text-blue-500 font-bold">
            <LayoutDashboard size={20} /> {APP_NAME}
          </div>
        </header>

        <div
          className={`${activeTab === 'dashboard' ? 'p-4 md:p-8 max-w-7xl mx-auto pb-20' : 'flex-1 flex flex-col min-h-0'} ${tabs.length > 0 ? 'mt-[4rem] md:mt-10' : 'mt-14 md:mt-0'}`}
        >
          {activeTab === 'dashboard' ? (
            <div className="space-y-8 animate-in fade-in duration-500">
              <DashboardOverview
                totalApps={apps.length}
                runningCount={runningCount}
                totalCpu={totalCpu}
                apps={apps}
              />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-200">Application Registry</h3>
                  </div>
                  {/* Favorites Section */}
                  <FavoritesList
                    apps={apps}
                    selectedAppId={selectedAppId}
                    favoritesOrder={settings?.favorites || []}
                    favoritesSortMode={settings?.favoritesSortMode || 'manual'}
                    onSelectApp={handleSelectApp}
                    onStart={handleStartApp}
                    onStop={handleStopApp}
                    onRestart={handleRestartApp}
                    onOpenInBrowser={handleOpenInBrowser}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleArchive={handleToggleArchive}
                    onReorderFavorites={handleReorderFavorites}
                    onSetSortMode={handleSetFavoritesSortMode}
                  />
                  {/* All Applications */}
                  <AppList
                    apps={apps.filter((app) => !app.isArchived && !app.isFavorite)}
                    selectedAppId={selectedAppId}
                    onSelectApp={handleSelectApp}
                    onRefresh={refreshApps}
                    onStart={handleStartApp}
                    onStop={handleStopApp}
                    onRestart={handleRestartApp}
                    onOpenInBrowser={handleOpenInBrowser}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleArchive={handleToggleArchive}
                    onOpenInFinder={handleOpenInFinder}
                    onOpenInTerminal={handleOpenInTerminal}
                    onRename={handleRenamePrompt}
                    mainDirectory="projects"
                  />
                </div>

                <div className="space-y-6">
                  <Recommendations apps={apps} onAnalyzeApp={handleAnalyzeApp} />
                  <SystemAlerts />
                </div>
              </div>
            </div>
          ) : (
            <AppDetail
              app={selectedApp ?? null}
              onStart={handleStartApp}
              onStop={handleStopApp}
              onRestart={handleRestartApp}
              onAnalyze={handleAnalyzeApp}
              onOpenInBrowser={handleOpenInBrowser}
              onInstallDeps={handleInstallDeps}
              onSetPort={handleSetPort}
              onRename={handleRename}
              onToggleFavorite={handleToggleFavorite}
              onToggleArchive={handleToggleArchive}
              onOpenInFinder={handleOpenInFinder}
              onOpenInTerminal={handleOpenInTerminal}
              preferredIDE={(selectedApp && settings?.preferredIDEs?.[selectedApp.id]) || null}
              isViewTabBarHidden={isViewTabBarHidden}
              onToggleViewTabBar={handleToggleViewTabBar}
              activeView={detailsViewMode}
              onViewChange={setDetailsViewMode}
            />
          )}
        </div>
      </main>

      {/* Admin Panel Modal */}
      <AdminPanel
        isOpen={adminPanelOpen}
        onClose={() => setAdminPanelOpen(false)}
        onConfigChange={refreshApps}
      />
    </div>
  );
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/:projectName/:projectId" element={<AppContent />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
