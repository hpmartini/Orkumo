import { useState, useEffect, useCallback, useRef } from 'react';
import { LayoutDashboard, RefreshCw, Settings, Menu, X, GripVertical } from 'lucide-react';
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

type ActiveTab = 'dashboard' | 'apps';

function AppContent() {
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
    refreshApps,
    runningCount,
    totalCpu,
  } = useApps();

  // App tabs management
  const { tabs, activeTabId, closeTab, reorderTabs, selectTab } = useAppTabs(apps);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Resizable sidebar
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 400;
  const DEFAULT_SIDEBAR_WIDTH = 256; // 16rem = 256px

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('devOrbitSidebarWidth');
    return saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('devOrbitSidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

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
    setActiveTab('dashboard');
    setSelectedAppId(null);
    setMobileMenuOpen(false);
  };

  const handleSelectApp = (id: string) => {
    setSelectedAppId(id);
    selectTab(id); // Also open as tab
    setActiveTab('apps');
    setMobileMenuOpen(false);
  };

  const handleTabSelect = (id: string) => {
    selectTab(id); // Update activeTabId for visual sync
    setSelectedAppId(id);
    setActiveTab('apps');
  };

  const handleTabClose = (id: string) => {
    closeTab(id);
    // If closing the active tab, switch to dashboard or another tab
    if (selectedAppId === id) {
      const remainingTabs = tabs.filter((t) => t.appId !== id);
      if (remainingTabs.length > 0) {
        setSelectedAppId(remainingTabs[remainingTabs.length - 1].appId);
      } else {
        setSelectedAppId(null);
        setActiveTab('dashboard');
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
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
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
          transform transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
        style={{ width: sidebarWidth }}
      >
        <Sidebar
          apps={apps}
          selectedAppId={selectedAppId}
          activeTab={activeTab}
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
          mainDirectory="Projects"
        />
        {/* Resize handle */}
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

        <header
          className={`fixed ${tabs.length > 0 ? 'top-10' : 'top-0'} right-0 left-0 md:left-[var(--sidebar-width)] z-20 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 px-4 md:px-8 py-4 flex items-center justify-between`}
        >
          <div className="md:hidden flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center gap-2 text-blue-500 font-bold">
              <LayoutDashboard size={20} /> DevOrbit
            </div>
          </div>

          <h2 className="text-xl font-semibold text-white hidden md:block">
            {activeTab === 'dashboard' ? 'System Overview' : 'Application Details'}
          </h2>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full border border-gray-700">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-mono text-gray-400">Daemon Active</span>
            </div>
            <button
              onClick={() => setAdminPanelOpen(true)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
              title="Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <div
          className={`${activeTab === 'dashboard' ? 'p-4 md:p-8 max-w-7xl mx-auto pb-20' : 'flex-1 flex flex-col min-h-0'} ${tabs.length > 0 ? 'mt-[6.5rem]' : 'mt-16'}`}
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
                    onSelectApp={handleSelectApp}
                    onStart={handleStartApp}
                    onStop={handleStopApp}
                    onRestart={handleRestartApp}
                    onOpenInBrowser={handleOpenInBrowser}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleArchive={handleToggleArchive}
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
