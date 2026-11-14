import { Unplug } from 'lucide-react';
import { disconnectBackend, getBackend } from '../utils/backendTarget';

/**
 * Host-owned bar while the UI talks to another instance (docs/MODULES.md, "Backend target"):
 * shown in every mode, so the way back never depends on a module of the remote instance.
 */
export function BackendBar() {
  const backend = getBackend();
  if (!backend) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 px-3 py-1 text-xs bg-blue-900/60 border-b border-blue-800 text-blue-100"
    >
      <span className="min-w-0 truncate">
        Verbunden mit <span className="font-semibold">{backend.label}</span>
      </span>
      <button
        type="button"
        onClick={disconnectBackend}
        className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-blue-100 hover:text-white hover:bg-blue-800"
      >
        <Unplug size={12} /> Trennen
      </button>
    </div>
  );
}
