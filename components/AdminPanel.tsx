import { useState, useEffect } from 'react';
import {
  Settings,
  FolderPlus,
  FolderOpen,
  Trash2,
  RefreshCw,
  X,
  Save,
  Code,
  Plus,
  Keyboard,
  CheckCircle,
  Kanban,
  Pencil,
  Globe,
} from 'lucide-react';
import {
  fetchConfig,
  addDirectory,
  removeDirectory,
  updateConfig,
  Config,
  fetchInstalledIDEs,
  fetchCustomIDEs,
  addCustomIDE,
  removeCustomIDE,
  IDE,
  fetchSettings,
  updateKeyboardShortcuts,
  updateLinkTarget,
} from '../services/api';
import { setLinkTarget as applyLinkTarget, type LinkTarget } from '../utils/links';
import { fetchBoardSettings, updateBoardSettings } from '../services/boardApi';
import {
  KeyboardShortcuts,
  KeyboardShortcut,
  DEFAULT_KEYBOARD_SHORTCUTS,
  type BoardSource,
} from '../types';
import { formatShortcut } from '../hooks/useKeyboardShortcuts';

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
  /** Directory being replaced by the input value; null adds a new one */
  const [editingDirectory, setEditingDirectory] = useState<string | null>(null);
  const [scanDepth, setScanDepth] = useState(2);

  // IDE settings state
  const [installedIDEs, setInstalledIDEs] = useState<IDE[]>([]);
  const [customIDEs, setCustomIDEs] = useState<IDE[]>([]);
  const [showAddIDE, setShowAddIDE] = useState(false);
  const [newIDE, setNewIDE] = useState({ id: '', name: '', path: '' });
  const [ideLoading, setIdeLoading] = useState(false);

  // Keyboard shortcuts state
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(DEFAULT_KEYBOARD_SHORTCUTS);
  const [shortcutsLoading, setShortcutsLoading] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<keyof KeyboardShortcuts | null>(null);
  const [shortcutsDirty, setShortcutsDirty] = useState(false);

  // Where clicked links open (#140)
  const [linkTarget, setLinkTarget] = useState<LinkTarget>('builtin');

  // Board source state
  const [boardSource, setBoardSource] = useState<BoardSource>({ owner: '', number: 0 });
  const [boardSourceLoading, setBoardSourceLoading] = useState(false);
  const [boardSourceSaved, setBoardSourceSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadIDEs();
      loadShortcuts();
      loadBoardSource();
    }
  }, [isOpen]);

  const loadBoardSource = async () => {
    try {
      setBoardSource((await fetchBoardSettings()).source);
      setBoardSourceSaved(false);
    } catch (err) {
      console.error('Failed to load board settings:', err);
    }
  };

  const handleSaveBoardSource = async () => {
    setBoardSourceLoading(true);
    setError(null);
    try {
      setBoardSource((await updateBoardSettings({ source: boardSource })).source);
      setBoardSourceSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save board source');
    } finally {
      setBoardSourceLoading(false);
    }
  };

  const loadShortcuts = async () => {
    setShortcutsLoading(true);
    try {
      const settings = await fetchSettings();
      setLinkTarget(settings.linkTarget ?? 'builtin');
      if (settings.keyboardShortcuts) {
        setShortcuts(settings.keyboardShortcuts);
      }
      setShortcutsDirty(false);
    } catch (err) {
      console.error('Failed to load keyboard shortcuts:', err);
    } finally {
      setShortcutsLoading(false);
    }
  };

  const handleSaveShortcuts = async () => {
    setShortcutsLoading(true);
    setError(null);
    try {
      await updateKeyboardShortcuts(shortcuts);
      setShortcutsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save keyboard shortcuts');
    } finally {
      setShortcutsLoading(false);
    }
  };

  const handleLinkTargetChange = async (target: LinkTarget) => {
    const previous = linkTarget;
    setLinkTarget(target);
    setError(null);
    try {
      applyLinkTarget((await updateLinkTarget(target)).linkTarget);
    } catch (err) {
      setLinkTarget(previous);
      setError(err instanceof Error ? err.message : 'Failed to save link target');
    }
  };

  const handleResetShortcuts = () => {
    setShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
    setShortcutsDirty(true);
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent, shortcutId: keyof KeyboardShortcuts) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore modifier-only key presses
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return;
    }

    const newShortcut: KeyboardShortcut = {
      key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
      modifiers: {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
      },
      description: shortcuts[shortcutId].description,
    };

    // Remove empty modifiers
    if (
      !newShortcut.modifiers?.ctrl &&
      !newShortcut.modifiers?.alt &&
      !newShortcut.modifiers?.shift &&
      !newShortcut.modifiers?.meta
    ) {
      delete newShortcut.modifiers;
    }

    setShortcuts((prev) => ({
      ...prev,
      [shortcutId]: newShortcut,
    }));
    setShortcutsDirty(true);
    setEditingShortcut(null);
  };

  const loadIDEs = async () => {
    setIdeLoading(true);
    try {
      const [installed, custom] = await Promise.all([fetchInstalledIDEs(), fetchCustomIDEs()]);
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
      let updated = await addDirectory(newDirectory.trim());
      // Editing = add the new path, then drop the old one (only if the new one was really added)
      if (editingDirectory && updated.directories.length > (config?.directories.length ?? 0)) {
        updated = await removeDirectory(editingDirectory);
      }
      setConfig(updated);
      setNewDirectory('');
      setEditingDirectory(null);
      onConfigChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add directory');
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseDirectory = async () => {
    // Check if running in Electron
    if (!window.electronAPI?.showOpenDialog) {
      setError('File browser is only available in the desktop app');
      return;
    }

    try {
      const result = await window.electronAPI.showOpenDialog({
        title: 'Select Directory to Scan',
        properties: ['openDirectory'],
        buttonLabel: 'Select',
      });

      if (result.success && !result.canceled && result.filePaths?.length) {
        setNewDirectory(result.filePaths[0]);
      }
    } catch (err) {
      setError('Failed to open folder browser');
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admin Panel"
        className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Settings className="text-blue-400" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Admin Panel</h2>
              <p className="text-sm text-gray-400">Project directories, AI, IDEs and shortcuts</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
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

          {/* Project directories: the one list Dashboard, contexts and agent dispatch share */}
          <section>
            <h3 className="text-sm font-medium text-gray-200">Project Directories</h3>
            <p className="text-xs text-gray-400 mt-1 mb-3">
              The single source for the dashboard scan, the project list of contexts and the
              directories agents may be dispatched in. Projects outside these folders only appear
              while an agent runs there.
            </p>
            {loading && !config ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="animate-spin text-blue-500" size={24} />
              </div>
            ) : config?.directories.length === 0 ? (
              <p className="text-gray-500 text-sm py-4">
                No directories configured. Add a directory below to start scanning for projects.
              </p>
            ) : (
              <ul className="space-y-2">
                {config?.directories.map((dir) => (
                  <li
                    key={dir}
                    className={`flex items-center gap-1 p-2 pl-3 bg-gray-900 rounded-lg border group ${
                      editingDirectory === dir ? 'border-blue-500' : 'border-gray-700'
                    }`}
                  >
                    <span
                      className="flex-1 min-w-0 text-gray-300 font-mono text-sm truncate"
                      title={dir}
                    >
                      {dir}
                    </span>
                    <button
                      onClick={() => {
                        setEditingDirectory(dir);
                        setNewDirectory(dir);
                      }}
                      disabled={loading}
                      className="p-2 text-gray-500 hover:text-white hover:bg-gray-700 rounded-lg opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all disabled:opacity-50"
                      title="Edit directory"
                      aria-label={`Edit ${dir}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleRemoveDirectory(dir)}
                      disabled={loading}
                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all disabled:opacity-50"
                      title="Remove directory"
                      aria-label={`Remove ${dir}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label htmlFor="admin-new-directory" className="block text-xs text-gray-400 mt-4 mb-2">
              {editingDirectory ? 'Replace directory' : 'Add directory'}
            </label>
            <div className="flex gap-2">
              <input
                id="admin-new-directory"
                type="text"
                value={newDirectory}
                onChange={(e) => setNewDirectory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDirectory()}
                placeholder="/Users/you/PROJECTS"
                className="flex-1 min-w-0 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleBrowseDirectory}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Browse for folder"
              >
                <FolderOpen size={18} />
              </button>
              {editingDirectory && (
                <button
                  onClick={() => {
                    setEditingDirectory(null);
                    setNewDirectory('');
                  }}
                  className="px-3 py-2 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleAddDirectory}
                disabled={loading || !newDirectory.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {editingDirectory ? <Save size={18} /> : <FolderPlus size={18} />}
                {editingDirectory ? 'Save' : 'Add'}
              </button>
            </div>
          </section>

          {/* Scan Depth */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Scan Depth</label>
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

          {/* Links Section (#140) */}
          <fieldset className="pt-4 border-t border-gray-700">
            <legend className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-300">
              <Globe className="text-blue-400" size={18} />
              Open links in
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['builtin', 'Built-in browser'],
                  ['system', 'System browser'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
                    linkTarget === value
                      ? 'border-blue-500 bg-blue-500/10 text-white'
                      : 'border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="linkTarget"
                    value={value}
                    checked={linkTarget === value}
                    onChange={() => handleLinkTargetChange(value)}
                    className="accent-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Links from terminals (Cmd/Ctrl-click), the app and VS Code (desktop app). Pages in the
              built-in browser keep an &quot;open externally&quot; button.
            </p>
          </fieldset>

          {/* IDE Settings Section */}
          <div className="pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Code className="text-blue-400" size={18} />
                <label className="text-sm font-medium text-gray-300">IDE Configuration</label>
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
                    onChange={(e) =>
                      setNewIDE({
                        ...newIDE,
                        id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                      })
                    }
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
              ) : installedIDEs.filter((ide) => !ide.custom).length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No IDEs detected</p>
              ) : (
                <div className="space-y-1">
                  {installedIDEs
                    .filter((ide) => !ide.custom)
                    .map((ide) => (
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

          {/* Board source (GitHub project behind /board) */}
          <div className="pt-4 border-t border-gray-700">
            <div className="flex items-center gap-2 mb-4">
              <Kanban className="text-emerald-400" size={18} />
              <label className="text-sm font-medium text-gray-300">Board-Quelle</label>
            </div>
            <form
              className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveBoardSource();
              }}
            >
              <p className="text-xs text-gray-500">
                GitHub-Project, das das Board zeigt (User oder Organisation + Project-Nummer).
              </p>
              <div className="flex gap-2">
                <label className="flex-1 text-xs text-gray-400">
                  Owner
                  <input
                    type="text"
                    value={boardSource.owner}
                    onChange={(e) =>
                      setBoardSource({ ...boardSource, owner: e.target.value.trim() })
                    }
                    placeholder="hpmartini"
                    pattern="[A-Za-z0-9\-]{1,39}"
                    required
                    className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </label>
                <label className="w-28 text-xs text-gray-400">
                  Project-Nr.
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={boardSource.number || ''}
                    onChange={(e) =>
                      setBoardSource({ ...boardSource, number: Number(e.target.value) })
                    }
                    required
                    className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                {boardSourceSaved && (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle size={14} />
                    Gespeichert
                  </span>
                )}
                <button
                  type="submit"
                  disabled={boardSourceLoading}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
                >
                  <Save size={14} />
                  Speichern
                </button>
              </div>
            </form>
          </div>

          {/* Keyboard Shortcuts Section */}
          <div className="pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Keyboard className="text-purple-400" size={18} />
                <label className="text-sm font-medium text-gray-300">Keyboard Shortcuts</label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleResetShortcuts}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                >
                  Reset to Defaults
                </button>
                {shortcutsDirty && (
                  <button
                    onClick={handleSaveShortcuts}
                    disabled={shortcutsLoading}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                  >
                    <Save size={12} />
                    Save
                  </button>
                )}
              </div>
            </div>

            {shortcutsLoading && !shortcuts ? (
              <div className="flex items-center gap-2 py-4">
                <RefreshCw className="animate-spin text-blue-500" size={14} />
                <span className="text-sm text-gray-400">Loading shortcuts...</span>
              </div>
            ) : (
              <div className="space-y-2">
                {(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS) as (keyof KeyboardShortcuts)[]).map(
                  (shortcutId) => {
                    // Saved settings may lack newer keys or keep removed ones (sidebar shortcuts, #119)
                    const shortcut =
                      shortcuts[shortcutId] ?? DEFAULT_KEYBOARD_SHORTCUTS[shortcutId];
                    const isEditing = editingShortcut === shortcutId;

                    return (
                      <div
                        key={shortcutId}
                        className="flex items-center justify-between p-2 bg-gray-900 rounded border border-gray-700"
                      >
                        <span className="text-sm text-gray-300">{shortcut.description}</span>
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            readOnly
                            placeholder="Press keys..."
                            onKeyDown={(e) => handleShortcutKeyDown(e, shortcutId)}
                            onBlur={() => setEditingShortcut(null)}
                            className="w-32 px-2 py-1 text-xs bg-blue-900/50 border border-blue-500 rounded text-white text-center focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => setEditingShortcut(shortcutId)}
                            className="px-3 py-1 text-xs font-mono bg-gray-800 hover:bg-gray-700 hover:text-white text-gray-300 rounded border border-gray-600 transition-colors min-w-[80px]"
                          >
                            {formatShortcut(shortcut)}
                          </button>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            )}

            <p className="text-xs text-gray-500 mt-3">
              Click a shortcut to edit it, then press your desired key combination.
            </p>
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
