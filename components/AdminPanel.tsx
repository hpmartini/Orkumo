import { useState, useEffect } from 'react';
import { Settings, FolderPlus, Trash2, RefreshCw, X, Save, Code, Plus } from 'lucide-react';
import { fetchConfig, addDirectory, removeDirectory, updateConfig, Config, fetchInstalledIDEs, fetchCustomIDEs, addCustomIDE, removeCustomIDE, IDE } from '../services/api';

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

  // IDE settings state
  const [installedIDEs, setInstalledIDEs] = useState<IDE[]>([]);
  const [customIDEs, setCustomIDEs] = useState<IDE[]>([]);
  const [showAddIDE, setShowAddIDE] = useState(false);
  const [newIDE, setNewIDE] = useState({ id: '', name: '', path: '' });
  const [ideLoading, setIdeLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadIDEs();
    }
  }, [isOpen]);

  const loadIDEs = async () => {
    setIdeLoading(true);
    try {
      const [installed, custom] = await Promise.all([
        fetchInstalledIDEs(),
        fetchCustomIDEs()
      ]);
      setInstalledIDEs(installed);
      setCustomIDEs(custom);
    } catch (err) {
      console.error('Failed to load IDEs:', err);
    } finally {
      setIdeLoading(false);
    }
  };

  const handleAddCustomIDE = async () => {
    if (!newIDE.id.trim() || !newIDE.name.trim() || !newIDE.path.trim()) return;

    setIdeLoading(true);
    setError(null);
    try {
      await addCustomIDE(newIDE.id.trim(), newIDE.name.trim(), newIDE.path.trim());
      setNewIDE({ id: '', name: '', path: '' });
      setShowAddIDE(false);
      await loadIDEs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add custom IDE');
    } finally {
      setIdeLoading(false);
    }
  };

  const handleRemoveCustomIDE = async (id: string) => {
    setIdeLoading(true);
    setError(null);
    try {
      await removeCustomIDE(id);
      await loadIDEs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove custom IDE');
    } finally {
      setIdeLoading(false);
    }
  };

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

          {/* IDE Settings Section */}
          <div className="pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Code className="text-blue-400" size={18} />
                <label className="text-sm font-medium text-gray-300">
                  IDE Configuration
                </label>
              </div>
              <button
                onClick={() => setShowAddIDE(!showAddIDE)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                <Plus size={14} />
                Add Custom IDE
              </button>
            </div>

            {/* Add Custom IDE Form */}
            {showAddIDE && (
              <div className="mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    ID (lowercase, no spaces)
                  </label>
                  <input
                    type="text"
                    value={newIDE.id}
                    onChange={(e) => setNewIDE({ ...newIDE, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                    placeholder="my-editor"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={newIDE.name}
                    onChange={(e) => setNewIDE({ ...newIDE, name: e.target.value })}
                    placeholder="My Code Editor"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Application Path
                  </label>
                  <input
                    type="text"
                    value={newIDE.path}
                    onChange={(e) => setNewIDE({ ...newIDE, path: e.target.value })}
                    placeholder="/Applications/MyEditor.app"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleAddCustomIDE}
                    disabled={ideLoading || !newIDE.id || !newIDE.name || !newIDE.path}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add IDE
                  </button>
                  <button
                    onClick={() => {
                      setShowAddIDE(false);
                      setNewIDE({ id: '', name: '', path: '' });
                    }}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Detected IDEs */}
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Detected IDEs</p>
              {ideLoading && installedIDEs.length === 0 ? (
                <div className="flex items-center gap-2 py-2">
                  <RefreshCw className="animate-spin text-blue-500" size={14} />
                  <span className="text-sm text-gray-400">Detecting IDEs...</span>
                </div>
              ) : installedIDEs.filter(ide => !ide.custom).length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No IDEs detected</p>
              ) : (
                <div className="space-y-1">
                  {installedIDEs.filter(ide => !ide.custom).map((ide) => (
                    <div
                      key={ide.id}
                      className="flex items-center justify-between p-2 bg-gray-900 rounded border border-gray-700"
                    >
                      <div>
                        <span className="text-sm text-white">{ide.name}</span>
                        <span className="text-xs text-gray-500 ml-2 font-mono">{ide.id}</span>
                      </div>
                      <span className="text-xs text-green-400">Installed</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Custom IDEs */}
            {customIDEs.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Custom IDEs</p>
                <div className="space-y-1">
                  {customIDEs.map((ide) => (
                    <div
                      key={ide.id}
                      className="flex items-center justify-between p-2 bg-gray-900 rounded border border-gray-700 group"
                    >
                      <div>
                        <span className="text-sm text-white">{ide.name}</span>
                        <span className="text-xs text-gray-500 ml-2 font-mono">{ide.id}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveCustomIDE(ide.id)}
                        disabled={ideLoading}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                        title="Remove custom IDE"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
