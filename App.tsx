import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Routes,
  Route,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { isElectron, isNativeApp } from './utils/apiConfig';
import { Bot, Rocket } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import {
  ToolVersions,
  ErrorBoundary,
  AdminPanel,
  TitleBar,
  ContextDialog,
  LoadingSkeleton,
  AgentsView,
} from './components';
import { ModuleSlot } from './components/ModuleSlot';
import { ModuleMode } from './components/ModuleMount';
import { modeCommands, useModulesState, type ModeEntry } from './hooks/useModules';
import { useApps } from './hooks';
import { AgentOverview } from './components/AgentOverview';
import { UsageView, UsageCard, SessionsCard } from './components/UsageView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjectContexts, ROUTE_KEY } from './hooks/useProjectContexts';
import { CommandPaletteProvider, useRegisterCommands } from './components/CommandPalette';
import type { PaletteCommand } from './utils/commandPalette';
import { codeUrl } from './utils/codeTarget';
import { fetchConfig } from './services/api';
import { KeyboardShortcuts } from './types';

import { BoardView } from './components/BoardView';
import { ConnectedPullRequestsPage } from './components/AgentsView/PullRequestsPage';
import { CodeView } from './components/CodeView';
import { ShellBrowser } from './components/ShellBrowser';
import { installAnchorInterception, openLink, setLinkTarget } from './utils/links';

