import { useState } from 'react';
import { Check, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import type { AgentDialog, DialogAnswer } from '../../../utils/agentDialog';

interface QuestionCardProps {
  dialog: AgentDialog;
  onAnswer: (answer: DialogAnswer) => void;
  /** Keys went out for this step: answered until the agent's screen moves on */
  sent?: boolean;
  disabled?: boolean;
}

const optionBtn =
  'w-full rounded border border-amber-400/30 bg-gray-900 px-2 py-1.5 text-left text-xs text-gray-100 transition-colors hover:bg-amber-500/20 hover:border-amber-400/60 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50 disabled:hover:bg-gray-900';
const field =
  'min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100 placeholder-gray-500 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50';
const sendBtn =
  'shrink-0 rounded border border-amber-400/40 bg-gray-900 px-2 py-1 text-xs text-gray-100 hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50';

/** One free-text line (free answer, reason for a denial), sent with Enter or its button */
function TextAnswer({
  label,
  button,
  disabled,
  onSend,
}: {
  label: string;
  button: string;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };
  return (
    <div className="flex gap-1.5">
      <input
        aria-label={label}
        placeholder={label}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className={field}
      />
      <button type="button" disabled={disabled || !text.trim()} onClick={send} className={sendBtn}>
        {button}
      </button>
    </div>
  );
}

/**
 * A question or permission the agent waits on, as a card: the dialog's step on its screen,
 * structured, answered with clicks that the chat pane turns into the TUI's keys
 */
export function QuestionCard({
  dialog,
  onAnswer,
  sent = false,
  disabled = false,
}: QuestionCardProps) {
  const off = disabled || sent;
  const pick = (row: number) => !off && onAnswer({ type: 'pick', row });
  const permission = dialog.kind === 'permission';
  const Icon = permission ? ShieldAlert : MessageCircleQuestion;
  const rows = dialog.options.map((option, row) => ({ option, row }));
  const choices = rows.filter(({ option }) => option.role === 'option' || option.role === 'deny');
  const other = rows.find(({ option }) => option.role === 'other');
  const deny = rows.find(({ option }) => option.role === 'deny');
  const submit = rows.find(({ option }) => option.role === 'submit');

  return (
    <div
      role="group"
      aria-label={permission ? 'Permission request' : 'Agent question'}
      className="mb-2 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs"
    >
      <div className="flex items-center gap-1.5 font-medium text-amber-200">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {permission ? dialog.title || 'Permission' : 'The agent is asking'}
        </span>
        {sent && (
          <span className="ml-auto flex shrink-0 items-center gap-1 font-normal text-emerald-300">
            <Check className="h-3 w-3" aria-hidden />
            Answer sent
          </span>
        )}
      </div>
      {dialog.tabs.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {dialog.tabs.map((tab) => (
            <span
              key={tab.label}
              data-done={tab.done}
              className={`rounded-full border px-1.5 py-0.5 text-[11px] ${tab.done ? 'border-emerald-400/40 text-emerald-300' : 'border-gray-600 text-gray-400'}`}
            >
              {tab.label}
            </span>
          ))}
        </div>
      )}
      {dialog.detail && (
        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-950/60 p-1.5 font-mono text-[11px] text-gray-200">
          {dialog.detail}
        </pre>
      )}
      {dialog.question && <div className="mt-1.5 text-sm text-gray-100">{dialog.question}</div>}
      <div className="mt-2 flex flex-col gap-1">
        {choices.map(({ option, row }) =>
          option.checked !== undefined ? (
            <button
              key={row}
              type="button"
              role="checkbox"
              aria-checked={option.checked}
              disabled={off}
              onClick={() => pick(row)}
              className={`${optionBtn} flex items-start gap-2`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${option.checked ? 'border-amber-300 bg-amber-400/30' : 'border-gray-500'}`}
              >
                {option.checked && <Check className="h-3 w-3 text-amber-100" />}
              </span>
              <OptionText label={option.label} description={option.description} />
            </button>
          ) : (
            <button
              key={row}
              type="button"
              aria-pressed={option.selected || undefined}
              disabled={off}
              onClick={() => pick(row)}
              className={`${optionBtn} ${option.selected ? 'border-amber-300 bg-amber-500/20' : ''}`}
            >
              <OptionText label={option.label} description={option.description} />
            </button>
          )
        )}
      </div>
      {other && (
        <div className="mt-1.5">
          {other.option.description && (
            <div className="mb-1 text-gray-400">Typed: {other.option.description}</div>
          )}
          <TextAnswer
            label="Other answer"
            button="Send"
            disabled={off}
            onSend={(text) => onAnswer({ type: 'text', row: other.row, text })}
          />
        </div>
      )}
      {deny && (
        <div className="mt-1.5">
          <TextAnswer
            label="Reason"
            button="No, with reason"
            disabled={off}
            onSend={(text) => onAnswer({ type: 'text', row: deny.row, text })}
          />
        </div>
      )}
      {submit && (
        <button
          type="button"
          disabled={off}
          onClick={() => pick(submit.row)}
          className={`${sendBtn} mt-2 bg-amber-500/20`}
        >
          Submit
        </button>
      )}
    </div>
  );
}

function OptionText({ label, description }: { label: string; description?: string }) {
  return (
    <span className="min-w-0">
      <span className="block">{label}</span>
      {description && <span className="block text-[11px] text-gray-400">{description}</span>}
    </span>
  );
}
