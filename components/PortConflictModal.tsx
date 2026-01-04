import React, { useState } from 'react';
import { X, AlertTriangle, Zap, RefreshCw } from 'lucide-react';

interface ConflictingProcess {
  name: string;
  pid: number;
  isDevOrbitApp: boolean;
  appId?: string;
}

interface PortConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestedPort: number;
  conflictingProcess: ConflictingProcess | null;
  suggestedPort: number;
  onUseAlternate: (port: number) => void;
  onKillProcess: () => void;
  isKilling?: boolean;
}

export const PortConflictModal: React.FC<PortConflictModalProps> = ({
  isOpen,
  onClose,
  requestedPort,
  conflictingProcess,
  suggestedPort,
  onUseAlternate,
  onKillProcess,
  isKilling = false,
}) => {
  const [customPort, setCustomPort] = useState<string>(suggestedPort.toString());

  if (!isOpen) return null;

  const handleUseCustomPort = () => {
    const port = parseInt(customPort, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      onUseAlternate(port);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <AlertTriangle className="text-yellow-500" size={20} />
            </div>
            <h2 className="text-lg font-semibold text-white">Port Conflict</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-gray-300">
            Port <span className="font-mono text-yellow-400">{requestedPort}</span> is
            already in use.
          </p>

          {conflictingProcess && (
            <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
              <p className="text-sm text-gray-400">Currently used by:</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-white font-medium">
                  {conflictingProcess.name}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  PID: {conflictingProcess.pid}
                </span>
              </div>
              {conflictingProcess.isDevOrbitApp && (
                <p className="mt-1 text-xs text-blue-400">
                  This is a DevOrbit managed app
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm text-gray-400">Choose how to resolve:</p>

            {/* Option 1: Use alternative port */}
            <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
              <label className="block text-sm text-gray-300 mb-2">
                Use a different port:
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value)}
                  min={1}
                  max={65535}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleUseCustomPort}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-sm transition-colors flex items-center gap-2"
                >
                  <Zap size={14} />
                  Use Port
                </button>
              </div>
              {suggestedPort !== parseInt(customPort) && (
                <p className="mt-2 text-xs text-gray-500">
                  Suggested available port:{' '}
                  <button
                    onClick={() => setCustomPort(suggestedPort.toString())}
                    className="text-blue-400 hover:underline"
                  >
                    {suggestedPort}
                  </button>
                </p>
              )}
            </div>

            {/* Option 2: Kill conflicting process */}
            <button
              onClick={onKillProcess}
              disabled={isKilling}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600/10 hover:bg-red-600/20 border border-red-600/30 text-red-400 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            >
              {isKilling ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Killing process...
                </>
              ) : (
                <>
                  <AlertTriangle size={14} />
                  Kill process and use port {requestedPort}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-900/30 rounded-b-xl">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortConflictModal;
