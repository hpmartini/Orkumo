import { useState } from 'react';
import { LayoutDashboard, RefreshCw } from 'lucide-react';
import {
  Sidebar,
  DashboardOverview,
  AppList,
  AppDetail,
  SystemAlerts,
  ErrorBoundary,
} from './components';
import { useApps } from './hooks';

type ActiveTab = 'dashboard' | 'apps';

function AppContent() {
  const {
    apps,
    loading,
    selectedAppId,
    selectedApp,
    setSelectedAppId,
    handleStartApp,
    handleStopApp,
    handleRestartApp,
    handleAnalyzeApp,
    handleOpenInBrowser,
    refreshApps,
    runningCount,
    totalCpu,
  } = useApps();

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');

  const handleSelectDashboard = () => {
    setActiveTab('dashboard');
    setSelectedAppId(null);
  };

  const handleSelectApp = (id: string) => {
    setSelectedAppId(id);
    setActiveTab('apps');
  };

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
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        apps={apps}
        selectedAppId={selectedAppId}
        activeTab={activeTab}
        onSelectDashboard={handleSelectDashboard}
        onSelectApp={handleSelectApp}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        <header className="sticky top-0 z-20 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 px-8 py-4 flex items-center justify-between">
          <div className="md:hidden flex items-center gap-2 text-blue-500 font-bold">
            <LayoutDashboard /> DevOrbit
          </div>

          <h2 className="text-xl font-semibold text-white hidden md:block">
            {activeTab === 'dashboard' ? 'System Overview' : 'Application Details'}
          </h2>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full border border-gray-700">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-mono text-gray-400">Daemon Active</span>
            </div>
          </div>
        </header>

        <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20">
          {activeTab === 'dashboard' ? (
            <div className="space-y-8 animate-in fade-in duration-500">
              <DashboardOverview
                totalApps={apps.length}
                runningCount={runningCount}
                totalCpu={totalCpu}
              />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-200">
                      Application Registry
                    </h3>
                  </div>
                  <AppList
                    apps={apps}
                    selectedAppId={selectedAppId}
                    onSelectApp={handleSelectApp}
                    onRefresh={refreshApps}
                  />
                </div>

                <div className="space-y-6">
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
            />
          )}
        </div>
      </main>
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
