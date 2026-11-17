import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import { fetchHarnessModels } from '../../services/agentsApi';
import { MODEL_SUGGESTIONS } from '../../utils/agentSessions';
import { effortColumns, matrixRows, pickLabel, type HarnessModel } from '../../utils/modelMatrix';
import { usePopover } from './PullRequestsPanel';

interface ModelEffortPickerProps {
  harness: 'claude' | 'omp';
  /** '' = the CLI's (or the dispatch's) default */
  model: string;
  effort: string;
  onPick: (model: string, effort: string) => void;
  defaultModel?: string | null;
  disabled?: boolean;
  /** Where the matrix opens: below the button (dialog) or above it (status line) */
  placement?: 'down' | 'up';
  title?: string;
}

/**
 * Model × effort matrix (rows: models, columns: effort levels the CLI names). A cell picks
 * both; "default" keeps what the CLI picks itself. The filter also takes any model name: Enter
 * uses it as typed.
 */
export const ModelEffortPicker: React.FC<ModelEffortPickerProps> = ({
  harness,
  model,
  effort,
  onPick,
  defaultModel = null,
  disabled,
  placement = 'down',
  title,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={title ?? 'Model and effort'}
        className="flex items-center gap-1.5 max-w-[16rem] bg-gray-900 border border-gray-600 rounded-md px-1.5 py-1 text-xs text-gray-50 font-mono hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
      >
        <Gauge size={12} aria-hidden className="shrink-0 text-gray-400" />
        <span className="truncate">{pickLabel(model, effort, defaultModel)}</span>
        <ChevronDown size={12} aria-hidden className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <Matrix
          harness={harness}
          model={model}
          effort={effort}
          placement={placement}
          onClose={() => setOpen(false)}
          onPick={(m, e) => {
            onPick(m, e);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
};

const Matrix: React.FC<{
  harness: 'claude' | 'omp';
  model: string;
  effort: string;
  placement: 'down' | 'up';
  onClose: () => void;
  onPick: (model: string, effort: string) => void;
}> = ({ harness, model, effort, placement, onClose, onPick }) => {
  const ref = usePopover(onClose, true);
  const [models, setModels] = useState<HarnessModel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchHarnessModels(harness)
      .then((list) => !cancelled && setModels(list))
      .catch(() => !cancelled && (setModels([]), setFailed(true)));
    return () => {
      cancelled = true;
    };
  }, [harness]);

  const columns = useMemo(() => effortColumns(models ?? []), [models]);
  const rows = useMemo(
    () => matrixRows(models ?? [], MODEL_SUGGESTIONS[harness], filter),
    [models, harness, filter]
  );
  const typed = filter.trim();

  const cell = (id: string, level: string, available: boolean, label: string) => {
    const selected = model === id && effort === level;
    return (
      <td key={level} className="p-0.5 text-center">
        {available && (
          <button
            type="button"
            onClick={() => onPick(id, level)}
            aria-pressed={selected}
            aria-label={`${label} · ${level || 'default effort'}`}
            title={`${label} · ${level || 'default effort'}`}
            className={`h-6 w-full min-w-[2.5rem] rounded text-[11px] focus-visible:outline-2 focus-visible:outline-blue-400 ${
              selected
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800/70 text-gray-400 hover:bg-blue-500/30 hover:text-white'
            }`}
          >
            {selected ? '●' : '·'}
          </button>
        )}
      </td>
    );
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Model and effort"
      className={`absolute z-50 ${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-gray-600 bg-gray-900 shadow-2xl outline-none`}
    >
      <div className="p-2 border-b border-gray-700">
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !typed) return;
            e.preventDefault();
            // One match: that model; otherwise the name as typed (any model the CLI knows)
            onPick(rows.length === 1 ? rows[0].id : typed, effort);
          }}
          placeholder="Filter models · Enter uses a typed name"
          aria-label="Filter models"
          spellCheck={false}
          className="w-full bg-gray-950 border border-gray-600 rounded-md px-2 py-1 text-xs text-gray-50 placeholder-gray-500 font-mono outline-none focus:border-blue-400"
        />
      </div>
      <div className="max-h-[min(60vh,28rem)] overflow-auto">
        {models === null ? (
          <p className="p-3 text-xs text-gray-400">Loading models…</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-gray-900">
              <tr>
                <th className="px-2 py-1 text-left font-normal text-gray-500">Model</th>
                <th className="px-1 py-1 font-normal text-gray-500">default</th>
                {columns.map((c) => (
                  <th key={c} className="px-1 py-1 font-normal text-gray-300">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!typed && (
                <tr className="border-t border-gray-800">
                  <td className="px-2 py-1 text-gray-300 italic">default</td>
                  {cell('', '', true, 'Default model')}
                  {columns.map((c) => cell('', c, true, 'Default model'))}
                </tr>
              )}
              {rows.map((m, i) => (
                <React.Fragment key={m.id}>
                  {m.group && m.group !== rows[i - 1]?.group && (
                    <tr>
                      <td
                        colSpan={columns.length + 2}
                        className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-gray-500"
                      >
                        {m.group}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-gray-800">
                    <td className="px-2 py-1 text-gray-100 font-mono break-all" title={m.id}>
                      {m.label}
                    </td>
                    {cell(m.id, '', true, m.label)}
                    {columns.map((c) => cell(m.id, c, m.efforts.includes(c), m.label))}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {models !== null && rows.length === 0 && (
          <p className="p-3 text-xs text-gray-400">
            {typed ? `No listed model matches; Enter uses "${typed}".` : null}
            {failed && !typed ? 'The CLI did not list its models; type a model name.' : null}
          </p>
        )}
      </div>
    </div>
  );
};
