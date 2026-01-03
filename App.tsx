import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  LayoutDashboard, 
  FolderSearch, 
  Play, 
  Square, 
  RefreshCw, 
  Terminal, 
  Activity, 
  Cpu, 
  Settings,
  AlertCircle,
  Zap,
  Box,
  Globe
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { AppConfig, AppStatus } from './types';
import { scanDirectory, generateMockLog } from './services/mockOs';
import { analyzeAppConfig } from './services/geminiService';

// --- Components ---

const StatusBadge: React.FC<{ status: AppStatus }> = ({ status }) => {
  const colors = {
    [AppStatus.RUNNING]: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    [AppStatus.STOPPED]: 'bg-gray-700/50 text-gray-400 border-gray-600/30',
    [AppStatus.ERROR]: 'bg-red-500/20 text-red-400 border-red-500/30',
    [AppStatus.STARTING]: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    [AppStatus.ANALYZING]: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[status]}`}>
      {status}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'apps'>('dashboard');

  // Simulation Interval Ref
  const intervalRef = useRef<number | null>(null);

  // Initial Scan
  useEffect(() => {
    scanDirectory().then(data => {
      setApps(data);
      setLoading(false);
    });
  }, []);

  // Process Simulation Logic
  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setApps(currentApps => 
        currentApps.map(app => {
          if (app.status !== AppStatus.RUNNING) return app;

          // Update uptime
          const newUptime = app.uptime + 1;

          // Generate logs (10% chance per tick)
          let newLogs = app.logs;
          if (Math.random() > 0.8) {
             const log = generateMockLog(app.name, app.type);
             newLogs = [...newLogs, log].slice(-50); // Keep last 50
          }

          // Update stats
          const lastCpu = app.stats.cpu[app.stats.cpu.length - 1] || 0;
          const targetCpu = Math.random() * 40 + 10; // Random target between 10-50%
          const nextCpu = lastCpu + (targetCpu - lastCpu) * 0.2; // Smooth transition

          const lastMem = app.stats.memory[app.stats.memory.length - 1] || 100;
          const jitter = (Math.random() - 0.5) * 10;
          const nextMem = Math.max(50, Math.min(1024, lastMem + jitter));

          return {
            ...app,
            uptime: newUptime,
            logs: newLogs,
            stats: {
              cpu: [...app.stats.cpu.slice(1), nextCpu],
              memory: [...app.stats.memory.slice(1), nextMem],
            }
          };
        })
      );
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleStartApp = (id: string) => {
    setApps(apps => apps.map(app => 
      app.id === id ? { ...app, status: AppStatus.STARTING } : app
    ));

    setTimeout(() => {
      setApps(apps => apps.map(app => 
        app.id === id ? { 
          ...app, 
          status: AppStatus.RUNNING, 
          logs: [...app.logs, `[SYSTEM] Started process: ${app.startCommand}`] 
        } : app
      ));
    }, 1500);
  };

  const handleStopApp = (id: string) => {
    setApps(apps => apps.map(app => 
      app.id === id ? { 
        ...app, 
        status: AppStatus.STOPPED, 
        logs: [...app.logs, `[SYSTEM] Process terminated`] 
      } : app
    ));
  };

  const handleAnalyzeApp = async (id: string) => {
    setApps(apps => apps.map(app => 
      app.id === id ? { ...app, status: AppStatus.ANALYZING } : app
    ));

    const app = apps.find(a => a.id === id);
    if (!app) return;

    // Simulate reading package.json
    const mockPackageJson = JSON.stringify({
      name: app.name,
      scripts: {
        dev: "vite",
        build: "tsc && vite build"
      },
      dependencies: {
        "react": "^18.2.0"
      }
    }, null, 2);

    const result = await analyzeAppConfig("package.json", mockPackageJson);

    setApps(currentApps => currentApps.map(a => 
      a.id === id ? {
        ...a,
        status: AppStatus.STOPPED, // Reset to stopped after analysis
        aiAnalysis: result.summary,
        startCommand: result.command,
        port: result.port,
        detectedFramework: result.type
      } : a
    ));
  };

  const selectedApp = apps.find(a => a.id === selectedAppId);
  const runningCount = apps.filter(a => a.status === AppStatus.RUNNING).length;
  const totalCpu = apps.reduce((acc, app) => acc + (app.stats.cpu[app.stats.cpu.length - 1] || 0), 0);

  // --- Render Functions ---

  const renderDashboard = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400"><LayoutDashboard size={20} /></div>
          <span className="text-xs font-medium text-gray-400">Total Projects</span>
        </div>
        <div className="text-3xl font-bold text-white">{apps.length}</div>
        <div className="text-xs text-gray-500 mt-1">Discovered in ./projects</div>
      </div>
      
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400"><Activity size={20} /></div>
          <span className="text-xs font-medium text-gray-400">Active Services</span>
        </div>
        <div className="text-3xl font-bold text-white">{runningCount}</div>
        <div className="text-xs text-gray-500 mt-1">Listening on ports</div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Cpu size={20} /></div>
          <span className="text-xs font-medium text-gray-400">Total CPU Load</span>
        </div>
        <div className="text-3xl font-bold text-white">{totalCpu.toFixed(1)}%</div>
        <div className="text-xs text-gray-500 mt-1">Across all processes</div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 relative z-10">
          <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400"><Zap size={20} /></div>
          <span className="text-xs font-medium text-gray-400">AI Analysis</span>
        </div>
        <div className="text-sm text-gray-300 relative z-10">
           Ready to optimize configurations using Gemini models.
        </div>
        <div className="absolute -bottom-4 -right-4 opacity-10">
          <Zap size={100} />
        </div>
      </div>
    </div>
  );

  const renderAppList = () => (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-850">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Box size={18} className="text-gray-400"/> Applications
        </h2>
        <button className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400">
           <FolderSearch size={18} />
        </button>
      </div>
      <div className="divide-y divide-gray-700/50">
        {apps.map(app => (
          <div 
            key={app.id} 
            onClick={() => { setSelectedAppId(app.id); setActiveTab('apps'); }}
            className={`p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors cursor-pointer group ${selectedAppId === app.id ? 'bg-gray-700/40' : ''}`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-2 h-10 rounded-full ${app.status === AppStatus.RUNNING ? 'bg-emerald-500' : 'bg-gray-600'}`}></div>
              <div>
                <h3 className="text-white font-medium flex items-center gap-2">
                  {app.name}
                  {app.status === AppStatus.RUNNING && <span className="text-xs text-gray-500">:{app.port}</span>}
                </h3>
                <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                  <span>{app.detectedFramework}</span>
                  <span>•</span>
                  <span>{app.path}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <StatusBadge status={app.status} />
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Settings size={16} className="text-gray-400" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderAppDetail = () => {
    if (!selectedApp) return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 h-[60vh]">
        <Box size={48} className="mb-4 opacity-20" />
        <p>Select an application to view details</p>
      </div>
    );

    const chartData = selectedApp.stats.cpu.map((cpu, i) => ({
      time: i,
      cpu: cpu,
      memory: selectedApp.stats.memory[i]
    }));

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Header */}
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
                {selectedApp.name} 
                <StatusBadge status={selectedApp.status} />
              </h1>
              <p className="text-gray-400 text-sm font-mono bg-gray-900/50 px-3 py-1 rounded inline-block">
                {selectedApp.startCommand}
              </p>
            </div>
            <div className="flex gap-3">
              {selectedApp.status === AppStatus.RUNNING ? (
                 <button 
                  onClick={() => handleStopApp(selectedApp.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-all"
                >
                  <Square size={18} fill="currentColor" /> Stop
                </button>
              ) : (
                <button 
                  onClick={() => handleStartApp(selectedApp.id)}
                  disabled={selectedApp.status === AppStatus.STARTING || selectedApp.status === AppStatus.ANALYZING}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {selectedApp.status === AppStatus.STARTING ? <RefreshCw className="animate-spin" size={18} /> : <Play size={18} fill="currentColor" />}
                  {selectedApp.status === AppStatus.STARTING ? 'Starting...' : 'Run'}
                </button>
              )}
              
              <button 
                onClick={() => handleAnalyzeApp(selectedApp.id)}
                disabled={selectedApp.status === AppStatus.RUNNING || selectedApp.status === AppStatus.ANALYZING}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
                title="Use AI to detect config"
              >
                 {selectedApp.status === AppStatus.ANALYZING ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
                 AI Config
              </button>
              
               <button 
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
                disabled={selectedApp.status !== AppStatus.RUNNING}
              >
                 <Globe size={18} />
                 Open
              </button>
            </div>
          </div>

          {selectedApp.aiAnalysis && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-3">
               <Zap className="text-blue-400 shrink-0 mt-0.5" size={16} />
               <p className="text-sm text-blue-200">{selectedApp.aiAnalysis}</p>
            </div>
          )}
        </div>

        {/* Performance Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 h-64">
              <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2"><Cpu size={16}/> CPU Usage History</h3>
              <ResponsiveContainer width="100%" height="80%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                    itemStyle={{ color: '#e5e7eb' }}
                  />
                  <Area type="monotone" dataKey="cpu" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorCpu)" />
                </AreaChart>
              </ResponsiveContainer>
           </div>
           
           <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 h-64">
              <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2"><Activity size={16}/> Memory Usage (MB)</h3>
              <ResponsiveContainer width="100%" height="80%">
                <AreaChart data={chartData}>
                   <defs>
                    <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                    itemStyle={{ color: '#e5e7eb' }}
                  />
                  <Area type="monotone" dataKey="memory" stroke="#10b981" fillOpacity={1} fill="url(#colorMem)" />
                </AreaChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Terminal */}
        <div className="bg-gray-950 rounded-xl border border-gray-800 shadow-inner overflow-hidden flex flex-col h-[400px]">
          <div className="bg-gray-900 px-4 py-2 border-b border-gray-800 flex justify-between items-center">
            <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
              <Terminal size={14} /> stdout / stderr
            </span>
             <div className="flex gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
             </div>
          </div>
          <div className="flex-1 p-4 font-mono text-xs md:text-sm overflow-y-auto scrollbar-hide space-y-1">
             {selectedApp.logs.length === 0 && (
               <div className="text-gray-600 italic">No output yet... start the application to see logs.</div>
             )}
             {selectedApp.logs.map((log, i) => (
               <div key={i} className="text-gray-300 break-all">
                 <span className="text-gray-600 mr-2">$</span>
                 {log}
               </div>
             ))}
             {selectedApp.status === AppStatus.RUNNING && (
               <div className="w-2 h-4 bg-gray-500 animate-pulse inline-block align-middle ml-1"></div>
             )}
          </div>
        </div>
      </div>
    );
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
      <aside className="w-64 bg-gray-950 border-r border-gray-800 hidden md:flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-2 text-blue-500 font-bold text-xl tracking-tight">
            <LayoutDashboard />
            DevOrbit
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button 
            onClick={() => { setActiveTab('dashboard'); setSelectedAppId(null); }}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-all ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'}`}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>
          
          <div className="pt-6 pb-2 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Detected Apps
          </div>
          
          {apps.map(app => (
            <button
              key={app.id}
              onClick={() => { setSelectedAppId(app.id); setActiveTab('apps'); }}
              className={`w-full text-left px-4 py-2.5 rounded-lg flex items-center justify-between group transition-all ${selectedAppId === app.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'}`}
            >
              <div className="flex items-center gap-3">
                 <div className={`w-2 h-2 rounded-full ${app.status === AppStatus.RUNNING ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-600'}`}></div>
                 <span className="truncate max-w-[120px]">{app.name}</span>
              </div>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <div className="bg-gray-900 rounded-lg p-3 flex items-center gap-3">
             <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-xs">
               A
             </div>
             <div className="flex-1">
               <div className="text-sm font-medium">Admin User</div>
               <div className="text-xs text-gray-500">Local Environment</div>
             </div>
             <Settings size={16} className="text-gray-500 cursor-pointer hover:text-white" />
          </div>
        </div>
      </aside>

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
               {renderDashboard()}
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-200">Application Registry</h3>
                    </div>
                    {renderAppList()}
                  </div>
                  
                  <div className="space-y-6">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                      <h3 className="text-lg font-semibold text-gray-200 mb-4">System Alerts</h3>
                      <div className="space-y-4">
                         <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-3">
                           <AlertCircle className="text-yellow-500 shrink-0" size={20} />
                           <div>
                             <div className="text-sm font-medium text-yellow-200">Node Update Available</div>
                             <div className="text-xs text-yellow-500/70 mt-1">Version v20.10.0 is available. Current: v18.17.0</div>
                           </div>
                         </div>
                         <div className="p-3 bg-gray-700/30 border border-gray-600/30 rounded-lg flex gap-3">
                           <Activity className="text-gray-400 shrink-0" size={20} />
                           <div>
                             <div className="text-sm font-medium text-gray-300">System Idle</div>
                             <div className="text-xs text-gray-500 mt-1">Resources are optimized.</div>
                           </div>
                         </div>
                      </div>
                    </div>
                  </div>
               </div>
            </div>
          ) : (
            renderAppDetail()
          )}
        </div>
      </main>
    </div>
  );
}