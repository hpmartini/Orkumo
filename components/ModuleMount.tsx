import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../utils/apiConfig';
import { boardUrl, codeUrl } from '../utils/codeTarget';

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

/** Host object for a module UI; a new one whenever `active` or the query string changes */
export function useModuleHost(active: boolean): ModuleHost {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [, setSearchParams] = useSearchParams();
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
    }),
    [active, search]
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

  useEffect(() => {
    hostRef.current = host;
    handle.current?.update?.(host);
  }, [host]);

  useEffect(() => {
    let cancelled = false;
    import(/* @vite-ignore */ `${API_BASE_URL}/modules/${id}/ui.js`)
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
  }, [id]);

  return <div ref={ref} data-module={id} className={className} />;
}

/** A module's work mode at /<id>: kept mounted, told via `active` whether it is visible */
export function ModuleMode({ id, active }: { id: string; active: boolean }) {
  return <ModuleMount id={id} host={useModuleHost(active)} className="flex-1 min-h-0" />;
}
