# Briefing: Agent Task Board (DevHub #44)

## The Job

DevOrbit bekommt den Modus **Board** (Route `/board`): ein Kanban-Board über alle Issues und PRs eines GitHub-Projects (Default: MACC, `users/hpmartini/projects/4`), verbunden mit den Claude-Agents. Das abgenommene, klickbare Mockup ist die Referenz für Layout und Verhalten: `briefings/mockups/44-board.html` (im Browser öffnen).

- **Spalten** = Optionen des Status-Felds (heute Backlog, Todo, In Progress, to Review, to Deploy, Done), je Spalte ein eigener Farbton in Kopf und Zellen. Done eingeklappt, zeigt aufgeklappt nur die letzten 14 Tage.
- **Swimlanes** = Parent issue (Default), umschaltbar auf Repository oder keine. Jede Lane ist ein abgesetztes Band mit Kopf (Parent-Nr, Titel, Anzahl, Fortschritt), einklappbar.
- **Karten**: Repo#Nr, Titel, Labels in GitHub-Farbe, Sub-Issue-Fortschritt, Agent-Chips, verlinkte PRs mit CI-Status. Drag & Drop in eine andere Spalte setzt das Status-Feld auf GitHub (mit Rückgängig). Klick öffnet ein Seitenpanel: Status-Auswahl, Labels, Parent, Sub-Issues, PRs, Agents mit Sprung nach `/agents` (Session angehängt) und „Seine Issues“.
- **Linke Leiste** im Stil der Agents-Rail (`components/AgentsView/ProjectsRail.tsx`): Modus-Navigation, Slice-Umschalter (Repo, Label, Milestone, Assignee; Default Repo = Projekt), Slice-Liste mit „Alle“, Favoriten (anpinnen), manueller Reihenfolge per Drag & Drop und Ausblenden (unten „Ausgeblendet“, dort wieder einblenden; ausgeblendete Repos fehlen auch in „Alle“). Darunter die Agents: Klick filtert das Board auf deren Issues, Issue-Chip öffnet die Karte.
- **Gegenrichtung**: In `/agents` zeigt jede Agent-Zeile ihre Issue-Chips; Klick springt nach `/board` mit geöffneter Karte.

## Why

Hape steuert seine Arbeit über GitHub-Issues, die Agents per `mw board` abarbeiten. Er will an einem Ort sehen, welche Aufgaben aktiv sind und welcher Agent woran arbeitet, und per Klick zwischen Issue und Agent wechseln, ohne Kontext zu verlieren. Leitbild `docs/VISION.md`: DevOrbit ist seine Arbeitsumgebung für agentische Entwicklung; Kernobjekt ist der Kontext Issue ↔ Agent ↔ Worktree/Branch ↔ PR. Das Board ist Säule 2 (Epic #59). Die Kontext-Verknüpfung, die hier entsteht, nutzen später Code-Modus und Shell.

## Guardrails

- **Datenquelle**: Alle Items des Projects per GraphQL über die `gh`-CLI (`gh api graphql`, paginiert, Argument-Array per `execFile` wie in `server/services/agentContextService.js`), Status aus dem Feld-Wert jedes Items. Nicht auf GitHubs View-Darstellung verlassen: dort fehlen laut Hape teils zugeordnete Issues. Status schreiben per `updateProjectV2ItemFieldValue`; das `gh`-Token hat Scope `project`. GitHub bleibt Quelle der Wahrheit, keine zweite Kopie der Issues in der DB (Cache im Speicher ist ok, Polling um 60 s plus manueller Refresh).
- **Agent↔Issue-Verknüpfung abgeleitet**, nie manuell: `mw-board`-Kommentar am Issue (`<!-- mw-board:start session=<uuid> -->`, Job-ID = erste 8 Zeichen), PR-Links in `~/.claude/jobs/<id>/state.json`, „Closes #n“ im PR-Body. Reine Ableitungslogik in `utils/` mit Unit-Tests, Stil wie `utils/agentSessions.ts`.
- **Backend**: neue Routen unter `/api/board/*` in `server/index.js`, Service in `server/services/`, Eingaben validieren wie die bestehenden Agent-Routen. Board-Quelle (Owner, Project-Nr) im Admin-Panel änderbar, Default MACC. Favoriten, Reihenfolge, ausgeblendete Repos dauerhaft speichern, wie die vorhandenen App-Favoriten.
- **Frontend**: bestehende Shell und Komponenten nutzen (Tailwind-Tokens aus `index.html`, lucide-react, `usePopover`), keine eigene Layout-Welt. Neue Komponenten unter `components/BoardView/`.
- Nur unmodifizierte `claude`-CLI, keine Tokens aus `~/.claude` lesen (Leitbild Prinzip 5).
- Out of scope: Issues anlegen/editieren außer Status, Mesh/Remote-Agents (#57), Code-Modus-Diff.
- Annahme: Slices Milestone/Assignee dürfen leer sein, wenn MACC sie nicht pflegt.
- Annahme: Bei vielen Karten einer Zelle (Backlog hat ~315) reicht „+ n weitere“ statt Virtualisierung.

## Done means

- `/board` zeigt MACC mit allen Items, Spalten/Lanes wie oben. Abgleich: Anzahl je Status gleich der GraphQL-Abfrage auf das Project.
- Karte ziehen ändert den Status auf GitHub (per `gh api` nachgeprüft), Rückgängig setzt ihn zurück.
- Am Issue #44 erscheint Agent `6259550d`, am Agent der Chip DevHub#44; beide Sprünge funktionieren.
- `bun run build`, Lint und Vitest grün, neue Unit-Tests für Ableitung und Status-Mapping. Bestehende Ansichten (`/agents`, Dashboard) unverändert funktionsfähig.
- Screenshot des laufenden Boards im PR. Rückmeldung: kurzer Bericht, was getan, was angenommen.

## First on approval

Mit `gh api graphql` die Items von MACC samt Status, Parent, Labels und verlinkten PRs abfragen und daraus den Server-Endpunkt `GET /api/board/items` bauen.
