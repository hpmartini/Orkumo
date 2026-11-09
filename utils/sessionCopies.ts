import type { AgentSession } from '../types';
import { resumableSessionId, sessionHarness } from './agentSessions';

/**
 * Session copies (#236). `claude -p --resume <id>` keeps the session id, so a second process on
 * a transcript another process still writes is a second writer in the same worktree: the rail
 * shows it as a copy of that agent, and starting one asks first.
 */

/** Every transcript id a session writes or wrote (a background job's respawn writes a new one) */
export function transcriptIds(session: AgentSession): string[] {
  const ids = [session.sessionId, ...(session.sessionIds ?? [])];
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/**
 * One rail row per agent: a session whose transcript an earlier session already holds moves into
 * that session's `copies`. Background jobs are the source before interactive processes, then the
 * older session wins.
 */
export function collapseCopies(sessions: AgentSession[]): AgentSession[] {
  const order = [...sessions].sort(
    (a, b) =>
      Number(b.kind === 'background') - Number(a.kind === 'background') || a.startedAt - b.startedAt
  );
  const owner = new Map<string, AgentSession>();
  const copies = new Map<string, AgentSession[]>();
  for (const session of order) {
    const ids = transcriptIds(session);
    const source = ids.map((id) => owner.get(id)).find(Boolean);
    if (source) copies.set(source.id, [...(copies.get(source.id) ?? []), session]);
    else ids.forEach((id) => owner.set(id, session));
  }
  const copyIds = new Set([...copies.values()].flat().map((s) => s.id));
  return sessions
    .filter((s) => !copyIds.has(s.id))
    .map((s) => (copies.has(s.id) ? { ...s, copies: copies.get(s.id) } : s));
}

/** Listed session that holds transcript `sessionId` (a running job or process), or null */
export function transcriptHolder(
  sessions: AgentSession[],
  sessionId: string | null | undefined
): AgentSession | null {
  // `/resume <id>` also takes a prefix of 8+ characters
  if (!sessionId || sessionId.length < 8) return null;
  return (
    sessions.find(
      (s) =>
        (s.kind === 'background' || s.pid != null) &&
        transcriptIds(s).some((id) => id.startsWith(sessionId))
    ) ?? null
  );
}

/**
 * Pane that already runs transcript `sessionId`: a chat (its process lives until its pane closes)
 * or an open terminal pane. null when none does.
 */
export function paneHolding(
  panes: AgentSession[],
  openIds: Set<string>,
  sessionId: string | null | undefined
): string | null {
  if (!sessionId) return null;
  return (
    panes.find((p) =>
      p.chat ? p.sessionId === sessionId : openIds.has(p.id) && resumableSessionId(p) === sessionId
    )?.id ?? null
  );
}

/**
 * Resuming `session` elsewhere makes a copy: a background job always (its own process is
 * `claude attach`), an interactive session while its process still runs.
 */
export function resumeMakesCopy(session: AgentSession): boolean {
  if (session.chat) return false;
  return session.kind === 'background' || session.pid != null;
}

/**
 * What opening a rail row does: a background job or other harness attaches (never a resume), a
 * session a pane already runs focuses that pane, anything else resumes its transcript.
 */
export type OpenPlan =
  | { type: 'attach' }
  | { type: 'focus'; paneId: string }
  | { type: 'resume'; sessionId: string | null };

export function openPlan(
  session: AgentSession,
  panes: AgentSession[],
  openIds: Set<string>
): OpenPlan {
  if (session.kind !== 'interactive' || sessionHarness(session) !== 'claude') {
    return { type: 'attach' };
  }
  const sessionId = resumableSessionId(session);
  const held = paneHolding(panes, openIds, sessionId);
  return held ? { type: 'focus', paneId: held } : { type: 'resume', sessionId };
}

/** Session id shown on a workspace tab: the job id for background jobs, else the transcript id */
export function tabSessionLabel(session: AgentSession): string | null {
  if (session.kind === 'background' && !session.ptyArgs) return session.id;
  const id = resumableSessionId(session) ?? (session.chat ? session.sessionId : null);
  return id ? id.slice(0, 8) : null;
}
