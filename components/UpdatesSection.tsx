import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  CircleArrowUp,
  ExternalLink,
  Loader2,
  RotateCw,
  X,
} from 'lucide-react';
import type { UpdateStatus } from '../electron/electron';
import { fetchSettings, updateAutoUpdate } from '../services/api';

/** Live update status from the desktop app (electron/updater.js); null in the browser. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.updates;
    if (!api) return;
    let alive = true;
    api
      .getStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    const off = api.onStatus(setStatus);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return status;
}

/* global __APP_VERSION__ -- vite.config.ts `define`; absent under vitest */
const webVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;

function formatTime(ms: number | null): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const buttonBase =
  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300';
const primaryButton = `${buttonBase} bg-blue-600 hover:bg-blue-500 text-white`;
const secondaryButton = `${buttonBase} bg-gray-700 hover:bg-gray-600 text-gray-100`;

/** Starts "Restart to update"; the app quits on success, so only a failure comes back. */
async function restartToUpdate(): Promise<string | null> {
  try {
    const result = await window.electronAPI!.updates.install();
    return result.success ? null : (result.error ?? 'The update could not be installed');
  } catch (err) {
    return err instanceof Error ? err.message : 'The update could not be installed';
  }
}

function openRelease(url: string) {
  window.electronAPI?.openExternal(url);
}

