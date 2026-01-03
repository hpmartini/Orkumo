import React, { useMemo } from 'react';
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts';
import { Cpu, Activity } from 'lucide-react';

interface PerformanceChartsProps {
  cpuHistory: number[];
  memoryHistory: number[];
}

export const PerformanceCharts: React.FC<PerformanceChartsProps> = ({
  cpuHistory,
  memoryHistory,
}) => {
  const chartData = useMemo(
    () =>
      cpuHistory.map((cpu, i) => ({
        time: i,
        cpu,
        memory: memoryHistory[i],
      })),
    [cpuHistory, memoryHistory]
  );

  const tooltipStyle = {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 h-64">
        <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
          <Cpu size={16} /> CPU Usage History
        </h3>
        <ResponsiveContainer width="100%" height="80%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: '#e5e7eb' }}
              formatter={(value) => [`${(value as number).toFixed(1)}%`, 'CPU']}
            />
            <Area
              type="monotone"
              dataKey="cpu"
              stroke="#8b5cf6"
              fillOpacity={1}
              fill="url(#colorCpu)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 h-64">
        <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
          <Activity size={16} /> Memory Usage (MB)
        </h3>
        <ResponsiveContainer width="100%" height="80%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: '#e5e7eb' }}
              formatter={(value) => [`${(value as number).toFixed(1)} MB`, 'Memory']}
            />
            <Area
              type="monotone"
              dataKey="memory"
              stroke="#10b981"
              fillOpacity={1}
              fill="url(#colorMem)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
