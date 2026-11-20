import type { ModeEntry } from '../hooks/useModules';
import { moduleIcon } from './moduleIcon';

/**
 * `host.renderPaneActions` of the agents view: in an orchestrator pane (tab or split) one
 * `Show in <label>` per module mode with `orchestratorFilter` (docs/MODULES.md). The key is the
 * one reports are stored under: the role id, else the session's row id. Nothing without a module.
 */
export const paneModeActions =
  (modes: ModeEntry[], navigate: (to: string) => void) =>
  ({
    orchestrator,
    role,
    session,
  }: {
    orchestrator: boolean;
    role: string | null;
    session: { id: string };
  }) => {
    const filters = modes.filter((m) => m.orchestratorFilter);
    if (!orchestrator || filters.length === 0) return null;
    const key = role ?? session.id;
    return filters.map((m) => {
      const Icon = moduleIcon(m.icon);
      return (
        <button
          key={m.id}
          type="button"
          onClick={() => navigate(`/${m.id}?orchestrator=${encodeURIComponent(key)}`)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-600 text-gray-200 shrink-0 hover:border-cursor/60 hover:bg-white/5"
        >
          <Icon size={11} aria-hidden="true" /> Show in {m.label}
        </button>
      );
    });
  };
