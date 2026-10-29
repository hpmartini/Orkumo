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

const IssuePill: React.FC<{
  issueKey: string;
  repoSlug?: string | null;
  onOpen?: (issueKey: string) => void;
}> = ({ issueKey, repoSlug, onOpen }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onOpen?.(issueKey);
    }}
    className="shrink-0 font-mono leading-4 px-1 rounded border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
    title={`Open ${issueKey}`}
  >
    {issueLabel(issueKey, repoSlug)}
  </button>
);

export interface SessionLinksProps {
  session: AgentSession;
  ctx?: AgentContext;
  /** Running servers only */
  servers: AgentServer[];
  issueKeys: string[];
  onOpenIssue?: (issueKey: string) => void;
  onOpenPrs?: (repoSlug: string | null) => void;
}

/** Whether SessionLinks would render anything */
export const hasSessionLinks = ({ session, ctx, servers, issueKeys }: SessionLinksProps) =>
  session.links.length > 0 ||
  issueKeys.length > 0 ||
  servers.length > 0 ||
  (ctx?.subagents.running || 0) > 0;

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
}) => {
  const label = prLabel(session.links);
  const runningSubagents = ctx?.subagents.running || 0;
  return (
    <>
      {label &&
        (onOpenPrs ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenPrs(ctx?.repo?.slug || null);
            }}
            data-popover-trigger
            className={`shrink-0 font-mono leading-4 px-1 rounded border ${label.className} flex items-center gap-0.5 hover:bg-gray-800`}
            title={`List pull requests${ctx?.repo?.slug ? ` of ${ctx.repo.slug}` : ''}`}
          >
            <GitPullRequest size={10} />
            {label.text}
          </button>
        ) : (
          <a
            href={label.href || undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`shrink-0 font-mono leading-4 px-1 rounded border ${label.className} flex items-center gap-0.5`}
            title={`Open pull request${session.links.length > 1 ? 's' : ''}\n${session.links.map((l) => l.href).join('\n')}`}
          >
            <GitPullRequest size={10} />
            {label.text}
            {label.href && <ExternalLink size={9} />}
          </a>
        ))}
      {issueKeys.map((key) => (
        <IssuePill key={key} issueKey={key} repoSlug={ctx?.repo?.slug} onOpen={onOpenIssue} />
      ))}
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
      {runningSubagents > 0 && (
        <span
          className="shrink-0 flex items-center gap-1 text-sky-300 tabular-nums"
          title={ctx?.subagents.names.join('\n') || undefined}
        >
          <Bot size={10} />
          {runningSubagents} sub-agent{runningSubagents === 1 ? '' : 's'} running
        </span>
      )}
    </>
  );
};
