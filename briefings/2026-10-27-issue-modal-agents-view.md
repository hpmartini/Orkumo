# Briefing: Issue-Modal aus dem Agents View, mit Kommentaren und Kontrollfluss-Buttons (DevHub #104)

## The Job

Ein Klick auf eine Issue-Pill im Agents View (`/agents`) öffnet das Issue in einem Modal über dem Agents View, statt nach `/board?item=…` zu springen. Das Modal bietet dieselben Kontrollen wie die Board-Sidebar (`components/BoardView/BoardItemPanel.tsx`: Titel, Status, Labels, Milestone, Assignees, Body, Parent/Sub-Issues, verlinkte Agents, Agent starten, Code öffnen) plus:

- Button „Im Board öffnen“ (bisheriges Ziel `/board?item=<key>`).
- Kommentare: alle lesen (chronologisch, Autor, Zeit, Markdown), neuen Kommentar schreiben, auf einen Kommentar antworten, einen Kommentar zitieren (fügt `> …`-Zitat mit Autor-Verweis in den Editor ein).
- Kontrollfluss-Buttons für die mw-board-Labels, damit Hape nicht im Label-Picker suchen muss: „Freigeben“ (`mw:go`), „Umsetzen“ (`mw:build`), Umschalter `mw:dynamic` und Modus (`mw:orchestrate` / `mw:pipeline` / `mw:image` / default); `need-input` sichtbar als Zustand.

Betroffen: die Pill-Handler in `components/AgentsView/AgentsView.tsx` (`onOpenIssue` an zwei Stellen, ~Z. 1633 und 1735), `SessionLinks.tsx` (Tooltip-Text), Board-Panel-Komponenten, `services/boardApi.ts`, `server/index.js` (`/api/board/*`), `server/services/boardService.js`.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`); Kernobjekt ist der Kontext Issue ↔ Agent ↔ PR. Hape steuert die mw-board-Pipeline über Issue-Kommentare und Labels (Rückfragen beantworten, Briefing freigeben mit `mw:build`). Heute verliert er dafür den Agents View oder muss auf GitHub. Ziel: Rückfragen eines Agents lesen, beantworten und die Umsetzung freigeben, ohne den Agents View zu verlassen.

## Guardrails

- Panel-Inhalt wiederverwenden, nicht duplizieren: `BoardItemPanel` (bzw. ein herausgelöster Inhaltsteil) rendert in Sidebar und Modal; Kommentare und Kontrollbuttons erscheinen dann auch in der Board-Sidebar. Modal-Muster und Fokus/Esc wie `IssueCreateModal.tsx` / `useDialogA11y`.
- Daten: Board-Item kommt aus `fetchBoard`/`useBoard`; Speichern über bestehendes `updateBoardIssue`/`setBoardItemStatus`. Labels-Buttons setzen über denselben Labels-Patch wie der Picker, weil die Label-Liste das ganze Set ersetzt (vorhandene Labels erhalten).
- Kommentare neu über `gh`-GraphQL wie der Rest von `boardService.js` (lesen: alle Seiten; schreiben: `addComment`). Eingaben serverseitig mit `validate(...)`-Schema prüfen wie die übrigen Routen, Limiter `agentLimiter`.
- GitHub kennt keine verschachtelten Antworten auf Issue-Kommentare. Annahme: „Antworten“ = neuer Kommentar mit Zitat des Ausgangskommentars und `@autor`; „Zitieren“ = nur Zitat in den Editor.
- Annahme: Liegt das Issue nicht auf dem MACC-Board (kein Board-Item), zeigt das Modal Titel, Body, Labels, Kommentare und Kontrollbuttons per Issue-Nummer; Status/Board-Felder entfallen, „Im Board öffnen“ ist deaktiviert.
- Annahme: Kommentare nur Issue-Kommentare (keine PR-Review-Kommentare); Bearbeiten/Löschen fremder oder eigener Kommentare ist out of scope.
- Annahme: Label-Semantik nach mw-board-Handbuch (`~/.claude/plugins/cache/martini-labs/mw/<ver>/skills/board/SKILL.md`); fehlt ein Label im Repo, legt der Button es nicht an, sondern ist deaktiviert mit Tooltip.
- Out of scope: Board-View-Umbau, PR-Ansicht, Benachrichtigungen.

## Done means

- Klick auf Issue-Pill im Agents View öffnet das Modal; URL bleibt `/agents`; „Im Board öffnen“ navigiert wie bisher.
- Kommentar lesen/schreiben/antworten/zitieren und `mw:build` setzen funktionieren gegen ein echtes Test-Issue (anlegen, danach schließen); Playwright-Screenshots im PR.
- Unit-Tests für Zitat-/Antwort-Formatierung und Label-Toggle (Set bleibt sonst erhalten), Server-Test für Kommentar-Route analog `test/boardService.test.js`.
- `bun run test` und `bun run build` grün, Ausgabe gezeigt. Board-Sidebar verhält sich sonst unverändert.
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/104` und `## Review-Anleitung`. Weiterarbeiten außer bei fehlenden `gh`-Rechten; dann berichten.
- Rückmeldung: kurze Liste geändert / angenommen / offen.

## First on approval

Worktree von `origin/main` anlegen und `BoardItemPanel.tsx` darauf prüfen, welcher Teil sich ohne Board-Kontext (Sidebar-Props) als Modal-Inhalt rendern lässt.
