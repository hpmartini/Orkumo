import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModeEntry } from '../hooks/useModules';
import { moduleIcon } from './moduleIcon';
import { ModuleMount, useModuleHost } from './ModuleMount';

/** What agents-ui hands `renderPaneActions`/`renderPaneView` (the parts used here) */
interface PaneArg {
  paneId: string;
  orchestrator: boolean;
  role: string | null;
  session: { id: string };
  /** One report task's details for the maximised threads panel (agents-ui >= 0.4.33) */
  statusTask?: { project: string; task: string };
  onClose?: () => void;
}

/**
 * A module mode inside one agent pane: its UI with `host.pane` and the query string fixed to
 * this orchestrator (docs/MODULES.md, "Frontend"). Takes the keys; Esc goes back to the agent.
 */
function PaneModeView({
  modeId,
  orchestrator,
  task,
  onClose,
}: {
  modeId: string;
  orchestrator: string;
  task?: { project: string; task: string };
  onClose: () => void;
}) {
  const base = useModuleHost(true);
  const host = useMemo(
    () => ({
      ...base,
      search: `orchestrator=${encodeURIComponent(orchestrator)}`,
      setSearch: () => {},
      pane: task ? { orchestrator, task } : { orchestrator },
    }),
    [base, orchestrator, task]
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="flex-1 min-h-0 flex flex-col outline-none"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // taken: the maximised threads panel around it must not restore on the same key
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <ModuleMount id={modeId} host={host} className="flex-1 min-h-0" />
    </div>
  );
}

/**
 * `host.renderPaneActions`/`renderPaneView` of the agents view: in an orchestrator pane (tab or
 * split) one `Show in <label>` per module mode with `orchestratorFilter` (docs/MODULES.md). It
 * toggles that pane, and only that one, between the agent and the mode filtered on the key reports
 * are stored under: the role id, else the session's row id. Nothing without a module.
 */
export function usePaneModes(modes: ModeEntry[]) {
  // paneId -> mode shown in place of the agent; not persisted, a reload shows the agents again
  const [open, setOpen] = useState<Record<string, string>>({});
  const filters = useMemo(() => modes.filter((m) => m.orchestratorFilter), [modes]);
  return useMemo(() => {
    const set = (paneId: string, modeId: string | null) =>
      setOpen((prev) => {
        const { [paneId]: _closed, ...rest } = prev;
        return modeId ? { ...rest, [paneId]: modeId } : rest;
      });
    const usable = (p: PaneArg) => p.orchestrator && filters.length > 0;
    return {
      renderPaneActions: (p: PaneArg) =>
        usable(p)
          ? filters.map((m) => {
              const Icon = moduleIcon(m.icon);
              const shown = open[p.paneId] === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={shown}
                  title={shown ? 'Back to the agent (Esc)' : undefined}
                  onClick={() => set(p.paneId, shown ? null : m.id)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded border shrink-0 ${
                    shown
                      ? 'border-blue-400/70 bg-blue-500/20 text-white hover:bg-blue-500/30'
                      : 'border-gray-600 text-gray-200 hover:border-cursor/60 hover:bg-white/5'
                  }`}
                >
                  <Icon size={11} aria-hidden="true" /> Show in {m.label}
                </button>
              );
            })
          : null,
      renderPaneView: (p: PaneArg) => {
        // H-6: a task's details in the maximised threads panel, apart from the pane's toggle
        if (p.statusTask && p.onClose) {
          if (!usable(p)) return null;
          // shortcut: the first filtering module is Status (the only one), pick by id once there are more
          const mode = filters[0];
          return (
            <PaneModeView
              key={`${mode.id} ${p.statusTask.project} ${p.statusTask.task}`}
              modeId={mode.id}
              orchestrator={p.role ?? p.session.id}
              task={p.statusTask}
              onClose={p.onClose}
            />
          );
        }
        const mode = usable(p) ? filters.find((m) => m.id === open[p.paneId]) : undefined;
        return mode ? (
          <PaneModeView
            key={mode.id}
            modeId={mode.id}
            orchestrator={p.role ?? p.session.id}
            onClose={() => set(p.paneId, null)}
          />
        ) : null;
      },
    };
  }, [filters, open]);
}
