import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type {
  AgentSession,
  AgentDaemonStatus,
  ClaudeUserSettings,
  AgentViewSettings,
  AgentNotification,
} from '../types';
import { DEFAULT_AGENT_VIEW_SETTINGS } from '../types';
import {
  fetchAgents,
  subscribeToAgents,
  fetchAgentViewSettings,
  updateAgentViewSettings,
} from '../services/agentsApi';
import { summarizeSessions } from '../utils/agentSessions';

interface UseAgentSessionsOptions {
  /** When false, no SSE subscription is opened (view not visible) */
  active?: boolean;
}

/**
 * Loads the agent view settings, keeps the session list live via SSE and
 * surfaces notifications (needs input / completed / failed).
 */
export function useAgentSessions({ active = true }: UseAgentSessionsOptions = {}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [daemon, setDaemon] = useState<AgentDaemonStatus | null>(null);
  const [userSettings, setUserSettings] = useState<ClaudeUserSettings | null>(null);
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<AgentViewSettings>(DEFAULT_AGENT_VIEW_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<{ count: number; at: number } | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAgents({ cwd: settingsRef.current.scopeCwd });
      setSessions(data.sessions);
      setDaemon(data.daemon);
      setUserSettings(data.userSettings);
      setCliInstalled(data.cli.installed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load settings once
  useEffect(() => {
    let mounted = true;
    fetchAgentViewSettings()
      .then((loaded) => {
        if (mounted)
          setSettings({
            ...DEFAULT_AGENT_VIEW_SETTINGS,
            ...loaded,
            dispatch: { ...DEFAULT_AGENT_VIEW_SETTINGS.dispatch, ...loaded.dispatch },
          });
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      mounted = false;
    };
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AgentViewSettings>) => {
    const previous = settingsRef.current;
    const optimistic: AgentViewSettings = {
      ...previous,
      ...partial,
      dispatch: { ...previous.dispatch, ...(partial.dispatch || {}) },
    };
    setSettings(optimistic);
    try {
      const saved = await updateAgentViewSettings(partial);
      setSettings({
        ...DEFAULT_AGENT_VIEW_SETTINGS,
        ...saved,
        dispatch: { ...DEFAULT_AGENT_VIEW_SETTINGS.dispatch, ...saved.dispatch },
      });
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : 'Failed to save agent view settings');
    }
  }, []);

  // Initial fetch and refetch when scope changes
  useEffect(() => {
    if (!active) return;
    refresh();
  }, [active, refresh, settings.scopeCwd]);

  // Poll daemon status together with a periodic refresh (SSE only carries sessions)
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  // SSE subscription
  useEffect(() => {
    if (!active) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const notify = (notification: AgentNotification) => {
      const current = settingsRef.current;
      if (!current.notifications) return;
      const name = notification.session.name;
      const messages: Record<AgentNotification['type'], { text: string; icon: string }> = {
        agent_needs_input: { text: `${name} needs input`, icon: '✻' },
        agent_completed: { text: `${name} finished`, icon: '✓' },
        agent_failed: { text: `${name} failed`, icon: '✗' },
      };
      const message = messages[notification.type];
      if (notification.type === 'agent_failed') toast.error(message.text);
      else toast(message.text, { icon: message.icon, duration: reducedMotion ? 2500 : 4000 });
      if (notification.type === 'agent_completed') {
        setLastCompleted((prev) => ({
          count: (prev && Date.now() - prev.at < 5000 ? prev.count : 0) + 1,
          at: Date.now(),
        }));
      }
      if (
        current.desktopNotifications &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'
      ) {
        try {
          new Notification('Claude agents', {
            body: message.text,
            tag: `agent-${notification.session.id}`,
          });
        } catch {
          // Notification API unavailable
        }
      }
    };

    const unsubscribe = subscribeToAgents({
      onSessions: (next) => {
        const scope = settingsRef.current.scopeCwd;
        setSessions(
          scope ? next.filter((s) => s.cwd === scope || s.cwd.startsWith(`${scope}/`)) : next
        );
        setLoading(false);
      },
      onNotify: notify,
      onError: (message) => setError(message),
      onConnectionChange: setConnected,
    });
    return unsubscribe;
  }, [active]);

  const counts = summarizeSessions(sessions);

  return {
    sessions,
    daemon,
    userSettings,
    cliInstalled,
    settings,
    updateSettings,
    loading,
    error,
    connected,
    counts,
    lastCompleted,
    refresh,
  };
}
