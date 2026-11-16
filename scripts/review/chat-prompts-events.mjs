import fs from 'fs';
// Usage: node scripts/review/chat-prompts-events.mjs before|after <out.json>
// Transcript lines as Claude Code 2.1 writes them → view events through the real reader.
// `before` drops what the old reader ignored (queue-operation, compact_boundary records).
import { TRANSCRIPT_READERS } from '../../server/services/chatTranscripts.js';
const L = (r) => JSON.stringify(r);
const user = (content) => L({ type: 'user', message: { role: 'user', content } });
const says = (id, text) =>
  L({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }] } });
const done = (ms) => L({ type: 'system', subtype: 'turn_duration', durationMs: ms });
const history = [
  user('Baue den Export der Chats als Markdown, mit Titel und Datum.'),
  says('a1', 'Export gebaut: `conversationMarkdown` schreibt Titel, Datum und alle Nachrichten.'),
  done(42000),
  user('Teste das mit einem Chat mit Bildern.'),
  says('a2', 'Bilder erscheinen als Link auf die Datei; Test ergänzt, 12/12 grün.'),
  done(18000),
  L({ type: 'system', subtype: 'compact_boundary' }),
  user('Jetzt die Liste der Chats nach Datum sortieren und gruppieren.'),
  says('a3', 'Sortiert nach letzter Aktivität, gruppiert nach Heute / Diese Woche / Älter.'),
  done(31000),
  user('Und baue noch eine Suche über die Titel ein.'),
  says('a4', 'Ich lese zuerst die Liste und den Store …'),
];
const live = [
  L({
    type: 'queue-operation',
    operation: 'enqueue',
    content: 'Zweiter Prompt während des Laufs: danach bitte auch die Tests laufen lassen.',
  }),
];
const read = (lines) => TRANSCRIPT_READERS.claude.historyEvents(lines);
const before = (events) =>
  events.filter((e) => e.type !== 'devorbit_queue' && e.subtype !== 'compact_boundary');
const mode = process.argv[2] ?? 'after';
const pick = mode === 'before' ? before : (e) => e;
fs.writeFileSync(
  process.argv[3],
  JSON.stringify({ history: pick(read(history)), live: pick(read(live)) })
);
