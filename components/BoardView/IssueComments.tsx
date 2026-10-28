import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Quote, Reply, Send } from 'lucide-react';
import type { IssueComment } from '../../types';
import { addIssueComment, fetchIssueComments } from '../../services/boardApi';
import { insertIntoDraft, quoteComment, replyText } from '../../utils/issueControls';

const when = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

const ACTION =
  'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';

/** All comments of an issue (plain text, like the body) plus a composer with quote and reply */
export const IssueComments: React.FC<{ issueId: string }> = ({ issueId }) => {
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    setComments(null);
    setError(null);
    fetchIssueComments(issueId)
      .then((c) => alive && setComments(c))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Fehler'));
    return () => {
      alive = false;
    };
  }, [issueId]);

  const insert = (text: string) => {
    setDraft((d) => insertIntoDraft(d, text));
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      setComments(await addIssueComment(issueId, draft));
      setDraft('');
      setError(null);
    } catch (e) {
      // Draft stays so nothing typed is lost
      setError(`Nicht gesendet: ${e instanceof Error ? e.message : 'Fehler'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-label="Kommentare">
      <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
        <MessageSquare size={14} />
        Kommentare <span className="font-normal text-gray-400">{comments?.length ?? '…'}</span>
      </h3>
      {comments && comments.length > 0 && (
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-gray-700 bg-gray-850 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <span className="text-gray-200 font-medium">@{c.author}</span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  {when(c.createdAt)}
                </a>
                <span className="flex-1" />
                <button onClick={() => insert(replyText(c))} className={ACTION} title="Antworten">
                  <Reply size={12} />
                  Antworten
                </button>
                <button onClick={() => insert(quoteComment(c))} className={ACTION} title="Zitieren">
                  <Quote size={12} />
                  Zitieren
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-200 whitespace-pre-wrap break-words">
                {c.body}
              </div>
            </li>
          ))}
        </ul>
      )}
      {comments?.length === 0 && (
        <p className="text-xs text-gray-400 mb-3">Noch keine Kommentare.</p>
      )}
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <textarea
        ref={draftRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        rows={4}
        placeholder="Kommentar (Markdown) – ⌘↩ sendet"
        aria-label="Neuer Kommentar"
        className="w-full bg-gray-850 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 font-mono resize-y focus:outline-none focus:border-gray-500"
      />
      <div className="mt-1.5 flex justify-end">
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          className="flex items-center gap-1 px-2 py-1 rounded bg-sel text-white text-xs hover:bg-gray-750 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Send size={14} />
          {sending ? 'Sende…' : 'Kommentieren'}
        </button>
      </div>
    </section>
  );
};
