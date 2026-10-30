import React from 'react';
import { Bot, ExternalLink, GitPullRequest } from 'lucide-react';
import type { AgentContext, AgentSession } from '../../types';
import { AgentServer, prLabel } from '../../utils/agentSessions';

/** "owner/name#12" → "#12" inside the agent's own repo, else "name#12" */
const issueLabel = (key: string, repoSlug?: string | null) => {
  const hash = key.lastIndexOf('#');
  return repoSlug && key.slice(0, hash).toLowerCase() === repoSlug.toLowerCase()
    ? key.slice(hash)
    : key.slice(key.indexOf('/') + 1);
};

const pillClass = 'shrink-0 font-mono leading-4 px-1 rounded border';

export const IssuePill: React.FC<{
  issueKey: string;
  repoSlug?: string | null;
  onOpen?: (issueKey: string) => void;
}> = ({ issueKey, repoSlug, onOpen }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onOpen?.(issueKey);
    }}
    className={`${pillClass} border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor`}
    title={`Open ${issueKey}`}
  >
    {issueLabel(issueKey, repoSlug)}
  </button>
);

/** PR state of a session; opens the PR panel when `onOpenPrs` is given, else the PR itself */
export const PrPill: React.FC<{
  session: Pick<AgentSession, 'links'>;
  repoSlug?: string | null;
  onOpenPrs?: (repoSlug: string | null) => void;
}> = ({ session, repoSlug, onOpenPrs }) => {
  const label = prLabel(session.links);
  if (!label) return null;
  return onOpenPrs ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpenPrs(repoSlug || null);
      }}
      data-popover-trigger
      className={`${pillClass} ${label.className} flex items-center gap-0.5 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor`}
      title={`List pull requests${repoSlug ? ` of ${repoSlug}` : ''}`}
    >
      <GitPullRequest size={10} aria-hidden="true" />
      <span className="sr-only">Pull request </span>
      {label.text}
    </button>
  ) : (
    <a
      href={label.href || undefined}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`${pillClass} ${label.className} flex items-center gap-0.5`}
      title={`Open pull request${session.links.length > 1 ? 's' : ''}\n${session.links.map((l) => l.href).join('\n')}`}
    >
      <GitPullRequest size={10} aria-hidden="true" />
      <span className="sr-only">Pull request </span>
      {label.text}
      {label.href && <ExternalLink size={9} />}
    </a>
  );
};

export const ServerLinks: React.FC<{
  session: Pick<AgentSession, 'worktree' | 'cwd'>;
  /** Running servers only */
  servers: AgentServer[];
}> = ({ session, servers }) => (
  <>
    {servers.map((server) => (
      <a
        key={server.port}
        href={`http://localhost:${server.port}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 flex items-center gap-1 min-w-0 text-gray-400 hover:text-white"
        title={`${server.command || server.name}: port ${server.port}${server.pid ? `, pid ${server.pid}` : ''}\n${session.worktree || session.cwd}\nClick to open`}
      >
        <span className="font-mono text-emerald-400">:{server.port}</span>
        <span className="truncate max-w-[8rem]">{server.name}</span>
      </a>
    ))}
  </>
);

export const SubagentsBadge: React.FC<{ ctx?: AgentContext }> = ({ ctx }) => {
  const running = ctx?.subagents.running || 0;
  if (running === 0) return null;
  return (
    <span
      className="shrink-0 flex items-center gap-1 text-sky-300 tabular-nums"
      title={ctx?.subagents.names.join('\n') || undefined}
    >
      <Bot size={10} />
      {running} sub-agent{running === 1 ? '' : 's'} running
    </span>
  );
};

export interface SessionLinksProps {
  session: AgentSession;
  ctx?: AgentContext;
  /** Running servers only */
  servers: AgentServer[];
  issueKeys: string[];
  onOpenIssue?: (issueKey: string) => void;
  onOpenPrs?: (repoSlug: string | null) => void;
}

/**
 * Pull requests, board issues, running servers and sub-agents of one session,
 * as inline items (the caller owns the flex container).
 */
export const SessionLinks: React.FC<SessionLinksProps> = ({
  session,
  ctx,
  servers,
  issueKeys,
  onOpenIssue,
  onOpenPrs,
}) => (
  <>
    <PrPill session={session} repoSlug={ctx?.repo?.slug} onOpenPrs={onOpenPrs} />
    {issueKeys.map((key) => (
      <IssuePill key={key} issueKey={key} repoSlug={ctx?.repo?.slug} onOpen={onOpenIssue} />
    ))}
    <ServerLinks session={session} servers={servers} />
    <SubagentsBadge ctx={ctx} />
  </>
);
