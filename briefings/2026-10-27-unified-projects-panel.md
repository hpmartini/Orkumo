# Briefing: Unified Projects-Panel (DevHub#119)

## The Job

DevOrbit hat links nur noch ein Panel: das Agents-Panel (`AgentsView`-Rail mit `RailNav`, `AgentList`, Projektgruppen). Es steht auf jeder Route links, auch bei `/`, `/board`, `/code` und der Projekt-Detailansicht. Die alte `Sidebar.tsx` und die `BoardRail` sind entfernt. Aus dem Panel heraus steuert Hape, was im Hauptbereich erscheint:

- Agent anklicken → Agent (wie heute).
- Projekt-Header: Button + Rechtsklick „View Code“ → `/code?path=<Projektpfad>`; Button + Rechtsklick „View Board“ → `/board` gefiltert auf dieses Repo.
- Agent-Karte: Button + Rechtsklick „Show on Board“ → `/board` gefiltert auf Repo und die Issues dieses Agents (`?agent=<jobId>` existiert schon).
- Dashboard ist kein Panel mehr, sondern eine Hauptbereich-Ansicht, erreichbar über die Rakete oben links (`TitleBar.tsx`) und das Bot-Icon im Agents-Panel-Header. App-Start landet auf `/agents`.
- Die Modus-Buttons Dashboard/Board/Code in `RailNav` entfallen.

## Why

Leitbild `docs/VISION.md`, Säule 5 „Einheitliche Shell“: eine Navigation, Modi hängen am Kontext (Projekt/Agent), nicht an eigenen Panels. Hape sieht alle Projekte bereits im Agents-Panel; drei parallele linke Panels sind doppelt. Danach soll jeder Moduswechsel ein Klick am Projekt oder Agent sein, mit erhaltenem Kontext.

## Guardrails

- Betroffen: `App.tsx` (`hasOwnRail`, Sidebar-Block, Routen), `components/AgentsView/{AgentsView,AgentList,ProjectsRail}.tsx`, `components/BoardView/{BoardView,BoardRail}.tsx`, `components/TitleBar.tsx`, `components/Sidebar.tsx` (löschen), Command-Palette-Einträge in `App.tsx`.
- Rail einmal rendern und auf allen Routen zeigen; nicht pro Ansicht duplizieren. Die heute „always mounted“-Ansichten (Agents-Terminals, Web-IDE-iframe, Board) bleiben gemountet, weil sonst Sessions und iframes neu laden.
- Repo-Filter des Boards per URL-Param (z. B. `?repo=owner/name`), damit Links aus dem Panel deeplinkbar sind; folge dem Muster von `agent`/`item` in `BoardView.tsx`.
- Projekt-Header kennen den GitHub-Namen (#96). Gruppen ohne GitHub-Remote zeigen „View Board“ nicht.
- Kontextmenüs über die bestehende `rowActions`/`groupMenuActions`-Mechanik in `AgentList.tsx` erweitern, kein neues Menü-System.
- Annahme: Board-Funktionen der BoardRail (Slice nach Label/Milestone/Assignee, Favoriten/versteckte Slices, Agent-Liste) wandern in die Board-Toolbar im Hauptbereich statt ersatzlos zu verschwinden.
- Annahme: Dashboard-Inhalt (Overview, Registry, Recommendations, SystemHealth) bleibt inhaltlich unverändert; nur die Einbettung ändert sich.
- Annahme: Projekt-Detailansicht (`/:projectName/:projectId`, AppDetail/CodingView) bleibt erreichbar über „Open project“ im Panel; ihre linke Spalte ist ebenfalls das Agents-Panel.
- Annahme: Mobile nutzt das Agents-Panel als Drawer, wie `/agents` heute.
- Out of scope: neue Dashboard-Inhalte, Redesign von Board oder CodeView, Server-Änderungen.

## Done means

- Auf `/`, `/agents`, `/board`, `/code`, Projekt-Detail zeigt der Browser links genau das Agents-Panel; `Sidebar.tsx` und `BoardRail.tsx` existieren nicht mehr (`grep` leer).
- Rakete und Bot-Icon öffnen das Dashboard; App-Start zeigt `/agents`.
- „View Code“, „View Board“, „Show on Board“ funktionieren per Button und Rechtsklick und setzen den Filter sichtbar.
- `bun run build`, Typecheck und bestehende Tests grün; neue Unit-Tests für Board-Repo-Param und Menü-Aktionen.
- Nachweis: Playwright-Screenshots der fünf Routen plus der drei Sprünge im PR.
- Stoppen nur, wenn eine Leitbild-Entscheidung nötig wird; sonst durcharbeiten. Rückmeldung: kurzer Bericht, getroffene Annahmen, PR-Link.

## First on approval

Feature-Branch im eigenen Worktree von `origin/main` anlegen und in `App.tsx` die Rail-Einbettung (`hasOwnRail`/Sidebar-Block) gegen die Agents-Rail tauschen.
