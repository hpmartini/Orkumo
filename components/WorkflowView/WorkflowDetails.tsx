import React, { useEffect, useState } from 'react';
import { Bot, Code2, ExternalLink, FileText, GitPullRequest, CircleDot } from 'lucide-react';
import type { AgentSession, WorkflowDetails as Details } from '../../types';
import type { WorkflowCard } from '../../utils/workflows';
import { phaseGroup } from '../../utils/workflowStage.js';
import { fetchWorkflowDetails } from '../../services/boardApi';
import { CheckIcon } from '../BoardView/BoardCard';

export interface WorkflowNav {
  openAgent: (card: WorkflowCard, session?: AgentSession) => void;
  openCode: (card: WorkflowCard, session?: AgentSession) => void;
  openDoc: (card: WorkflowCard, doc: { name: string; path: string }) => void;
}

const RESULT_TONE: Record<string, string> = {
  passed: 'bg-emerald-400',
  failed: 'bg-red-400',
  running: 'bg-cursor motion-safe:animate-pulse',
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-3 first:mt-0">
    <h4 className="mb-1.5 text-[11px] font-semibold text-gray-300">{title}</h4>
    {children}
  </section>
);

const linkClass =
  'inline-flex items-center gap-1 rounded-md border border-gray-750 px-2 py-1 text-[11.5px] text-gray-200 hover:border-gray-700 hover:bg-gray-850 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cursor';

/** Expanded part of a workflow card: run steps, processes, docs, screenshots, jumps */
export const WorkflowDetails: React.FC<{
  card: WorkflowCard;
  session?: AgentSession;
  nav: WorkflowNav;
}> = ({ card, session, nav }) => {
  const { item } = card;
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchWorkflowDetails(item.itemId)
      .then((d) => live && setDetails(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [item.itemId, card.state.stage]);

  const phases = (details?.phases ?? card.run?.phases ?? []).slice(-10);

  return (
    <div className="border-t border-gray-750 px-3 pb-3 pt-2.5 text-[11.5px] text-gray-300">
      <Section title="Ablauf">
        {phases.length ? (
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
            {phases.map((p, i) => (
              <li
                key={`${p.at}-${i}`}
                className="inline-flex items-center gap-1"
                title={`${p.phase} · ${p.result}${p.model ? ` · ${p.model}` : ''}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${RESULT_TONE[p.result] ?? 'bg-gray-500'}`}
                />
                <span className="text-gray-200">{phaseGroup(p.phase)}</span>
                {i < phases.length - 1 && <span className="text-gray-600">→</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-gray-400">Noch kein mw-Run zu diesem Issue gefunden.</p>
        )}
      </Section>

      <Section title="Laufende Prozesse">
        <ul className="space-y-1">
          <li className="flex items-center gap-1.5">
            <Bot size={12} className="text-gray-400" />
            {session ? (
              <span>
                {session.name || session.id}{' '}
                <span className="text-gray-400">· {session.displayState}</span>
              </span>
            ) : (
              <span className="text-gray-400">Keine laufende Agent-Session</span>
            )}
          </li>
          {card.run && (
            <li className="flex items-center gap-1.5 tabular-nums">
              <CircleDot size={12} className="text-gray-400" />
              {card.run.mode} {card.run.runId}
              {card.state.phase && <span className="text-gray-400">· {card.state.phase}</span>}
            </li>
          )}
          {item.pullRequests.map((pr) => (
            <li key={pr.url} className="flex items-center gap-1.5">
              <GitPullRequest size={12} className="text-gray-400" />
              PR #{pr.number} · {pr.state.toLowerCase()} <CheckIcon state={pr.checks} />
            </li>
          ))}
        </ul>
      </Section>

      {error && <p className="mt-3 text-red-300">Details nicht geladen: {error}</p>}
      {!details && !error && <p className="mt-3 text-gray-400">Lade Dokumente und Screenshots…</p>}

      {details && details.docs.length > 0 && (
        <Section title="Dokumente">
          <div className="flex flex-wrap gap-1.5">
            {details.docs.map((d) => (
              <button
                key={d.path}
                type="button"
                className={linkClass}
                onClick={() => nav.openDoc(card, d)}
                title={d.path}
              >
                <FileText size={12} /> {d.name.split('/').pop()}
              </button>
            ))}
          </div>
        </Section>
      )}

      {details && details.screenshots.length > 0 && (
        <Section title="Screenshots aus Reviews">
          <div className="grid grid-cols-3 gap-1.5">
            {details.screenshots.map((url, i) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border border-gray-750 hover:border-gray-600"
              >
                <img
                  src={url}
                  alt={`Review-Screenshot ${i + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-video w-full object-cover"
                />
              </a>
            ))}
          </div>
        </Section>
      )}

      <Section title="Springen zu">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={linkClass}
            disabled={!card.state.sessionId && !session}
            onClick={() => nav.openAgent(card, session)}
          >
            <Bot size={12} /> Agent
          </button>
          {item.url && (
            <a className={linkClass} href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Issue
            </a>
          )}
          {item.pullRequests.map((pr) => (
            <a key={pr.url} className={linkClass} href={pr.url} target="_blank" rel="noreferrer">
              <GitPullRequest size={12} /> PR #{pr.number}
            </a>
          ))}
          <button type="button" className={linkClass} onClick={() => nav.openCode(card, session)}>
            <Code2 size={12} /> Code
          </button>
        </div>
      </Section>
    </div>
  );
};
