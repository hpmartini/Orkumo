# Briefing: Projekt-Kontexte als Tabs in der Titelleiste (#97)

## The Job

DevOrbit kennt benannte **Kontexte**. Jeder Kontext ist ein Tab in der Titelleiste (`components/TitleBar.tsx`) und bündelt Arbeit an einem Projekt, das mehrere Repositories umfassen oder nur einen Teil der Issues eines Repos betreffen kann (z.B. Epic A und Epic B im selben Repo als zwei Kontexte). Ein Kontext hat: Name, Mitglieder (App-IDs der gescannten Projekte) und optional einen Board-Filter auf Basis der bestehenden Slices (`BoardSliceKind` = repo | label | milestone | assignee, `utils/board.ts`). Kontexte lassen sich anlegen, umbenennen, löschen und umsortieren. Der Wechsel des Tabs tauscht den Arbeitsstand aus, der Modus (`/agents`, `/board`, `/code`, Überblick) bleibt.

Pro Kontext, nicht global:

- Favoriten und `favoritesSortMode` (heute `settingsService.js`)
- Board-Einstellungen `board` (Slice-Favoriten, Reihenfolge, versteckt)
- angehängte Agent-Tabs/Panes (`useAgentWorkspace`, `devOrbitAgentWorkspace.v2`)
- Rail-Präferenzen (`useRailPreferences`, `devOrbitAgentRail.v1`)
- Überblick, Projektliste und Board zeigen nur die Mitglieder bzw. den Filter des aktiven Kontexts.

Global bleiben: Archiv, Ports, eigene Namen, Board-Quelle, Ansichts-Kleinkram (BoardView `VIEW_KEY`, AgentsView-Sortierung, ProjectsRail eingeklappt).

## Why

Hape arbeitet parallel an mehreren Vorhaben und will pro Vorhaben eine aufgeräumte Umgebung: nur die relevanten Projekte, Issues und Agents, ohne bei jedem Wechsel Favoriten und Tabs neu zu sortieren. Das ist Säule 5 („Einheitliche Shell, Kontext-Leiste") aus `docs/VISION.md`.

## Guardrails

- Kontext-Definitionen und alle per-Kontext-Werte liegen serverseitig in den Settings (`server/services/settingsService.js`), weil Favoriten dort schon liegen und das Leitbild geräteübergreifend arbeitet. Bisherige localStorage-Werte (Workspace, Rail) wandern mit, analog zur Migration in `hooks/useApps.ts:38`.
- Migration: Beim ersten Start entsteht ein Standard-Kontext „Alle" mit allen Projekten, ohne Board-Filter, der sämtliche heutigen Werte erbt. Nichts, was Hape eingerichtet hat, darf verschwinden. Der letzte Kontext ist nicht löschbar.
- Begriff: `docs/VISION.md` nennt „Kontext" die Verknüpfung Issue ↔ Agent ↔ Worktree ↔ PR. #97 meint eine Gruppierung darüber. Annahme: UI-Text „Kontext", im Code ein eindeutiger Name wie `ProjectContext` (nicht `Workspace`, das ist schon `utils/agentWorkspace`); VISION.md nicht ändern.
- Titelleiste (entschieden von Hape): Kontext-Tabs ersetzen die App-Tabs. Die App-Tabs (`AppTabs`, `useAppTabs` in `App.tsx`) fliegen ersatzlos raus, keine zweite Leiste, weil das Feature später neu gebaut wird; dadurch toten Code entfernen. Die Titelleiste ist auch im Browser sichtbar, sobald es Kontexte gibt. Neue Tab-Elemente brauchen `WebkitAppRegion: 'no-drag'` (Electron-Drag-Region).
- Annahme: Kontext steht nicht in der URL, der aktive Kontext wird in den Settings gespeichert.
- Muster folgen: reine, getestete Reducer (`utils/agentWorkspace.ts`, `hooks/useRailPreferences.ts`), Hooks darüber. Keine neue Abhängigkeit.
- Out of scope: Neubau der App-Tabs, Agent-Liste nach Kontext filtern (nur der angehängte Workspace ist pro Kontext), automatische Kontexte aus Epics, Sync mit GitHub-Projects-Views, Änderungen an Mesh/Remote-Agents.
- Höchstens 3 Subagenten parallel.

## Done means

- Zwei Kontexte mit unterschiedlichen Favoriten, Agent-Tabs und Board-Filter angelegt; Tab-Wechsel zeigt jeweils den eigenen Stand, auch nach Reload und Neustart des Servers.
- Bestehende Installation startet ohne Datenverlust im Kontext „Alle".
- Checks grün: `bun run test` (inkl. `test/railPreferences.test.ts`, `test/useBoard.test.tsx`), neue Unit-Tests für Kontext-Reducer und Migration, `bun run build`.
- Unverändert: Archiv, Ports, Namen, Board-Quelle.
- Weiterarbeiten, außer bei Widerspruch zum Leitbild: dann `need-input`.
- Rückmeldung: PR mit Screenshot der Titelleiste, kurzer Liste der umgesetzten Punkte und der getroffenen Annahmen.

## First on approval

Settings-Schema für Kontexte samt Migration in `settingsService.js` entwerfen und mit Unit-Test absichern.
