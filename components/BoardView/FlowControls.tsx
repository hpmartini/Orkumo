import React, { useState } from 'react';
import type { BoardLabel, BoardRepoOptions } from '../../types';
import {
  BUILD_LABEL,
  DELEGATE_LABEL,
  DYNAMIC_LABEL,
  FOLLOWUP_LABEL,
  GO_LABEL,
  MODE_LABELS,
  NEED_INPUT_LABEL,
  REVIEW_LABEL,
  currentMode,
  setMode,
  startText,
  toggleLabel,
  UPDATE_LABEL,
  type FlowMode,
} from '../../utils/issueControls';
import { addIssueComment, startWorkflow } from '../../services/boardApi';
import { labelsFor } from './IssueFields';
import type { IssueSave } from './IssueEditors';

const MODES: { mode: FlowMode; label: string }[] = [
  { mode: 'default', label: 'Default' },
  { mode: 'image', label: 'Image' },
];

const BTN =
  'px-2 py-1 rounded border text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const btnState = (on: boolean) =>
  on
    ? 'border-cursor/60 bg-cursor/15 text-white'
    : 'border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800';

/**
 * mw-board control labels as buttons; a label missing in the repo disables its button.
 * Umsetzen only ever sets mw:build (taking the approval back is done on GitHub) and starts the
 * issue right away via `mw board go`. Überarbeiten (Briefed) and Nacharbeiten (to Review) post
 * the feedback as comment, set mw:update / mw:followup and start the same way.
 */
export const FlowControls: React.FC<{
  labels: BoardLabel[];
  repoOptions: BoardRepoOptions | null;
  onSave: IssueSave;
  /** GitHub URL of the issue; without it Umsetzen only sets the label */
  issueUrl?: string | null;
  /** GitHub node id of the issue; without it no feedback can be posted */
  issueId?: string | null;
}> = ({ labels, repoOptions, onSave, issueUrl, issueId }) => {
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [startWhat, setStartWhat] = useState('Umsetzung');
  const [feedback, setFeedback] = useState('');
  const names = labels.map((l) => l.name);
  const exists = (label: string) => !!repoOptions?.labels.some((l) => l.name === label);
  const apply = (next: string[]) =>
    onSave({ labels: next }, { labels: labelsFor(next, repoOptions) });
  const missing = (label: string) =>
    repoOptions && !exists(label) ? `Label ${label} gibt es im Repo nicht` : undefined;
  const toggle = (label: string, text: string, hint: string) => {
    const on = names.includes(label);
    return (
      <button
        onClick={() => apply(toggleLabel(names, label, !on))}
        disabled={!exists(label)}
        aria-pressed={on}
        title={missing(label) ?? `${hint} (${label} ${on ? 'entfernen' : 'setzen'})`}
        className={`${BTN} ${btnState(on)}`}
      >
        {text}
      </button>
    );
  };
  const building = names.includes(BUILD_LABEL);
  const busy = startMsg === 'startet…';
  /** `prepare` writes comment/label; only when it succeeds the issue starts now (`mw board go`) */
  const startAfter = async (what: string, prepare: () => Promise<boolean>) => {
    setStartWhat(what);
    setStartMsg('startet…');
    try {
      if (!(await prepare())) return setStartMsg(null);
      setStartMsg(issueUrl ? startText(await startWorkflow(issueUrl)) : null);
    } catch (e) {
      setStartMsg(`Nicht gestartet: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
  };
  const build = () =>
    startAfter('Umsetzung', async () => building || apply(toggleLabel(names, BUILD_LABEL, true)));
  const text = feedback.trim();
  const sendFeedback = (label: string) =>
    startAfter('Rückmeldung', async () => {
      if (!issueId) return false;
      // comment first: when the poll sees the label, the feedback must already be there
      await addIssueComment(issueId, text);
      if (!(await apply(toggleLabel(names, label, true)))) return false;
      setFeedback('');
      return true;
    });
  const feedbackButton = (label: string, name: string, hint: string) => (
    <button
      onClick={() => sendFeedback(label)}
      disabled={!exists(label) || !issueId || !text || busy}
      title={
        missing(label) ??
        (text
          ? `${hint}: Rückmeldung als Kommentar, ${label} setzen`
          : 'Erst Rückmeldung schreiben')
      }
      className={`${BTN} ${btnState(false)}`}
    >
      {name}
    </button>
  );
  const mode = currentMode(names);

  return (
    <section aria-label="Kontrollfluss">
      <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2">
        Kontrollfluss
        {names.includes(NEED_INPUT_LABEL) && (
          <span className="px-1.5 rounded bg-amber-500/20 text-amber-300 font-normal">
            wartet auf Antwort
          </span>
        )}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {toggle(GO_LABEL, 'Freigeben', 'Issue für mw board freigeben')}
        <button
          onClick={build}
          disabled={!exists(BUILD_LABEL) || busy}
          aria-pressed={building}
          title={
            missing(BUILD_LABEL) ??
            `Briefing freigeben, Umsetzung sofort starten (${BUILD_LABEL} ${building ? 'bleibt gesetzt' : 'setzen'})`
          }
          className={`${BTN} ${btnState(building)}`}
        >
          Umsetzen
        </button>
        {toggle(DYNAMIC_LABEL, 'Dynamic', 'Dynamic Workflows')}
        {toggle(DELEGATE_LABEL, 'Delegate', 'Teilaufgaben an Codex/MiniMax abgeben')}
        {toggle(REVIEW_LABEL, 'Review', 'Unabhängiges Review vor dem PR')}
      </div>
      <div className="mt-2">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder="Rückmeldung an die Session (wird als Kommentar gepostet)"
          aria-label="Rückmeldung"
          className="w-full bg-gray-850 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 resize-y focus:outline-none focus:border-gray-500"
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {feedbackButton(UPDATE_LABEL, 'Überarbeiten', 'Ziel-Vertrag überarbeiten (Briefed)')}
          {feedbackButton(FOLLOWUP_LABEL, 'Nacharbeiten', 'PR nacharbeiten (to Review)')}
        </div>
      </div>
      <p role="status" className="mt-1.5 text-xs text-gray-400 empty:hidden">
        {startMsg && `${startWhat}: ${startMsg}`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="mw-Modus">
        {MODES.map(({ mode: m, label }) => {
          const label_ = m === 'default' ? null : MODE_LABELS[m];
          return (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => mode !== m && apply(setMode(names, m))}
              disabled={!!label_ && !exists(label_)}
              title={label_ ? (missing(label_) ?? label_) : 'Kein Modus-Label'}
              className={`${BTN} ${btnState(mode === m)}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
};
