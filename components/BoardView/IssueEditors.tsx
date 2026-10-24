import React, { useEffect, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import type { BoardIssuePatch, BoardItem } from '../../types';
import { parseIssueRef } from '../../utils/board';
import { FIELD_INPUT } from './IssueFields';

/** Saves the patch; resolves true when GitHub accepted it */
export type IssueSave = (
  patch: BoardIssuePatch,
  optimistic?: Partial<BoardItem>
) => Promise<boolean>;

const GHOST_BTN =
  'flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-50';
const PRIMARY_BTN =
  'px-2.5 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50';

/** Esc inside an editor cancels it, without also closing the panel */
const stopEscape = (e: React.KeyboardEvent, cancel: () => void) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  cancel();
};

export const EditableTitle: React.FC<{ title: string; editable: boolean; onSave: IssueSave }> = ({
  title,
  editable,
  onSave,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== title) onSave({ title: next }, { title: next });
  };
  if (draft !== null)
    return (
      <input
        autoFocus
        value={draft}
        maxLength={256}
        aria-label="Titel"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          stopEscape(e, () => setDraft(null));
        }}
        className={`${FIELD_INPUT} !text-base font-semibold`}
      />
    );
  return (
    <h2 className="group text-base font-semibold text-white leading-snug text-balance">
      {editable ? (
        <button
          onClick={() => setDraft(title)}
          className="text-left hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor rounded"
          title="Titel bearbeiten"
        >
          {title}
          <Pencil
            size={12}
            className="inline ml-1.5 text-gray-500 opacity-0 group-hover:opacity-100"
          />
        </button>
      ) : (
        title
      )}
    </h2>
  );
};

const STATES = [
  { value: 'OPEN', label: 'Offen' },
  { value: 'COMPLETED', label: 'Geschlossen: erledigt' },
  { value: 'NOT_PLANNED', label: 'Geschlossen: nicht geplant' },
] as const;

export const IssueStateSelect: React.FC<{ item: BoardItem; onSave: IssueSave }> = ({
  item,
  onSave,
}) => {
  const current =
    item.state === 'CLOSED'
      ? item.stateReason === 'NOT_PLANNED'
        ? 'NOT_PLANNED'
        : 'COMPLETED'
      : 'OPEN';
  return (
    <select
      value={current}
      aria-label="Zustand"
      onChange={(e) => {
        const v = e.target.value as (typeof STATES)[number]['value'];
        if (v === 'OPEN') onSave({ state: 'OPEN' }, { state: 'OPEN', stateReason: 'REOPENED' });
        else onSave({ state: 'CLOSED', stateReason: v }, { state: 'CLOSED', stateReason: v });
      }}
      className="bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-100"
    >
      {STATES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
};

/** Small "#12 / owner/name#12" input with an add button */
const RefInput: React.FC<{
  label: string;
  repo: string | null;
  onSubmit: (ref: { repo: string; number: number }) => Promise<boolean>;
  onCancel?: () => void;
}> = ({ label, repo, onSubmit, onCancel }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = parseIssueRef(text, repo);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ref || busy) return;
    setBusy(true);
    if (await onSubmit(ref)) setText('');
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        autoFocus={!!onCancel}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => onCancel && stopEscape(e, onCancel)}
        placeholder="#12 oder owner/repo#12"
        aria-label={label}
        className={FIELD_INPUT}
      />
      <button type="submit" disabled={!ref || busy} className={PRIMARY_BTN}>
        {busy ? '…' : 'OK'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className={GHOST_BTN} aria-label="Abbrechen">
          <X size={12} />
        </button>
      )}
    </form>
  );
};

export const ParentEditor: React.FC<{
  item: BoardItem;
  onSave: IssueSave;
  children: React.ReactNode;
}> = ({ item, onSave, children }) => {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <RefInput
        label="Parent-Issue"
        repo={item.repo}
        onCancel={() => setEditing(false)}
        onSubmit={async (parent) => {
          const ok = await onSave({ parent });
          if (ok) setEditing(false);
          return ok;
        }}
      />
    );
  return (
    <div className="group flex items-center gap-1 min-w-0">
      <span className="min-w-0 truncate">{children}</span>
      <button
        onClick={() => setEditing(true)}
        className="p-0.5 rounded text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={item.parent ? 'Parent ändern' : 'Parent setzen'}
        title={item.parent ? 'Parent ändern' : 'Parent setzen'}
      >
        <Pencil size={11} />
      </button>
      {item.parent && (
        <button
          onClick={() => onSave({ parent: null }, { parent: null })}
          className="p-0.5 rounded text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Parent entfernen"
          title="Parent entfernen"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
};

/** Issue description: plain text view (no Markdown renderer in the app), textarea to edit */
export const IssueBody: React.FC<{
  body: string | null;
  error: string | null;
  onSave: IssueSave;
}> = ({ body, error, onSave }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(null), [body]);
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    if (await onSave({ body: draft })) setDraft(null);
    setSaving(false);
  };
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
        Beschreibung
        {draft === null && body !== null && (
          <button onClick={() => setDraft(body)} className={`ml-auto ${GHOST_BTN}`}>
            <Pencil size={12} /> Bearbeiten
          </button>
        )}
      </h3>
      {draft !== null ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              stopEscape(e, () => setDraft(null));
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }}
            rows={10}
            aria-label="Beschreibung (Markdown)"
            className={`${FIELD_INPUT} font-mono resize-y`}
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setDraft(null)} className={GHOST_BTN}>
              Abbrechen
            </button>
            <button onClick={save} disabled={saving} className={PRIMARY_BTN}>
              {saving ? 'Speichere …' : 'Speichern'}
            </button>
          </div>
        </div>
      ) : error ? (
        <p className="text-xs text-red-300">Nicht geladen: {error}</p>
      ) : body === null ? (
        <p className="text-xs text-gray-400">Lade …</p>
      ) : body.trim() ? (
        <div className="text-xs text-gray-200 whitespace-pre-wrap break-words leading-relaxed max-h-72 overflow-y-auto thin-scrollbar rounded-md border border-gray-700 bg-gray-850 px-3 py-2">
          {body}
        </div>
      ) : (
        <p className="text-xs text-gray-400">Keine Beschreibung.</p>
      )}
    </section>
  );
};

/** "+ Sub-Issue" control under the sub-issue list */
export const AddSubIssue: React.FC<{ repo: string | null; onSave: IssueSave }> = ({
  repo,
  onSave,
}) => {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="mt-2">
      <RefInput
        label="Sub-Issue hinzufügen"
        repo={repo}
        onCancel={() => setOpen(false)}
        onSubmit={(addSubIssue) => onSave({ addSubIssue })}
      />
    </div>
  ) : (
    <button onClick={() => setOpen(true)} className={`mt-1.5 ${GHOST_BTN}`}>
      <Plus size={12} /> Sub-Issue hinzufügen
    </button>
  );
};