function StatusLine({ status }: { status: UpdateStatus }) {
  const v = status.version;
  switch (status.state) {
    case 'checking':
      return (
        <span className="flex items-center gap-2 text-gray-300">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none text-blue-400" />
          Checking for updates…
        </span>
      );
    case 'none':
      return (
        <span className="flex items-center gap-2 text-gray-300">
          <CheckCircle size={14} className="text-green-400" />
          Orkumo is up to date
        </span>
      );
    case 'available':
      return (
        <span className="flex items-center gap-2 text-gray-300">
          <CircleArrowUp size={14} className="text-blue-400" />
          Orkumo {v} is available. This installation cannot replace itself: install it from the
          release page.
        </span>
      );
    case 'downloading':
      return (
        <span className="flex flex-col gap-1.5 text-gray-300">
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none text-blue-400" />
            Downloading Orkumo {v}… {status.percent ?? 0}%
          </span>
          <ProgressBar percent={status.percent ?? 0} label={`Downloading Orkumo ${v}`} />
        </span>
      );
    case 'ready':
      return (
        <span className="flex items-center gap-2 text-gray-300">
          <CircleArrowUp size={14} className="text-blue-400" />
          Orkumo {v} is ready. Restart to update.
        </span>
      );
    case 'error':
      return (
        <span className="flex items-start gap-2 text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Update failed: {status.error}. Check your connection and try again; details are in the
            app log.
          </span>
        </span>
      );
    default:
      return <span className="text-gray-400">Not checked yet</span>;
  }
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="block h-1 w-full overflow-hidden rounded-full bg-gray-700"
    >
      <span
        className="block h-full bg-blue-500 transition-[width] motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

/** Settings → Updates: version, channel, last check, manual check, restart, auto-update toggle. */
export function UpdatesSection() {
  const api = window.electronAPI?.updates;
  const status = useUpdateStatus();
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // a failed restart belongs to the update it tried to install
  useEffect(() => setInstallError(null), [status?.version]);
  // Remote client (ORKUMO_REMOTE): the settings API is another machine's, the toggle would land there
  const remote = Boolean(window.electronAPI?.remoteLink);

  useEffect(() => {
    if (!api || remote) return;
    fetchSettings()
      .then((s) => setAutoUpdate(s.autoUpdate !== false))
      .catch(() => setAutoUpdate(true));
  }, [api, remote]);

  const toggleAuto = async () => {
    if (autoUpdate === null) return;
    const next = !autoUpdate;
    setAutoUpdate(next);
    setSaveError(null);
    try {
      await updateAutoUpdate(next);
    } catch (err) {
      setAutoUpdate(!next);
      setSaveError(err instanceof Error ? err.message : 'Failed to save the auto-update setting');
    }
  };

  const version = status?.currentVersion ?? webVersion;
  const busy = status?.state === 'checking' || status?.state === 'downloading';
  const off = status?.mode === 'off';

  return (
    <section className="pt-4 border-t border-gray-700" aria-labelledby="updates-heading">
      <div className="flex items-center gap-2 mb-4">
        <CircleArrowUp className="text-blue-400" size={18} />
        <h3 id="updates-heading" className="text-sm font-medium text-gray-300">
          Updates
        </h3>
      </div>
      <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-3 text-xs">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
          <dt className="text-gray-400">Version</dt>
          <dd className="font-mono text-gray-100">
            {version ?? 'unknown'}
            {status?.channel && (
              <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 font-sans text-gray-300">
                {status.channel}
              </span>
            )}
          </dd>
          {api && !off && (
            <>
              <dt className="text-gray-400">Last check</dt>
              <dd className="text-gray-200">{formatTime(status?.lastCheck ?? null)}</dd>
            </>
          )}
        </dl>

        {api && off && (
          <p className="text-gray-400">
            Updates are off in this build (development build or{' '}
            <code>ORKUMO_DISABLE_UPDATES=1</code>
            ).
          </p>
        )}

        {api && status && !off && (
          <>
            <div aria-live="polite">
              <StatusLine status={status} />
            </div>
            {installError && status.state === 'ready' && (
              <p className="text-red-300">
                Restart failed: {installError}. Quit Orkumo and start it again to retry.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {status.state === 'ready' && (
                <button
                  type="button"
                  className={primaryButton}
                  onClick={async () => setInstallError(await restartToUpdate())}
                >
                  <RotateCw size={14} />
                  Restart to update
                </button>
              )}
              {status.state === 'available' && status.releaseUrl && (
                <button
                  type="button"
                  className={primaryButton}
                  onClick={() => openRelease(status.releaseUrl!)}
                >
                  <ExternalLink size={14} />
                  Open release page
                </button>
              )}
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={() => api.check()}
              >
                {status.state === 'checking' ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <RotateCw size={14} />
                )}
                Check now
              </button>
            </div>
            {!remote && autoUpdate !== null && (
              <div className="flex items-center gap-3 pt-1">
                <span className="flex flex-col gap-0.5">
                  <span id="auto-update-label" className="text-gray-200">
                    Update automatically
                  </span>
                  <span className="text-gray-400">
                    Checks every 6 hours, downloads in the background, installs on quit
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoUpdate}
                  aria-labelledby="auto-update-label"
                  onClick={toggleAuto}
                  className={`ml-auto shrink-0 relative w-8 h-4 rounded-full transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${
                    autoUpdate ? 'bg-blue-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform motion-reduce:transition-none ${
                      autoUpdate ? 'translate-x-4' : ''
                    }`}
                  />
                </button>
              </div>
            )}
            {saveError && <p className="text-red-300">{saveError}. Try the switch again.</p>}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Small non-blocking banner (bottom right) for the desktop app: download progress, "ready — Restart to
 * update", and the outcome of a check the user started. Background failures stay silent (#125).
 */
export function UpdateBanner() {
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  useEffect(() => setInstallError(null), [status?.version]);

  const key = status ? `${status.state}:${status.version ?? ''}:${status.lastCheck ?? ''}` : '';

  // "Up to date" after a manual check fades on its own
  useEffect(() => {
    if (status?.state !== 'none' || !status.manual) return;
    const timer = setTimeout(() => setDismissed(key), 4000);
    return () => clearTimeout(timer);
  }, [status?.state, status?.manual, key]);

  if (!status || dismissed === key) return null;
  const v = status.version;
  const manualOnly = ['checking', 'none', 'error'].includes(status.state);
  if (manualOnly && !status.manual) return null;
  if (status.state === 'idle') return null;

  let body: React.ReactNode;
  let action: React.ReactNode = null;
  if (status.state === 'ready') {
    body = (
      <>
        Orkumo <span className="font-mono">{v}</span> is ready
      </>
    );
    action = (
      <button
        type="button"
        className={primaryButton}
        onClick={async () => setInstallError(await restartToUpdate())}
      >
        <RotateCw size={14} />
        Restart to update
      </button>
    );
  } else if (status.state === 'downloading') {
    body = (
      <span className="flex flex-col gap-1.5">
        <span>
          Downloading Orkumo <span className="font-mono">{v}</span>… {status.percent ?? 0}%
        </span>
        <ProgressBar percent={status.percent ?? 0} label={`Downloading Orkumo ${v}`} />
      </span>
    );
  } else if (status.state === 'available' && status.releaseUrl) {
    body = (
      <>
        Orkumo <span className="font-mono">{v}</span> is available
      </>
    );
    action = (
      <button
        type="button"
        className={primaryButton}
        onClick={() => openRelease(status.releaseUrl!)}
      >
        <ExternalLink size={14} />
        Open release page
      </button>
    );
  } else if (status.state === 'checking') {
    body = (
      <span className="flex items-center gap-2">
        <Loader2 size={14} className="animate-spin motion-reduce:animate-none text-blue-400" />
        Checking for updates…
      </span>
    );
  } else if (status.state === 'none') {
    body = (
      <span className="flex items-center gap-2">
        <CheckCircle size={14} className="text-green-400" />
        Orkumo {status.currentVersion} is up to date
      </span>
    );
  } else if (status.state === 'error') {
    body = (
      <span className="flex items-start gap-2 text-red-300">
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
        <span>
          Update check failed: {status.error}. Try again with Check now in Settings → Updates.
        </span>
      </span>
    );
  } else {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-gray-700 bg-gray-800 p-3 text-xs text-gray-200 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{body}</div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(key)}
          className="-m-1 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
        >
          <X size={14} />
        </button>
      </div>
      {installError && status.state === 'ready' && (
        <p className="mt-2 text-red-300">
          Restart failed: {installError}. Quit Orkumo and start it again to retry.
        </p>
      )}
      {action && <div className="mt-2 flex justify-end">{action}</div>}
    </div>
  );
}
