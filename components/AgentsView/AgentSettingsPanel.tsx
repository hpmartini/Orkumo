import React, { useState } from 'react';
import { X, Settings2, AlertTriangle, Power, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  AgentViewSettings,
  AgentDispatchDefaults,
  ClaudeUserSettings,
  AgentDaemonStatus,
  AgentRepo,
} from '../../types';
import { stopAgentDaemon, respawnAllAgents } from '../../services/agentsApi';

interface AgentSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: AgentViewSettings;
  onUpdate: (partial: Partial<AgentViewSettings>) => Promise<void>;
  userSettings: ClaudeUserSettings | null;
  daemon: AgentDaemonStatus | null;
  repos: AgentRepo[];
  onRefresh: () => void;
}

const PERMISSION_MODES = [
  '',
  'default',
  'plan',
  'acceptEdits',
  'dontAsk',
  'auto',
  'bypassPermissions',
];
const EFFORTS = ['', 'standard', 'high', 'ultracode'];
const MODELS = ['', 'default', 'opus', 'sonnet', 'haiku'];

function listToText(list: string[]): string {
  return list.join('\n');
}
function textToList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Dispatch defaults (the flags `claude agents` accepts) and view preferences.
 */
export const AgentSettingsPanel: React.FC<AgentSettingsPanelProps> = ({
  open,
  onClose,
  settings,
  onUpdate,
  userSettings,
  daemon,
  repos,
  onRefresh,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  if (!open) return null;

  const dispatch = settings.dispatch;
  const setDispatch = (partial: Partial<AgentDispatchDefaults>) =>
    onUpdate({ dispatch: { ...dispatch, ...partial } });

  const runDaemon = async (label: string, fn: () => Promise<{ output: string }>) => {
    setBusy(label);
    try {
      const result = await fn();
      toast.success(result.output ? result.output.split('\n')[0] : `${label} done`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const field =
    'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-blue-500';
  const label = 'block text-xs text-gray-400 mb-1';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <Settings2 size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-100">Agent view settings</h3>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* View */}
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-gray-500">View</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={label}>Scope (claude agents --cwd)</label>
                <select
                  className={field}
                  value={settings.scopeCwd || ''}
                  onChange={(e) => onUpdate({ scopeCwd: e.target.value || null })}
                >
                  <option value="">All sessions</option>
                  {repos.map((repo) => (
                    <option key={repo.path} value={repo.path}>
                      {repo.name} — {repo.path}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Group by</label>
                <select
                  className={field}
                  value={settings.grouping}
                  onChange={(e) =>
                    onUpdate({ grouping: e.target.value as AgentViewSettings['grouping'] })
                  }
                >
                  <option value="state">
                    State (pinned · review · needs input · working · completed)
                  </option>
                  <option value="directory">Directory</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-gray-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.notifications}
                  onChange={(e) => onUpdate({ notifications: e.target.checked })}
                />
                In-app notifications (needs input · finished · failed)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.desktopNotifications}
                  onChange={async (e) => {
                    if (
                      e.target.checked &&
                      typeof Notification !== 'undefined' &&
                      Notification.permission !== 'granted'
                    ) {
                      const permission = await Notification.requestPermission();
                      if (permission !== 'granted') {
                        toast.error('Browser notifications were not allowed');
                        return;
                      }
                    }
                    onUpdate({ desktopNotifications: e.target.checked });
                  }}
                />
                Browser notifications when the tab is hidden
              </label>
            </div>
          </section>

          {/* Dispatch defaults */}
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-gray-500">
              Dispatch defaults (flags of `claude agents`)
            </h4>
            {userSettings && (
              <div className="text-xs text-gray-500">
                From ~/.claude/settings.json: model{' '}
                <span className="text-gray-300">{userSettings.model || 'default'}</span>, effort{' '}
                <span className="text-gray-300">{userSettings.effortLevel || 'default'}</span>,
                permission mode{' '}
                <span className="text-gray-300">{userSettings.permissionMode || 'default'}</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={label}>--model</label>
                <input
                  list="agent-model-options"
                  className={field}
                  value={dispatch.model || ''}
                  placeholder="default"
                  onChange={(e) => setDispatch({ model: e.target.value || null })}
                />
                <datalist id="agent-model-options">
                  {MODELS.filter(Boolean).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={label}>--effort</label>
                <select
                  className={field}
                  value={dispatch.effort || ''}
                  onChange={(e) => setDispatch({ effort: e.target.value || null })}
                >
                  {EFFORTS.map((e) => (
                    <option key={e} value={e}>
                      {e || 'default'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>--permission-mode</label>
                <select
                  className={field}
                  value={dispatch.permissionMode || ''}
                  onChange={(e) => setDispatch({ permissionMode: e.target.value || null })}
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m || 'directory rules'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>--agent (default subagent)</label>
                <input
                  className={field}
                  value={dispatch.agent || ''}
                  placeholder="none"
                  onChange={(e) => setDispatch({ agent: e.target.value || null })}
                />
              </div>
              <div>
                <label className={label}>--fallback-model</label>
                <input
                  className={field}
                  value={dispatch.fallbackModel || ''}
                  placeholder="none"
                  onChange={(e) => setDispatch({ fallbackModel: e.target.value || null })}
                />
              </div>
              <div>
                <label className={label}>--settings (file or JSON)</label>
                <input
                  className={field}
                  value={dispatch.settings || ''}
                  placeholder="./ci-settings.json"
                  onChange={(e) => setDispatch({ settings: e.target.value || null })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={label}>--add-dir (one per line)</label>
                <textarea
                  className={`${field} font-mono text-xs`}
                  rows={3}
                  value={listToText(dispatch.addDirs)}
                  onChange={(e) => setDispatch({ addDirs: textToList(e.target.value) })}
                />
              </div>
              <div>
                <label className={label}>--plugin-dir (one per line)</label>
                <textarea
                  className={`${field} font-mono text-xs`}
                  rows={3}
                  value={listToText(dispatch.pluginDirs)}
                  onChange={(e) => setDispatch({ pluginDirs: textToList(e.target.value) })}
                />
              </div>
              <div>
                <label className={label}>--mcp-config (file or JSON, one per line)</label>
                <textarea
                  className={`${field} font-mono text-xs`}
                  rows={3}
                  value={listToText(dispatch.mcpConfigs)}
                  onChange={(e) => setDispatch({ mcpConfigs: textToList(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-gray-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dispatch.strictMcpConfig}
                  onChange={(e) => setDispatch({ strictMcpConfig: e.target.checked })}
                />
                --strict-mcp-config
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dispatch.restricted}
                  onChange={(e) => setDispatch({ restricted: e.target.checked })}
                />
                --restricted
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dispatch.allowSkipPermissions}
                  onChange={(e) => setDispatch({ allowSkipPermissions: e.target.checked })}
                />
                --allow-dangerously-skip-permissions
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-orange-300">
                <input
                  type="checkbox"
                  checked={dispatch.skipPermissions}
                  onChange={(e) => {
                    if (
                      e.target.checked &&
                      !window.confirm(
                        'Start every dispatched session with --dangerously-skip-permissions? Claude will run commands without asking.'
                      )
                    )
                      return;
                    setDispatch({ skipPermissions: e.target.checked });
                  }}
                />
                --dangerously-skip-permissions
              </label>
            </div>
            {dispatch.skipPermissions && (
              <div className="flex items-start gap-2 text-xs text-red-300 bg-red-900/20 border border-red-800 rounded p-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Bypass mode is on for new sessions. Only use this in trusted environments.
              </div>
            )}
          </section>

          {/* Supervisor */}
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-gray-500">
              Background service (supervisor)
            </h4>
            <pre className="text-[11px] text-gray-400 bg-gray-950 border border-gray-800 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {daemon?.raw || 'status unavailable'}
            </pre>
            {daemon?.versionMismatch && (
              <div className="text-xs text-yellow-300">
                The supervisor runs a different Claude Code version. Stop it (--any) so it restarts
                on the current version.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={!!busy}
                onClick={() => runDaemon('respawn --all', respawnAllAgents)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 disabled:opacity-50"
              >
                <RefreshCw size={12} /> claude respawn --all
              </button>
              <button
                disabled={!!busy}
                onClick={() =>
                  runDaemon('daemon stop --keep-workers', () =>
                    stopAgentDaemon({ keepWorkers: true })
                  )
                }
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 disabled:opacity-50"
              >
                <Power size={12} /> claude daemon stop --keep-workers
              </button>
              <button
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm('Stop the supervisor and all background sessions?')) {
                    runDaemon('daemon stop --any', () => stopAgentDaemon({ any: true }));
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-red-900/40 hover:bg-red-900/60 text-sm text-red-200 disabled:opacity-50"
              >
                <Power size={12} /> claude daemon stop --any
              </button>
            </div>
          </section>

          {/* Turn off */}
          <section className="space-y-2">
            <h4 className="text-xs uppercase tracking-wider text-gray-500">Turn off</h4>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.disabled}
                onChange={(e) => onUpdate({ disabled: e.target.checked })}
              />
              Hide the agent view in DevOrbit (mirrors the CLI `disableAgentView` setting)
            </label>
            {userSettings?.disableAgentView && (
              <div className="text-xs text-yellow-300">
                The CLI agent view is turned off via `disableAgentView` /
                CLAUDE_CODE_DISABLE_AGENT_VIEW. Background sessions still work from here.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
