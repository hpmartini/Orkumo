import { useState, useEffect } from 'react';
import { Settings, FolderPlus, Trash2, RefreshCw, X, Save } from 'lucide-react';
import { fetchConfig, addDirectory, removeDirectory, updateConfig, Config } from '../services/api';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChange: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose, onConfigChange }) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDirectory, setNewDirectory] = useState('');
  const [scanDepth, setScanDepth] = useState(2);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConfig();
      setConfig(data);
      setScanDepth(data.scanDepth);
    } catch (err) {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDirectory = async () => {
    if (!newDirectory.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const updated = await addDirectory(newDirectory.trim());
      setConfig(updated);
      setNewDirectory('');
      onConfigChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add directory');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDirectory = async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await removeDirectory(dir);
      setConfig(updated);
      onConfigChange();
    } catch (err) {
      setError('Failed to remove directory');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveScanDepth = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await updateConfig({ scanDepth });
      setConfig(updated);
      onConfigChange();
    } catch (err) {
      setError('Failed to update settings');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Settings className="text-blue-400" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Admin Panel</h2>
              <p className="text-sm text-gray-400">Configure directories to scan</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="text-gray-400" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Add Directory */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Add Directory to Scan
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newDirectory}
                onChange={(e) => setNewDirectory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDirectory()}
                placeholder="/path/to/projects"
                className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAddDirectory}
                disabled={loading || !newDirectory.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <FolderPlus size={18} />
                Add
              </button>
            </div>
          </div>

          {/* Directory List */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Configured Directories
            </label>
            {loading && !config ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="animate-spin text-blue-500" size={24} />
              </div>
            ) : config?.directories.length === 0 ? (
              <p className="text-gray-500 text-sm py-4">
                No directories configured. Add a directory above to start scanning for projects.
              </p>
            ) : (
              <div className="space-y-2">
                {config?.directories.map((dir) => (
                  <div
                    key={dir}
                    className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700 group"
                  >
                    <span className="text-gray-300 font-mono text-sm truncate">
                      {dir}
                    </span>
                    <button
                      onClick={() => handleRemoveDirectory(dir)}
                      disabled={loading}
                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      title="Remove directory"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scan Depth */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Scan Depth
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max="5"
                value={scanDepth}
                onChange={(e) => setScanDepth(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-white font-mono w-8 text-center">{scanDepth}</span>
              <button
                onClick={handleSaveScanDepth}
                disabled={loading || scanDepth === config?.scanDepth}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                <Save size={14} />
                Save
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              How many subdirectory levels to scan for projects
            </p>
          </div>

          {/* Exclude Patterns */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Excluded Patterns
            </label>
            <div className="flex flex-wrap gap-2">
              {config?.excludePatterns.map((pattern) => (
                <span
                  key={pattern}
                  className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs font-mono"
                >
                  {pattern}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700 bg-gray-850">
          <button
            onClick={loadConfig}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
