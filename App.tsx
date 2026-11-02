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
import { isElectron } from './utils/apiConfig';
import { Bot, Rocket } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import {
  SystemHealth,
  ErrorBoundary,
  AdminPanel,
  TitleBar,
  ContextDialog,
  LoadingSkeleton,
  AgentsView,
} from './components';
import { ModuleSlot } from './components/ModuleSlot';
import { useApps } from './hooks';
import { AgentOverview } from './components/AgentOverview';
import { UsageView, UsageCard } from './components/UsageView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjectContexts, ROUTE_KEY } from './hooks/useProjectContexts';
import { CommandPaletteProvider, useRegisterCommands } from './components/CommandPalette';
import type { PaletteCommand } from './utils/commandPalette';
import { codeUrl } from './utils/codeTarget';
import { fetchConfig } from './services/api';
import { KeyboardShortcuts } from './types';

import { BoardView } from './components/BoardView';
import { WorkflowView } from './components/WorkflowView';
import { ConnectedPullRequestsPage } from './components/AgentsView/PullRequestsPage';
import { CodeView } from './components/CodeView';
import { ShellBrowser } from './components/ShellBrowser';
import { installAnchorInterception, openLink, setLinkTarget } from './utils/links';

type ActiveTab = 'dashboard' | 'usage' | 'agents' | 'board' | 'code' | 'workflows' | 'pulls';

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboardRoute = location.pathname === '/dashboard';
  const isUsageRoute = location.pathname === '/usage';
  const isBoardRoute = location.pathname === '/board';
  const isCodeRoute = location.pathname === '/code';
  const isWorkflowsRoute = location.pathname === '/workflows';
  const isPullsRoute = location.pathname === '/pulls';

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

  const [activeTab, setActiveTab] = useState<ActiveTab>('agents');
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    setActiveTab(
      isDashboardRoute
        ? 'dashboard'
        : isUsageRoute
          ? 'usage'
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
  }, [isDashboardRoute, isUsageRoute, isBoardRoute, isCodeRoute, isWorkflowsRoute, isPullsRoute]);

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
    command(
      'workflows',
      'Open workflows',
      'Navigate',
      () => navigate('/workflows'),
      'mw martini pipeline orchestrate go stages'
    ),
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
                  onOpenWorkflows: () => navigate('/workflows'),
                  onOpenSettings: () => setAdminPanelOpen(true),
                  onOpenProject: handleSelectApp,
                }}
              >
                {/* Dashboard: the start view behind the rocket and the agents icon */}
                <div
                  className={
                    activeTab === 'dashboard' ? 'absolute inset-0 overflow-auto' : 'hidden'
                  }
                >
                  <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20 space-y-8 animate-in fade-in duration-500">
                    <AgentOverview active={activeTab === 'dashboard'} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <UsageCard onOpen={() => navigate('/usage')} />
                      <SystemHealth />
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
                  <UsageView active={activeTab === 'usage'} />
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

      <ModuleSlot />
    </div>
  );
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/agents" replace />} />
      <Route path="/dashboard" element={<AppContent />} />
      <Route path="/usage" element={<AppContent />} />
      <Route path="/agents" element={<AppContent />} />
      <Route path="/board" element={<AppContent />} />
      <Route path="/code" element={<AppContent />} />
      <Route path="/workflows" element={<AppContent />} />
      <Route path="/pulls" element={<AppContent />} />
      <Route path="*" element={<Navigate to="/agents" replace />} />
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
