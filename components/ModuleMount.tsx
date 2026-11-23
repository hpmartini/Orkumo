import { useContext, useEffect, useMemo, useRef } from 'react';
import { RailOutletContext } from '@hpmartini/agents-ui/components/AgentsView/railOutlet';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../utils/apiConfig';
import { boardUrl, codeUrl } from '../utils/codeTarget';
import { isAgentTarget, setAgentTarget, useAgentTarget } from '../utils/agentTarget';
import { openInstruct, type InstructTarget } from './InstructDialog';
import {
  connectBackend,
  disconnectBackend,
  getBackend,
  type Backend,
} from '../utils/backendTarget';
import { isModuleLoaded, useModulesGeneration } from '../hooks/useModules';

/** What the shell hands a module UI on mount and on every update (docs/MODULES.md, "Frontend") */
export interface ModuleHost {
  active: boolean;
  search: string;
  navigate: (to: string) => void;
  setSearch: (params: Record<string, string>) => void;
  apiBase: string;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
  urls: {
    code: (path: string) => string;
    board: (repo: string, agentId?: string) => string;
    agent: (jobId: string) => string;
  };
  /** Instance the AgentsView talks to: '' (this machine) or a module API prefix (#220) */
  agentTarget: string;
  /** Switches it; only '' or `/modules/<id>/...` is accepted. Open tabs keep their instance. */
  setAgentTarget: (target: string) => void;
  /** Instance the whole UI talks to (docs/MODULES.md, "Backend target"); null is this machine */
  backend: Backend | null;
  /** Connects the whole UI to `/api<prefix>` and reloads; only `/modules/<id>/...` is accepted */
  connectBackend: (prefix: string, label: string) => void;
  /** Back to this machine; reloads */
  disconnectBackend: () => void;
  /** Set when the UI is shown inside an orchestrator's agent pane (`Show in <label>`) */
  pane?: { orchestrator: string };
  /** Opens the Instruct dialog: one message about this item to its orchestrator (Status view) */
  instruct: (target: InstructTarget) => void;
  /**
   * Opens agent `jobId` of instance `target` ('' or a module prefix, like `setAgentTarget`) in a
   * tab once it is listed: beside the rail in a `rail` mode, else in Agents
   */
  openAgent: (jobId: string, target?: string) => void;
  /** Mode with `rail`: the rail column to render the mode's own items into while visible, else null */
  rail: HTMLElement | null;
  /** Mode with `rail`: the agents workspace (tabs) shows in place of the mode's main area */
  workspace: boolean;
  /** Mode with `rail`: workspace (true) or the mode's main area (false); does nothing elsewhere */
  showWorkspace: (visible: boolean) => void;
}

/** What the shell gives a mode with `rail` (docs/MODULES.md, "Modes") */
export interface ModeShell {
  workspace: boolean;
  showWorkspace: (visible: boolean) => void;
  openAgent: (jobId: string, target?: string) => void;
}

interface MountHandle {
  update?: (host: ModuleHost) => void;
  unmount?: () => void;
}

const urls: ModuleHost['urls'] = {
  code: codeUrl,
  board: boardUrl,
  agent: (jobId) => `/agents?attach=${encodeURIComponent(jobId)}`,
};
const hostToast: ModuleHost['toast'] = {
  success: (msg) => void toast.success(msg),
  error: (msg) => void toast.error(msg),
};

/**
 * Host object for a module UI; a new one whenever `active`, the query string, the agent target or
 * the mode shell (`rail` modes) changes
 */
export function useModuleHost(
  active: boolean,
  shell?: ModeShell,
  rail: HTMLElement | null = null
): ModuleHost {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [, setSearchParams] = useSearchParams();
  const agentTarget = useAgentTarget();
  // Both change identity on every route change; refs keep updates to active/search changes
  const router = useRef({ navigate, setSearchParams });
  useEffect(() => {
    router.current = { navigate, setSearchParams };
  }, [navigate, setSearchParams]);
  return useMemo(
    () => ({
      active,
      search,
      navigate: (to) => router.current.navigate(to),
      setSearch: (params) => router.current.setSearchParams(params),
      apiBase: API_BASE_URL,
      toast: hostToast,
      urls,
      agentTarget,
      setAgentTarget,
      backend: getBackend(),
      connectBackend,
      disconnectBackend,
      instruct: openInstruct,
      openAgent:
        shell?.openAgent ??
        ((jobId, target = '') => {
          if (!jobId || !isAgentTarget(target)) return;
          setAgentTarget(target);
          router.current.navigate(urls.agent(jobId));
        }),
      rail,
      workspace: shell?.workspace ?? false,
      showWorkspace: shell?.showWorkspace ?? (() => {}),
    }),
    [active, search, agentTarget, shell, rail]
  );
}

/**
 * Hands a module's UI its own empty div: ui.js exports mount(el, host) -> cleanup | { update, unmount }.
 * Not a React component, since a bundled module brings its own React copy (docs/MODULES.md).
 */
export function ModuleMount({
  id,
  host,
  className,
}: {
  id: string;
  host: ModuleHost;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<MountHandle | null>(null);
  // mount() gets the host current when the import resolves, not the one of the first render
  const hostRef = useRef(host);
  // After a module reload: unmount, then import the new ui.js (new URL, the browser caches per URL)
  const gen = useModulesGeneration();

  useEffect(() => {
    hostRef.current = host;
    handle.current?.update?.(host);
  }, [host]);

  useEffect(() => {
    let cancelled = false;
    // The list refetch removes this mount right after; importing now would only 404
    if (!isModuleLoaded(id)) return;
    const src = `${API_BASE_URL}/modules/${id}/ui.js`;
    import(/* @vite-ignore */ gen ? `${src}?v=${gen}` : src)
      .then((mod) => {
        if (cancelled || !ref.current) return;
        const result = mod.mount(ref.current, hostRef.current);
        handle.current = typeof result === 'function' ? { unmount: result } : (result ?? null);
      })
      .catch((error) => console.error(`[Modules] UI of "${id}" failed to load:`, error));
    return () => {
      cancelled = true;
      handle.current?.unmount?.();
      handle.current = null;
    };
  }, [id, gen]);

  return <div ref={ref} data-module={id} className={className} />;
}

/**
 * A module's work mode at /<id>: kept mounted, told via `active` whether it is visible. A `rail`
 * mode gets `shell` and, while visible, the rail column (every route below AgentsView sees it).
 */
export function ModuleMode({
  id,
  active,
  shell,
}: {
  id: string;
  active: boolean;
  shell?: ModeShell;
}) {
  const outlet = useContext(RailOutletContext);
  const host = useModuleHost(active, shell, shell && active ? outlet : null);
  return <ModuleMount id={id} host={host} className="flex-1 min-h-0" />;
}
