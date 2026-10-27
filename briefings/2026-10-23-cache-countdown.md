# Briefing: Cache-Countdown pro Agent

Quelle: Issue https://github.com/hpmartini/DevHub/issues/71 ("Cash" im Issue = Prompt-Cache).

## The Job

Im Agents View (`/agents`) zeigt jede Session ihren Prompt-Cache-Zustand:

- **Restzeit** bis der Cache verfällt (Countdown mm:ss, tickt clientseitig jede Sekunde),
- **Füllstand**: gecachte Tokens relativ zum Kontextfenster des Modells (Balken + Zahl, z.B. `142k / 200k`),
- **Hits**: Zahl der Turns mit `cache_read_input_tokens > 0` plus Trefferquote (gelesene / alle Input-Tokens).

Bei ≤ 10 Minuten Restzeit (und > 0) werden die Agent-Zeile und die Zeile/Gruppe ihres Projekts in der Liste sichtbar hervorgehoben (z.B. Amber-Ring + Countdown in Amber). Abgelaufener Cache wird grau als "abgelaufen" gezeigt, nicht hervorgehoben.

## Why

Hape lässt viele Claude-Sessions parallel laufen (Abo, kein API-Key). Verfällt der Cache, kostet der nächste Turn den vollen Kontext neu an Tokens und Rate-Limit. Mit dem Countdown sieht er, welchen Agenten er jetzt noch anstoßen sollte, bevor der Cache kalt wird. Teil der ADE-Vision (`docs/VISION.md`): Agent-Zustand auf einen Blick.

## Guardrails

- Datenquelle: Transcript `~/.claude/projects/<slug>/<sessionId>.jsonl`, letzte Zeilen mit `message.usage` (`cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`, `timestamp`). Pfadauflösung wie `sessionModel()` / `getTranscriptTail()` in `server/services/agentService.js` wiederverwenden, keine zweite Implementierung.
- Server: Feld `cache` in `AgentContext` ergänzen (`server/services/agentContextService.js` → `computeAgentContexts`, Typ in `types.ts`). Server liefert Rohwerte (`lastActivityAt`, `ttlMs`, `cachedTokens`, `contextWindow`, `hits`, `turns`, `hitRatio`), Restzeit rechnet der Client, damit der 30s-Poll von `useAgentContexts` reicht. Transcript nur inkrementell bzw. tail-begrenzt lesen; große Transcripts dürfen den Context-Endpoint nicht spürbar verlangsamen.
- Berechnung als pure, unit-getestete Funktion (Muster: `utils/agentSessions.ts`), Tests mit vitest wie bestehende `*.test.ts`.
- UI in `components/AgentsView/AgentList.tsx` (bestehende Zeilen-/Ring-Klassen nutzen), Detail ggf. in `PeekPanel.tsx`. Kein neues Dependency.
- Annahme: TTL aus dem letzten Assistant-Turn: 1h, wenn `ephemeral_1h_input_tokens > 0` oder der Turn nur aus Cache gelesen hat und vorher 1h galt, sonst 5 min. Jeder Turn mit Cache-Read oder -Write setzt die Uhr neu (`timestamp` + TTL).
- Annahme: "wie voll" = Kontextfenster-Auslastung (`cache_read + cache_creation + input` des letzten Turns ÷ Fenster). Fenster: 1M bei Modell-ID mit `[1m]`, sonst 200k; Tabelle an einer Stelle.
- Annahme: Hits zählen über die ganze Session, nicht nur seit letztem Ablauf.
- Annahme: Schwelle 10 min fest im Code (eine Konstante), keine Einstellung.
- Annahme: Remote-/Cloud-Sessions (`RemoteAgents`, Mesh) out of scope; dort kein Transcript lokal. Sie zeigen nichts statt falscher Werte.
- Out of scope: Benachrichtigungen/Push, automatisches "Cache warm halten", Kosten in Geld.

## Done means

- Lokale Session mit frischem Turn zeigt Countdown nahe 60:00 bzw. 5:00, Füllstand und Hits; Werte stimmen mit einem händischen Abgleich gegen die letzte `usage`-Zeile ihres Transcripts überein (im PR zeigen).
- Session mit < 10 min Rest: Agent und Projekt hervorgehoben; Screenshot im PR.
- `bun run build`, `bunx vitest run` und `bunx tsc --noEmit` grün; neue Tests decken TTL-Wahl, Ablauf, Hits/Quote, fehlende/defekte Transcripts.
- Bestehende Context-Felder (repo, pulls, servers, subagents) unverändert.
- Weiterarbeiten bis fertig, außer das Transcript-Format enthält die `usage`-Felder nicht (dann berichten). Rückmeldung: kurzer Bericht, was gebaut, welche Annahmen gegriffen haben.

## First on approval

Eine Transcript-Datei einer laufenden Session lesen und die `usage`-Felder der letzten Turns gegen die Annahmen oben prüfen (TTL-Erkennung, Fenstergröße).