const HOST_TABS = ['dashboard', 'usage', 'agents', 'board', 'code', 'pulls'];

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();

  // Modes of loaded modules (docs/MODULES.md) live at /<id> next to the host routes
  const { modules, ready: modulesReady } = useModulesState();
  const modes = useMemo<ModeEntry[]>(
    () => modules.flatMap((m) => (m.ui && m.mode ? [{ id: m.id, ...m.mode }] : [])),
    [modules]
  );
  const segment = location.pathname.slice(1);
  const knownRoute = HOST_TABS.includes(segment) || modes.some((m) => m.id === segment);
  // Unknown paths are redirected below once modules are known; until then show the agents view
  const activeTab = knownRoute ? segment : 'agents';
  // Robot = dashboard of the active context, rocket = global dashboard (#184)
  const isContextDashboard =
    activeTab === 'dashboard' && new URLSearchParams(location.search).get('scope') === 'context';

  const { apps, loading, settings, refreshApps } = useApps();

  // Project contexts (#97): title bar tabs, each with its own favorites, board slices, agent tabs
  const contexts = useProjectContexts(refreshApps);
  const { contexts: contextList, switchTo: switchContext } = contexts;
  const contextAppIds = contexts.active?.appIds;
  const contextApps = useMemo(() => {
    if (!contextAppIds) return apps;
    const members = new Set(contextAppIds);
    return apps.filter((app) => members.has(app.id));
  }, [apps, contextAppIds]);
  // A context without own project list spans everything, like its other views
  const dashboardScope = useMemo(
    () => (isContextDashboard && contextAppIds ? contextApps.map((a) => a.path) : undefined),
    [isContextDashboard, contextAppIds, contextApps]
  );
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

  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

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

  // Links open in the configured browser (#140): app anchors, and Electron's window.open (Web-IDE)
  const linkTarget = settings?.linkTarget;
  useEffect(() => {
    if (linkTarget) setLinkTarget(linkTarget);
  }, [linkTarget]);
  useEffect(() => {
    const offAnchors = installAnchorInterception();
    const offOpenLink = window.electronAPI?.onOpenLink?.((url) => openLink(url));
    return () => {
      offAnchors();
      offOpenLink?.();
    };
  }, []);

  const handleSelectDashboard = () => navigate('/dashboard');
  const handleSelectContextDashboard = () => navigate('/dashboard?scope=context');
  // Back from the usage details: previous view inside the app, else the dashboard
  const handleBackFromUsage = () =>
    location.key !== 'default' ? navigate(-1) : handleSelectDashboard();
  // Stable: AgentsView's attach callbacks depend on it
  const openAgentsView = useCallback(() => navigate('/agents'), [navigate]);

  // A project opens in Code mode
  const handleSelectApp = (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (app) navigate(codeUrl(app.path));
  };

  // Keyboard shortcuts
  const keyboardShortcutActions = useMemo(
    () => [
      { id: 'goToDashboard' as keyof KeyboardShortcuts, handler: handleSelectDashboard },
      { id: 'goToDashboardAlt' as keyof KeyboardShortcuts, handler: handleSelectDashboard },
      { id: 'openSettings' as keyof KeyboardShortcuts, handler: () => setAdminPanelOpen(true) },
      { id: 'openSettingsAlt' as keyof KeyboardShortcuts, handler: () => setAdminPanelOpen(true) },
      { id: 'openAgents' as keyof KeyboardShortcuts, handler: () => navigate('/agents') },
      // Cmd+1..9 switch to the n-th context
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `goToTab${i + 1}` as keyof KeyboardShortcuts,
        handler: () => contextList[i] && switchContext(contextList[i].id),
      })),
    ],
    [navigate, contextList, switchContext]
  );

  useKeyboardShortcuts({
    shortcuts: settings?.keyboardShortcuts,
    actions: keyboardShortcutActions,
    enabled: !adminPanelOpen, // Disable when admin panel is open
  });

  // Command palette (Cmd/Ctrl+P). Agent-specific commands are registered by AgentsView.
  const command = (
    id: string,
    title: string,
    group: string,
    run: () => void,
    keywords?: string
  ): PaletteCommand => ({ id: `app.${id}`, title, group, scope: 'command', keywords, run });
  const paletteCommands: PaletteCommand[] = [
    command('dashboard', 'Go to dashboard', 'Navigate', handleSelectDashboard, 'home overview'),
    command(
      'usage',
      'Open usage',
      'Navigate',
      () => navigate('/usage'),
      'tokens limits codex claude'
    ),
    command('agents', 'Open agents view', 'Navigate', () => navigate('/agents'), 'claude sessions'),
    command(
      'board',
      'Open board',
      'Navigate',
      () => navigate('/board'),
      'issues kanban github project'
    ),
    command('code', 'Open code mode', 'Navigate', () => navigate('/code'), 'ide vscode editor'),
    ...modeCommands(modes, navigate),
    command('settings', 'Open settings', 'Navigate', () => setAdminPanelOpen(true), 'admin'),
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

  if (loading || !contexts.ready || !modulesReady) {
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

      {/* Unknown path, e.g. a module mode whose module is not loaded (#165): overview */}
      {!knownRoute && <Navigate to={segment ? '/dashboard' : '/agents'} replace />}

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

        <div className="flex-1 min-h-0 relative flex">
          <div className="flex-1 min-w-0 relative">
            {/* Always mounted so attached terminals survive navigation */}
            <div className="absolute inset-0 flex flex-col min-h-0">
              {/* Not keyed by context: that would remount the views below (Web-IDE, terminals) */}
              <AgentsView
                contextId={contexts.active?.id}
                contextAppIds={contextAppIds}
                active={activeTab === 'agents'}
                apps={apps}
                onExit={handleSelectDashboard}
                onOpenView={openAgentsView}
                nav={{
                  onOpenDashboard: handleSelectDashboard,
                  onOpenContextDashboard: handleSelectContextDashboard,
                  modes,
                  onOpenSettings: () => setAdminPanelOpen(true),
                  onOpenProject: handleSelectApp,
                }}
              >
                {/* Dashboard: global behind the rocket, the active context's behind the robot */}
                <div
                  className={
                    activeTab === 'dashboard' ? 'absolute inset-0 overflow-auto' : 'hidden'
                  }
                >
                  <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20 space-y-8 animate-in fade-in duration-500">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                      {isContextDashboard ? (
                        <>
                          <Bot size={18} className="text-blue-400" />
                          {contexts.active?.name ?? 'Context'}
                          <span className="text-sm font-normal text-gray-400">
                            {dashboardScope ? `${dashboardScope.length} projects` : 'all projects'}
                          </span>
                        </>
                      ) : (
                        <>
                          <Rocket size={18} className="text-blue-400" />
                          Dashboard
                          <span className="text-sm font-normal text-gray-400">all contexts</span>
                        </>
                      )}
                    </h2>
                    <AgentOverview
                      active={activeTab === 'dashboard'}
                      projectPaths={dashboardScope}
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <SessionsCard
                        active={activeTab === 'dashboard'}
                        projectPaths={dashboardScope}
                      />
                      <div className="space-y-8">
                        <UsageCard onOpen={() => navigate('/usage')} />
                        <ToolVersions apps={isContextDashboard ? contextApps : undefined} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Usage per provider - polls only while active */}
                <div
                  className={
                    activeTab === 'usage' ? 'absolute inset-0 z-10 overflow-auto' : 'hidden'
                  }
                  aria-hidden={activeTab !== 'usage'}
                >
                  <UsageView active={activeTab === 'usage'} onBack={handleBackFromUsage} />
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

                {/* Module modes - kept mounted, told whether they are visible */}
                {modes.map((m) => (
                  <div
                    key={m.id}
                    className={
                      activeTab === m.id ? 'absolute inset-0 z-10 flex flex-col min-h-0' : 'hidden'
                    }
                    aria-hidden={activeTab !== m.id}
                  >
                    <ModuleMode id={m.id} active={activeTab === m.id} />
                  </div>
                ))}

                {/* Open pull requests (#157); the PR data comes from AgentsView via context */}
                {activeTab === 'pulls' && (
                  <div className="absolute inset-0 z-10 flex flex-col min-h-0">
                    <ConnectedPullRequestsPage />
                  </div>
                )}
              </AgentsView>
            </div>
          </div>
          {/* Keyed: its URL is parked per context */}
          <ShellBrowser key={activeContextId} />
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

      <ModuleSlot modules={modules} />
    </div>
  );
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/agents" replace />} />
      {/* AppContent resolves the path: host modes, module modes, else /agents */}
      <Route path="*" element={<AppContent />} />
    </Routes>
  );
}

export default function App() {
  // HashRouter for Electron (file://) and the iOS app (capacitor://): no server-side routing there
  const Router = isElectron || isNativeApp ? HashRouter : BrowserRouter;

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
