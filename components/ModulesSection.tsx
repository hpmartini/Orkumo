import { useEffect, useState } from 'react';
import { Puzzle, RefreshCw } from 'lucide-react';
import { fetchModuleStatus, reloadModules, type ModuleStatus } from '../hooks/useModules';

/**
 * Admin panel: loaded modules with version and load error, and "Module neu laden" without a restart
 * (docs/MODULES.md, "Lifecycle"). Local only: hidden where the status route refuses (iOS app, remote backend).
 */
export function ModulesSection() {
  const [modules, setModules] = useState<ModuleStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloaded, setReloaded] = useState(false);

  useEffect(() => {
    fetchModuleStatus()
      .then(setModules)
      .catch(() => setModules(null));
  }, []);

  async function reload() {
    setBusy(true);
    setError('');
    setReloaded(false);
    try {
      setModules(await reloadModules());
      setReloaded(true);
    } catch (e) {
      setError(`Neu laden fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!modules) return null;

  return (
    <div className="pt-4 border-t border-gray-700" data-testid="modules-section">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Puzzle className="text-amber-400" size={18} />
          <label className="text-sm font-medium text-gray-300">Module</label>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          Module neu laden
        </button>
      </div>
      <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-2">
        {modules.length === 0 ? (
          <p className="text-xs text-gray-500">Keine Module installiert.</p>
        ) : (
          <ul className="space-y-1.5">
            {modules.map((m) => (
              <li key={m.entry} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-gray-200" title={m.entry}>
                    {m.name ?? m.entry}
                  </span>
                  <span className="text-xs text-gray-500 font-mono">
                    {m.version ? `v${m.version}` : 'Version unbekannt'}
                  </span>
                  <span
                    className={`rounded-full px-1.5 text-[10.5px] font-medium leading-[18px] border ${
                      m.status === 'loaded'
                        ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
                        : 'border-red-400/60 bg-red-400/10 text-red-300'
                    }`}
                  >
                    {m.status === 'loaded' ? 'geladen' : 'Fehler'}
                  </span>
                </div>
                {m.error && (
                  <p className="text-xs text-red-400 break-words font-mono mt-0.5">{m.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {reloaded && (
          <p role="status" className="text-xs text-emerald-400">
            Neu geladen, ohne Neustart.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
