import React, { useState } from 'react';
import type { BoardLabel, BoardRepoOptions } from '../../types';
import { currentMode, setMode, startText, toggleLabel } from '../../utils/issueControls';
import { addIssueComment, startWorkflow } from '../../services/boardApi';
import { useWorkflowProvider } from '../../hooks/useWorkflowProvider';
import { labelsFor } from './IssueFields';
import type { IssueSave } from './IssueEditors';

const BTN =
  'px-2 py-1 rounded border text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const btnState = (on: boolean) =>
  on
    ? 'border-cursor/60 bg-cursor/15 text-white'
    : 'border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800';

/**
 * The workflow provider's control labels as buttons (docs/WORKFLOW_PROVIDER.md); a label missing
 * in the repo disables its button. Nothing without a provider or `controls`.
 * The start button only ever sets its label (taking it back is done on GitHub) and starts the
 * issue right away. Feedback buttons post the feedback as comment, set their label and start the same way.
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
  const controls = useWorkflowProvider()?.controls;
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const names = labels.map((l) => l.name);
  const exists = (label: string) => !!repoOptions?.labels.some((l) => l.name === label);
  const apply = (next: string[]) =>
    onSave({ labels: next }, { labels: labelsFor(next, repoOptions) });
  const missing = (label: string) =>
    repoOptions && !exists(label) ? `Label ${label} does not exist in the repo` : undefined;
  const toggle = (label: string, text: string, hint: string) => {
    const on = names.includes(label);
    return (
      <button
        onClick={() => apply(toggleLabel(names, label, !on))}
        disabled={!exists(label)}
        aria-pressed={on}
        title={missing(label) ?? `${hint} (${on ? `remove ${label}` : `set ${label}`})`}
        className={`${BTN} ${btnState(on)}`}
      >
        {text}
      </button>
    );
  };
  const startLabel = controls?.start?.label ?? '';
  const building = names.includes(startLabel);
  const busy = starting;
  /** `prepare` writes comment/label; only when it succeeds the issue starts now */
  const startAfter = async (what: string, prepare: () => Promise<boolean>) => {
    const say = (m: string | null) => setStartMsg(m && `${what}: ${m}`);
    setStarting(true);
    say('starting…');
    try {
      if (!(await prepare())) return say(null);
      say(issueUrl ? startText(await startWorkflow(issueUrl)) : null);
    } catch (e) {
      say(`not started: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setStarting(false);
    }
  };
  const build = () =>
    startAfter(
      'Implementation',
      async () => building || apply(toggleLabel(names, startLabel, true))
    );
  const text = feedback.trim();
  const sendFeedback = (label: string) =>
    startAfter('Feedback', async () => {
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
        (text ? `${hint}: feedback as comment, set ${label}` : 'Write feedback first')
      }
      className={`${BTN} ${btnState(false)}`}
    >
      {name}
    </button>
  );
  if (!controls) return null;
  const { toggles = [], start, feedback: feedbackControls = [], modes, waiting } = controls;
  const mode = modes ? currentMode(names, modes) : null;

  return (
    <section aria-label="Control flow">
      <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2">
        Control flow
        {waiting && names.includes(waiting.label) && (
          <span className="px-1.5 rounded bg-amber-500/20 text-amber-300 font-normal">
            {waiting.text}
          </span>
        )}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {toggles.slice(0, 1).map((t) => toggle(t.label, t.text, t.hint))}
        {start && (
          <button
            onClick={build}
            disabled={!exists(start.label) || busy}
            aria-pressed={building}
            title={
              missing(start.label) ??
              `${start.hint} (${start.label} ${building ? 'bleibt gesetzt' : 'setzen'})`
            }
            className={`${BTN} ${btnState(building)}`}
          >
            {start.text}
          </button>
        )}
        {toggles.slice(1).map((t) => toggle(t.label, t.text, t.hint))}
      </div>
      <div className="mt-2">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder="Feedback to the session (posted as a comment)"
          aria-label="Feedback"
          className="w-full bg-gray-850 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 resize-y focus:outline-none focus:border-gray-500"
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {feedbackControls.map((f) => feedbackButton(f.label, f.text, f.hint))}
        </div>
      </div>
      <p role="status" className="mt-1.5 text-xs text-gray-400 empty:hidden">
        {startMsg}
      </p>
      {modes && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Mode">
          {modes.options.map(({ text, label }) => (
            <button
              key={label ?? 'default'}
              role="radio"
              aria-checked={mode === label}
              onClick={() => mode !== label && apply(setMode(names, modes, label))}
              disabled={!!label && !exists(label)}
              title={label ? (missing(label) ?? label) : 'No mode label'}
              className={`${BTN} ${btnState(mode === label)}`}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
