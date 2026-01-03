import React, { useMemo } from 'react';
import { Lightbulb, ArrowUpCircle, Package, Zap, AlertTriangle } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';

interface Recommendation {
  id: string;
  type: 'optimization' | 'update' | 'security' | 'performance';
  title: string;
  message: string;
  appId?: string;
  action?: string;
}

interface RecommendationsProps {
  apps: AppConfig[];
  onAnalyzeApp?: (id: string) => void;
}

const typeStyles = {
  optimization: {
    icon: Lightbulb,
    iconClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10 border-amber-500/20',
  },
  update: {
    icon: ArrowUpCircle,
    iconClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10 border-blue-500/20',
  },
  security: {
    icon: AlertTriangle,
    iconClass: 'text-red-400',
    bgClass: 'bg-red-500/10 border-red-500/20',
  },
  performance: {
    icon: Zap,
    iconClass: 'text-purple-400',
    bgClass: 'bg-purple-500/10 border-purple-500/20',
  },
};

export const Recommendations: React.FC<RecommendationsProps> = ({ apps, onAnalyzeApp }) => {
  const recommendations = useMemo(() => {
    const recs: Recommendation[] = [];

    // Check for apps without AI analysis
    const unanalyzedApps = apps.filter(
      (app) => !app.aiAnalysis && app.status === AppStatus.STOPPED
    );
    if (unanalyzedApps.length > 0) {
      recs.push({
        id: 'analyze-apps',
        type: 'optimization',
        title: 'Run AI Analysis',
        message: `${unanalyzedApps.length} app(s) haven't been analyzed yet. Run AI Config to optimize startup commands.`,
        appId: unanalyzedApps[0].id,
        action: 'Analyze',
      });
    }

    // Check for apps with default ports that might conflict
    const portCounts = new Map<number, string[]>();
    apps.forEach((app) => {
      if (app.port) {
        const existing = portCounts.get(app.port) || [];
        existing.push(app.name);
        portCounts.set(app.port, existing);
      }
    });
    portCounts.forEach((appNames, port) => {
      if (appNames.length > 1) {
        recs.push({
          id: `port-conflict-${port}`,
          type: 'security',
          title: 'Port Conflict Detected',
          message: `Port ${port} is configured for multiple apps: ${appNames.join(', ')}. Consider setting custom ports.`,
        });
      }
    });

    // Check for apps with high CPU usage
    const highCpuApps = apps.filter((app) => {
      const lastCpu = app.stats.cpu[app.stats.cpu.length - 1] || 0;
      return lastCpu > 80 && app.status === AppStatus.RUNNING;
    });
    highCpuApps.forEach((app) => {
      recs.push({
        id: `high-cpu-${app.id}`,
        type: 'performance',
        title: 'High CPU Usage',
        message: `${app.name} is using significant CPU resources. Consider optimizing or restarting.`,
        appId: app.id,
      });
    });

    // Suggest running npm install for stopped apps with errors
    const errorApps = apps.filter((app) => app.status === AppStatus.ERROR);
    if (errorApps.length > 0) {
      recs.push({
        id: 'fix-errors',
        type: 'update',
        title: 'Fix App Errors',
        message: `${errorApps.length} app(s) have errors. Try reinstalling dependencies or checking logs.`,
        appId: errorApps[0].id,
      });
    }

    // General suggestions if no specific recommendations
    if (recs.length === 0) {
      recs.push({
        id: 'all-good',
        type: 'optimization',
        title: 'System Optimized',
        message: 'All applications are configured correctly. No recommendations at this time.',
      });
    }

    return recs.slice(0, 4); // Limit to 4 recommendations
  }, [apps]);

  return (
    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Package className="text-blue-400" size={20} />
        <h3 className="text-lg font-semibold text-gray-200">Recommendations</h3>
      </div>
      <div className="space-y-3">
        {recommendations.map((rec) => {
          const style = typeStyles[rec.type];
          const Icon = style.icon;
          return (
            <div
              key={rec.id}
              className={`p-3 border rounded-lg ${style.bgClass}`}
            >
              <div className="flex items-start gap-3">
                <Icon className={`shrink-0 mt-0.5 ${style.iconClass}`} size={18} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-200">{rec.title}</div>
                  <div className="text-xs text-gray-400 mt-1">{rec.message}</div>
                  {rec.action && rec.appId && onAnalyzeApp && (
                    <button
                      onClick={() => onAnalyzeApp(rec.appId!)}
                      className="mt-2 text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                    >
                      {rec.action}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
