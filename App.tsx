import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Routes,
  Route,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router-dom';
import { isElectron } from './utils/apiConfig';
import { Bot, Rocket } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import {
  DashboardOverview,
  AppList,
  FavoritesList,
  AppDetail,
  SystemHealth,
  Recommendations,
  ErrorBoundary,
  AdminPanel,
  TitleBar,
  ContextDialog,
  LoadingSkeleton,
  AgentsView,
} from './components';
import { ModuleSlot } from './components/ModuleSlot';
import { useApps, usePerAppState } from './hooks';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjectContexts, ROUTE_KEY } from './hooks/useProjectContexts';
import { CommandPaletteProvider, useRegisterCommands } from './components/CommandPalette';
import type { PaletteCommand } from './utils/commandPalette';
import { generateProjectUrl } from './utils/routing';
import { fetchConfig } from './services/api';
import { KeyboardShortcuts } from './types';

import { BoardView } from './components/BoardView';
import { WorkflowView } from './components/WorkflowView';
import { CodeView } from './components/CodeView';

type ActiveTab = 'dashboard' | 'apps' | 'agents' | 'board' | 'code' | 'workflows' | 'pulls';

function AppContent() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const projectId = params.projectId;
  const isDashboardRoute = location.pathname === '/dashboard';
  const isBoardRoute = location.pathname === '/board';
  const isCodeRoute = location.pathname === '/code';
  const isWorkflowsRoute = location.pathname === '/workflows';
  const isPullsRoute = location.pathname === '/pulls';

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
    handleSetCommand,
    handleRename,
    handleReorderFavorites,
    handleSetFavoritesSortMode,
    refreshApps,
    runningCount,
    totalCpu,
  } = useApps();

  // Project contexts (#97): title bar tabs, each with its own favorites, board slices, agent tabs
  const contexts = useProjectContexts(refreshApps);
  const { contexts: contextList, switchTo: switchContext } = contexts;
  const contextAppIds = contexts.active?.appIds;
  const contextApps = useMemo(() => {
    if (!contextAppIds) return apps;
    const members = new Set(contextAppIds);
    return apps.filter((app) => members.has(app.id));
  }, [apps, contextAppIds]);
  // Configured project directories (admin panel): context dialog and tabs cluster by them
  const [projectDirs, setProjectDirs] = useState<string[]>([]);
  const loadProjectDirs = useCallback(() => {
    fetchConfig()
      .then((c) => setProjectDirs(c.directories))
      .catch(() => setProjectDirs([]));
  }, []);
  useEffect(loadProjectDirs, [loadProjectDirs]);
  // Context id being edited in the dialog; 'new' creates one
  const [editingContext, setEditingContext] = useState<string | null>(null);

  // Per-app view state management (terminals, editor type, devtools, etc.)
  const { createAppStateHelpers, getAppState, updateAppState } = usePerAppState();

  const [activeTab, setActiveTab] = useState<ActiveTab>('agents');
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  // Details/Coding view state
  const [detailsViewMode, setDetailsViewMode] = useState<'details' | 'coding'>('details');
  const [isViewTabBarHidden, setIsViewTabBarHidden] = useState(() => {
    const saved = localStorage.getItem('devOrbitViewTabBarHidden');
    return saved === 'true';
  });

  // Persist view tab bar hidden state
  useEffect(() => {
    localStorage.setItem('devOrbitViewTabBarHidden', String(isViewTabBarHidden));
  }, [isViewTabBarHidden]);

  const handleToggleViewTabBar = useCallback(() => {
    setIsViewTabBarHidden((prev) => !prev);
  }, []);

  const handleToggleDetailsView = useCallback(() => {
    setDetailsViewMode((prev) => (prev === 'details' ? 'coding' : 'details'));
  }, []);

  // Use refs to avoid re-running the effect when callbacks change
  const setSelectedAppIdRef = useRef(setSelectedAppId);
  const navigateRef = useRef(navigate);

  // Keep refs up to date
  useEffect(() => {
    setSelectedAppIdRef.current = setSelectedAppId;
    navigateRef.current = navigate;
  }, [setSelectedAppId, navigate]);

  // Sync URL params with selected app
  useEffect(() => {
    // Wait for apps to load to avoid race condition
    if (loading) return;

    if (projectId) {
      // Validate that the project exists
      const projectExists = apps.find((app) => app.id === projectId);
      if (projectExists) {
        setSelectedAppIdRef.current(projectId);
        setActiveTab('apps');
      } else {
        // Invalid/stale project ID - back to the default view
        navigateRef.current('/agents', { replace: true });
      }
    } else {
      setActiveTab(
        isDashboardRoute
          ? 'dashboard'
          : isBoardRoute
            ? 'board'
            : isCodeRoute
              ? 'code'
              : isWorkflowsRoute
                ? 'workflows'
                : isPullsRoute
                  ? 'pulls'
                  : 'agents'
      );
    }
  }, [
    projectId,
    apps,
    loading,
    isDashboardRoute,
    isBoardRoute,
    isCodeRoute,
    isWorkflowsRoute,
    isPullsRoute,
  ]);

  // Each context keeps its own route (#97): it is parked with the context's ui on a switch
  const route = location.pathname + location.search;
  useEffect(() => {
    try {
      localStorage.setItem(ROUTE_KEY, route);
    } catch {
      // storage unavailable: the route just isn't remembered per context
    }
  }, [route]);
  const activeContextId = contexts.active?.id;
  const prevContextId = useRef(activeContextId);
  useEffect(() => {
    const prev = prevContextId.current;
    prevContextId.current = activeContextId;
    if (!prev || !activeContextId || prev === activeContextId) return;
    let target: string | null = null;
    try {
      target = localStorage.getItem(ROUTE_KEY);
    } catch {
      // storage unavailable: fall back to the agents view
    }
    navigateRef.current(target || '/agents');
  }, [activeContextId]);

  const handleSelectDashboard = () => navigate('/dashboard');
  // Stable: AgentsView's attach callbacks depend on it
  const openAgentsView = useCallback(() => navigate('/agents'), [navigate]);

  const handleSelectApp = (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (app) {
      navigate(generateProjectUrl(app.name, id));
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
  const keyboardShortcutActions = useMemo(
    () => [
      { id: 'goToDashboard' as keyof KeyboardShortcuts, handler: handleSelectDashboard },
      { id: 'goToDashboardAlt' as keyof KeyboardShortcuts, handler: handleSelectDashboard },
      { id: 'openSettings' as keyof KeyboardShortcuts, handler: () => setAdminPanelOpen(true) },
      { id: 'openSettingsAlt' as keyof KeyboardShortcuts, handler: () => setAdminPanelOpen(true) },
      { id: 'toggleDetailsCoding' as keyof KeyboardShortcuts, handler: handleToggleDetailsView },
      { id: 'openAgents' as keyof KeyboardShortcuts, handler: () => navigate('/agents') },
      // Cmd+1..9 switch to the n-th context
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `goToTab${i + 1}` as keyof KeyboardShortcuts,
        handler: () => contextList[i] && switchContext(contextList[i].id),
      })),
      // App control shortcuts
      {
        id: 'startApp' as keyof KeyboardShortcuts,
        handler: () => {
          if (selectedAppId) {
            toast.promise(handleStartApp(selectedAppId), {
              loading: 'Starting...',
              success: 'App started',
              error: 'Failed to start',
            });
          } else {
            toast('Select an app first', { icon: 'ℹ️' });
          }
        },
      },
      {
        id: 'stopApp' as keyof KeyboardShortcuts,
        handler: () => {
          if (selectedAppId) {
            toast.promise(handleStopApp(selectedAppId), {
              loading: 'Stopping...',
              success: 'App stopped',
              error: 'Failed to stop',
            });
          } else {
            toast('Select an app first', { icon: 'ℹ️' });
          }
        },
      },
      {
        id: 'restartApp' as keyof KeyboardShortcuts,
        handler: () => {
          if (selectedAppId) {
            toast.promise(handleRestartApp(selectedAppId), {
              loading: 'Restarting...',
              success: 'App restarted',
              error: 'Failed to restart',
            });
          } else {
            toast('Select an app first', { icon: 'ℹ️' });
          }
        },
      },
    ],
    [
      navigate,
      contextList,
      switchContext,
      handleToggleDetailsView,
      selectedAppId,
      handleStartApp,
      handleStopApp,
      handleRestartApp,
    ]
  );

  useKeyboardShortcuts({
    shortcuts: settings?.keyboardShortcuts,
    actions: keyboardShortcutActions,
    enabled: !adminPanelOpen, // Disable when admin panel is open
  });

  // Command palette (Cmd/Ctrl+P). Agent-specific commands are registered by AgentsView.
  const onAppsPage = !!selectedAppId && !!projectId;
  const runOnSelected = (
    action: (id: string) => Promise<unknown>,
    messages: { loading: string; success: string; error: string }
  ) => {
    if (selectedAppId) toast.promise(action(selectedAppId), messages);
  };
  const command = (
    id: string,
    title: string,
    group: string,
    run: () => void,
    keywords?: string
  ): PaletteCommand => ({ id: `app.${id}`, title, group, scope: 'command', keywords, run });
  const appCommand = (verb: string, past: string, action: (id: string) => Promise<unknown>) => () =>
    runOnSelected(action, {
      loading: `${verb}...`,
      success: `App ${past}`,
      error: `Failed to ${verb.toLowerCase()}`,
    });
  const paletteCommands: PaletteCommand[] = [
    command('dashboard', 'Go to dashboard', 'Navigate', handleSelectDashboard, 'home overview'),
    command('agents', 'Open agents view', 'Navigate', () => navigate('/agents'), 'claude sessions'),
    command(
      'board',
      'Open board',
      'Navigate',
      () => navigate('/board'),
      'issues kanban github project'
    ),
    command('code', 'Open code mode', 'Navigate', () => navigate('/code'), 'ide vscode editor'),
    command(
      'workflows',
      'Open workflows',
      'Navigate',
      () => navigate('/workflows'),
      'mw martini pipeline orchestrate go stages'
    ),
    command('settings', 'Open settings', 'Navigate', () => setAdminPanelOpen(true), 'admin'),
    ...(onAppsPage
      ? [
          command('coding', 'Toggle details / coding view', 'View', handleToggleDetailsView),
          command('tabbar', 'Show / hide view tab bar', 'View', handleToggleViewTabBar),
          command(
            'start',
            'Start selected app',
            'App',
            appCommand('Start', 'started', handleStartApp)
          ),
          command('stop', 'Stop selected app', 'App', appCommand('Stop', 'stopped', handleStopApp)),
          command(
            'restart',
            'Restart selected app',
            'App',
            appCommand('Restart', 'restarted', handleRestartApp)
          ),
        ]
      : []),
    ...contexts.contexts.map((c) =>
      command(`context.${c.id}`, `Switch to context: ${c.name}`, 'Context', () =>
        contexts.switchTo(c.id)
      )
    ),
    command('context.new', 'New context', 'Context', () => setEditingContext('new')),
    ...contextApps
      .filter((a) => !a.isArchived)
      .map(
        (a): PaletteCommand => ({
          id: `project.${a.id}`,
          title: a.name,
          group: 'Project',
          scope: 'project',
          run: () => handleSelectApp(a.id),
        })
      ),
  ];
  useRegisterCommands('app', paletteCommands);

  if (loading || !contexts.ready) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex overflow-hidden">
      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#344a7b',
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

      {/* TitleBar - custom titlebar with tabs and pane controls */}
      <TitleBar
        onOpenDashboard={handleSelectDashboard}
        contexts={contexts.contexts}
        activeId={contexts.active?.id ?? null}
        onSelect={contexts.switchTo}
        onReorder={contexts.reorder}
        onEdit={setEditingContext}
        onCreate={() => setEditingContext('new')}
        apps={apps}
        projectDirs={projectDirs}
        showPaneControls={activeTab === 'apps' && detailsViewMode === 'coding' && !!selectedAppId}
        isTerminalVisible={selectedAppId ? !getAppState(selectedAppId).isTerminalHidden : true}
        isBrowserVisible={selectedAppId ? !getAppState(selectedAppId).isBrowserHidden : true}
        onToggleTerminal={() => {
          if (selectedAppId) {
            const current = getAppState(selectedAppId).isTerminalHidden;
            updateAppState(selectedAppId, { isTerminalHidden: !current });
          }
        }}
        onToggleBrowser={() => {
          if (selectedAppId) {
            const current = getAppState(selectedAppId).isBrowserHidden;
            updateAppState(selectedAppId, { isBrowserHidden: !current });
          }
        }}
      />

      {/* One shell: the agents rail on every route; the other views fill its main area */}
      <main className="flex-1 flex flex-col relative overflow-hidden mt-10">
        {/* Small screens: the agents page is the rail, so other views need a way back to it */}
        {activeTab !== 'agents' && (
          <header className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900">
            <button
              onClick={() => navigate('/agents')}
              className="flex items-center gap-2 px-2 py-1 rounded text-sm text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <Bot size={16} /> Agents
            </button>
            {activeTab !== 'dashboard' && (
              <button
                onClick={handleSelectDashboard}
                className="flex items-center gap-2 px-2 py-1 rounded text-sm text-gray-300 hover:text-white hover:bg-gray-800"
              >
                <Rocket size={16} /> Dashboard
              </button>
            )}
          </header>
        )}

        <div className="flex-1 min-h-0 relative">
          {/* Always mounted so attached terminals survive navigation */}
          <div className="absolute inset-0 flex flex-col min-h-0">
            {/* Not keyed by context: that would remount the views below (Web-IDE, terminals) */}
            <AgentsView
              contextId={contexts.active?.id}
              contextAppIds={contextAppIds}
              active={activeTab === 'agents'}
              apps={apps}
              onExit={handleSelectDashboard}
              pullsActive={activeTab === 'pulls'}
              onOpenView={openAgentsView}
              nav={{
                onOpenDashboard: handleSelectDashboard,
                onOpenWorkflows: () => navigate('/workflows'),
                onOpenSettings: () => setAdminPanelOpen(true),
                onOpenProject: handleSelectApp,
                onStartApp: handleStartApp,
                onStopApp: handleStopApp,
              }}
            >
              {/* Dashboard: the start view behind the rocket and the agents icon */}
              <div
                className={activeTab === 'dashboard' ? 'absolute inset-0 overflow-auto' : 'hidden'}
              >
                <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20 space-y-8 animate-in fade-in duration-500">
                  <DashboardOverview
                    totalApps={contextApps.length}
                    runningCount={runningCount}
                    totalCpu={totalCpu}
                    apps={contextApps}
                  />
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-200">
                          Application Registry
                        </h3>
                      </div>
                      {/* Favorites Section */}
                      <FavoritesList
                        apps={contextApps}
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
                        apps={contextApps.filter((app) => !app.isArchived && !app.isFavorite)}
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
                      <Recommendations apps={contextApps} onAnalyzeApp={handleAnalyzeApp} />
                      <SystemHealth
                        onRestartApp={handleRestartApp}
                        onInstallDeps={handleInstallDeps}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Agent task board - kept mounted like the agents view, polls only while active */}
              <div
                className={
                  activeTab === 'board' ? 'absolute inset-0 z-10 flex flex-col min-h-0' : 'hidden'
                }
                aria-hidden={activeTab !== 'board'}
              >
                <BoardView
                  key={contexts.active?.id}
                  active={activeTab === 'board'}
                  contextFilter={contexts.active?.boardFilter}
                />
              </div>

              {/* Code mode - kept mounted so the Web-IDE iframe survives navigation */}
              <div
                className={
                  activeTab === 'code' ? 'absolute inset-0 z-10 flex flex-col min-h-0' : 'hidden'
                }
                aria-hidden={activeTab !== 'code'}
              >
                <CodeView active={activeTab === 'code'} apps={contextApps} />
              </div>

              {/* Workflows (mw) - polls only while active */}
              <div
                className={
                  activeTab === 'workflows'
                    ? 'absolute inset-0 z-10 flex flex-col min-h-0'
                    : 'hidden'
                }
                aria-hidden={activeTab !== 'workflows'}
              >
                <WorkflowView active={activeTab === 'workflows'} />
              </div>

              {/* Stays mounted on other routes so the Web-IDE and browser iframes survive navigation;
                  hidden off-screen with a clip because iframes bleed through visibility tricks */}
              {selectedApp && (
                <div
                  className={`flex flex-col min-h-0 ${
                    activeTab === 'apps' ? 'absolute inset-0 z-10' : 'fixed pointer-events-none'
                  }`}
                  style={
                    activeTab === 'apps'
                      ? undefined
                      : {
                          left: '-200vw',
                          top: 0,
                          width: '100vw',
                          height: '100vh',
                          clipPath: 'inset(0 100% 100% 0)',
                          visibility: 'hidden',
                        }
                  }
                  aria-hidden={activeTab !== 'apps'}
                >
                  <AppDetail
                    key={selectedApp.id}
                    app={selectedApp}
                    onStart={handleStartApp}
                    onStop={handleStopApp}
                    onRestart={handleRestartApp}
                    onAnalyze={handleAnalyzeApp}
                    onOpenInBrowser={handleOpenInBrowser}
                    onInstallDeps={handleInstallDeps}
                    onSetPort={handleSetPort}
                    onSetCommand={handleSetCommand}
                    onRename={handleRename}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleArchive={handleToggleArchive}
                    onOpenInFinder={handleOpenInFinder}
                    onOpenInTerminal={handleOpenInTerminal}
                    preferredIDE={settings?.preferredIDEs?.[selectedApp.id] || null}
                    isViewTabBarHidden={isViewTabBarHidden}
                    onToggleViewTabBar={handleToggleViewTabBar}
                    activeView={detailsViewMode}
                    onViewChange={setDetailsViewMode}
                    perAppState={createAppStateHelpers(selectedApp.id)}
                  />
                </div>
              )}
            </AgentsView>
          </div>
        </div>
      </main>

      {editingContext && (
        <ContextDialog
          key={editingContext}
          context={contexts.contexts.find((c) => c.id === editingContext) ?? null}
          apps={apps}
          projectDirs={projectDirs}
          canDelete={contexts.contexts.length > 1}
          onSave={(input) =>
            editingContext === 'new'
              ? contexts.create(input)
              : contexts.update(editingContext, input)
          }
          onDelete={() => contexts.remove(editingContext)}
          onClose={() => setEditingContext(null)}
          onOpenSettings={() => {
            setEditingContext(null);
            setAdminPanelOpen(true);
          }}
        />
      )}

      {/* Admin Panel Modal */}
      <AdminPanel
        isOpen={adminPanelOpen}
        onClose={() => setAdminPanelOpen(false)}
        onConfigChange={() => {
          refreshApps();
          loadProjectDirs();
        }}
      />

      <ModuleSlot />
    </div>
  );
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/agents" replace />} />
      <Route path="/dashboard" element={<AppContent />} />
      <Route path="/agents" element={<AppContent />} />
      <Route path="/board" element={<AppContent />} />
      <Route path="/code" element={<AppContent />} />
      <Route path="/workflows" element={<AppContent />} />
      <Route path="/pulls" element={<AppContent />} />
      <Route path="/:projectName/:projectId" element={<AppContent />} />
    </Routes>
  );
}

export default function App() {
  // Use HashRouter for Electron (file:// protocol) since BrowserRouter doesn't work with it
  const Router = isElectron ? HashRouter : BrowserRouter;

  return (
    <ErrorBoundary>
      <Router>
        <CommandPaletteProvider>
          <AppRouter />
        </CommandPaletteProvider>
      </Router>
    </ErrorBoundary>
  );
}
