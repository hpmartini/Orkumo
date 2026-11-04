# Briefing: Workflow-Ansicht als Premium-Modul nach DevHub-pro auslagern (#165)

## The Job

Die Workflow-Ansicht (`/workflows`, Stand mw 7 aus #136, gemergt) aus dem öffentlichen DevHub entfernen und als Modul im privaten Repo `hpmartini/DevHub-pro` ausliefern, das der bestehende Modul-Loader (`DEVHUB_PREMIUM_DIR`, `docs/MODULES.md`) lädt. Mit Modul sieht und bedient Hape die Ansicht wie heute (eigener Modus mit Route, Navigation, Command-Palette, Projekt-Rail, GO, Details, Doku-Viewer, Graph/Szene); ohne Modul zeigt DevHub keinen Workflows-Modus, bedient keine `/api/workflows/*` und führt nirgends ins Leere. Dafür den Modulvertrag so erweitern, dass jedes Modul einen eigenen Modus mitbringen und über `mount(el, host)` mit dem Host sprechen kann.

## Why

Hape baut DevHub als öffentliches ADE und will einzelne Features als Premium verkaufen; die Workflow-Ansicht ist das erste. Der Modulvertrag, der hier entsteht, ist die Vorlage für alle folgenden Premium-Module: das nächste Modul soll ohne Änderung am Host andocken.

## Guardrails

- Zwei Repos, je ein PR, kein Merge: DevHub (Branch `feat/165-workflow-premium`, Worktree `.claude/worktrees/165-workflow-premium`) und DevHub-pro (privat, noch ohne Commit). Im Haupt-Checkout nichts ändern, dort arbeitet Hape.
- Host-Seite generisch halten: Modi kommen aus `GET /api/modules`, kein hart codiertes `workflows` mehr in `App.tsx`, `components/TitleBar.tsx`, `components/AgentsView/ProjectsRail.tsx` (`onOpenWorkflows`), Command-Palette, `utils/codeTarget.ts` (`workflowsUrl`). Betroffen außerdem `server/services/moduleLoader.js`, `components/ModuleSlot.tsx`, `hooks/useModules`.
- Ins Modul ziehen: `components/WorkflowView/*` (ohne `GoButton`), `utils/workflows.ts`, `utils/workflowGraph.js`, `server/services/workflowService.js`, Routen `/api/workflows/go|details|doc` samt `workflowContext`/`workflowDirs` aus `server/index.js`, `WorkflowDetails` aus `types.ts`, zugehörige Tests (`workflowGraph`, `workflowService`, `workflows`, `WorkflowCard*`, `projectFilter`).
- Das Modul importiert keine Host-Pakete, weil das Electron-Bundle keine `node_modules` dafür hat; alles kommt über `ctx` bzw. `host`. Es bündelt eigenes React, `motion`, `three` (zwei React-Instanzen über Hooks hinweg crashen).
- Öffentlich bleiben, weil das mw-Board öffentlich ist: Agents-Filter „Workflow“ und `parseWorkflowName`, mw-Marker im Board, Board-Poll-GO (#145).
- Höchstens 4 Subagenten.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                                                      | Nachweis                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | DevHub ohne Modul baut und testet grün                                                                                                                                                                                                                         | `bun run build` und Testlauf mit Exit 0, Ausgabe im PR                                                                                                         |
| AC-2 | DevHub enthält keinen Workflow-Ansichts-Code und keine `/api/workflows/*`-Route mehr                                                                                                                                                                           | `grep -rn "WorkflowView\|/api/workflows" --include='*.ts*' --include='*.js' . ` (ohne `node_modules`, `docs/`) leer; `curl` auf `/api/workflows/details` → 404 |
| AC-3 | Ohne Modul kein Workflows-Eintrag in TitleBar, Command-Palette, Projekt-Rail; `/workflows` führt nicht in einen leeren Modus                                                                                                                                   | Playwright-Screenshots + Test, der Nav/Palette ohne Module prüft                                                                                               |
| AC-4 | Board-Poll-GO funktioniert ohne und mit Modul                                                                                                                                                                                                                  | Test für die neue Board-Route + Klick im Board (Playwright) in beiden Varianten                                                                                |
| AC-5 | Modulvertrag: Modul deklariert Modus (Route, Label, Icon, Palette-Befehl), UI bekommt `mount(el, host)` mit Navigation (Agent, Code, Board), API-Basis und Sichtbarkeit; `ctx.services` enthält Repo-Auflösung, Agent-Kontexte, Board-Quelle, Stufen-/GO-Logik | `docs/MODULES.md` beschreibt es; Fixture-Modul mit Modus in `test/fixtures/premium`, Loader- und Modus-Tests grün                                              |
| AC-6 | DevHub-pro baut ein ladbares Modul (`index.js`, `ui.js`, `package.json` mit `"type": "module"`), umgezogene Tests grün                                                                                                                                         | `bun run build` + Testlauf in DevHub-pro mit Exit 0                                                                                                            |
| AC-7 | Mit Modul (`DEVHUB_PREMIUM_DIR=<pro>/dist`) rendert `/workflows` Karten; GO, Details, Doku-Viewer und Nav/Palette/Rail funktionieren, Konsole ohne Fehler                                                                                                      | Playwright-Screenshots + Konsolenlog gegen laufenden Dev-Server                                                                                                |
| AC-8 | Modul-UI läuft auch in Electron (Cross-Origin-Import)                                                                                                                                                                                                          | Nachweis: offen, falls Electron-Build lokal nicht startbar; sonst Screenshot aus Electron                                                                      |

## Ambition

- Altitude: Modulvertrag gleich als Paket `@devhub/module-api` (Typen für `ctx`/`host`) veröffentlichen, damit künftige Module typsicher bauen; eigener Scope, nur vorgeschlagen.
- Depth: Vertrag aus echten Nutzungsstellen ableiten (alle Host-Aufrufe der heutigen WorkflowView auflisten), Ziel: Host kennt das Wort `workflows` nur noch in `workflowStage`/Board; Modul-Bundle lädt in < 1 s lokal.
- Crew: tut, was ein Sicherheitsprüfer tut (Modul-Routen bleiben hinter `agentLimiter`/Validierung, `doc`-Endpunkt liest nur Pfade innerhalb der Worktree-/Clone-Verzeichnisse); tut, was ein Release-Engineer tut (Build-Gerüst DevHub-pro reproduzierbar, `bun install && bun run build` von frischem Klon).

## Prüfung

langlebig · unabhängig · Der Modulvertrag ist Schnittstelle für alle künftigen Premium-Module, und der `doc`-Endpunkt liest Dateien vom Server.

## First on approval

`docs/MODULES.md` um Modi, `mount(el, host)` und erweiterte `ctx.services` ergänzen und daraus die Host-Änderungen ableiten.

## Annahmen

- `utils/workflowStage.js`, `server/services/workflowGo.js` und `GoButton` bleiben im Host, weil Board (`BoardItemPanel` Poll-GO #145, `boardService.parseMwMarkers`, `issueControls`) sie braucht; das Modul bekommt Stufenlogik und GO über `ctx.services`, nicht als Kopie. `GoButton` zieht nach `components/BoardView/`. (vorgeschlagen)
- Board-Poll-GO zieht von `/api/workflows/poll` auf eine Board-Route (z. B. `POST /api/board/poll`). (vorgeschlagen)
- `host` im Frontend liefert mindestens `navigate(path)`, Ziel-Helfer für Agent/Code/Board (wie `utils/codeTarget.ts`), `apiBase`, `active` (Modus sichtbar, steuert Polling). (vorgeschlagen)
- DevHub-pro bekommt einen ersten Commit auf `main` (README, Build-Gerüst), damit der PR eine Basis hat; Build mit Vite/esbuild nach `dist/workflows/`. (vorgeschlagen)
- Ein direkter Aufruf von `/workflows` ohne Modul leitet auf `/dashboard` um. (vorgeschlagen)
