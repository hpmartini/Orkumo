# Briefing: Links per Default im eingebauten Browser öffnen

Issue: https://github.com/hpmartini/DevHub/issues/140

## The Job

Hape klickt in DevOrbit auf einen http(s)-Link (Terminal, eingebautes VS Code, App-UI selbst) und bleibt in DevOrbit: Der Link öffnet im eingebauten Browser, ohne den Modus zu wechseln. In der Agents-Ansicht öffnet ein Terminal-Link wie schon in #118 als Split-Pane rechts neben dem klickenden Terminal. In allen anderen Modi (Überblick, Board, Code, Workflows, Details-View) öffnet ein Browser-Panel rechts in der gemeinsamen Shell, in jedem Modus gleich. Eine Einstellung im Admin-Panel „Links öffnen in: eingebauter Browser | System-Browser“ (Default: eingebaut) schaltet alles auf den System-Browser um. Der Knopf „Extern öffnen“ in der Browser-Toolbar bleibt.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`): Kontext bleibt im Fenster, eine Shell für alle Modi. Agents, Board und VS Code liefern ständig Links (Dev-Server, PRs, Doku); heute reißt fast jeder davon Hape in den externen Browser. #118 (PR #150, gemergt) löste das nur für Cmd-Klick in Agent-Terminals; dieses Issue macht den eingebauten Browser zum Default überall.

## Guardrails

- Basis: origin/main ab `072f2f6` (enthält PR #150). Wiederverwenden: Browser-Panes aus `utils/agentWorkspace.ts` (`openBrowser`, `browserUrl`), `components/CodingView/BrowserPreviewPanel.tsx` (wählt `ElectronBrowserView` vs. iframe), Link-Handler in `components/AgentsView/AgentTerminal.tsx`. Kein zweiter Browser-Baustein.
- Link-Quellen: `AgentTerminal.tsx` und `components/XTerminal.tsx` (`WebLinksAddon`), App-UI (`window.open`/`target="_blank"` u. a. in `DashboardOverview`, `BoardView/*`, `AgentsView/{PeekPanel,PullRequestsPanel,SessionLinks,AgentList,ServersPanel}`, `WorkflowDetails`, `useApps.openInBrowser`), VS Code (code-server-iframe, cross-origin).
- Electron: `mainWindow.webContents.setWindowOpenHandler` (`electron/main.js:91`) fängt `window.open` aus Renderer und allen Subframes, auch dem code-server-iframe. Dort zentral entscheiden statt in jeder Komponente; die URL-Validierung `isValidExternalUrl` bleibt die Vertrauensgrenze, nur http(s) geht in den eingebauten Browser, alles andere (mailto, vscode://, file://) wie bisher.
- Web-Modus ohne Electron: App-UI- und Terminal-Links gehen über einen renderer-seitigen Weg; Links aus dem cross-origin VS-Code-iframe lassen sich technisch nicht abfangen und bleiben extern (mit Hape abgestimmt).
- Einstellung serverseitig persistieren wie die übrigen Admin-Settings (`/api/settings`, `fetchSettings` in `services/api.ts`), nicht nur `localStorage`, weil Electron und Web dieselbe Einstellung sehen sollen. Schema-Validierung am Server wie bei bestehenden Settings.
- Terminal-Semantik (Hape): Cmd-Klick (macOS) bzw. Ctrl-Klick öffnet den Link im konfigurierten Browser. Das ändert PR #150: dort ging Cmd-Klick immer intern.
- Electron-BrowserView ist ein natives Overlay: Bounds des Shell-Panels bei Resize, Moduswechsel, Modals und Command-Palette stimmen, sonst liegt der Browser über anderen UI-Teilen.
- Externe Desktop-IDE und Links aus anderen Apps: außer Scope (DevOrbit kann sie nicht abfangen).
- Bei mehreren Teilen höchstens 3 Subagenten.

## Done means

| ID   | Bedingung                                                                                                                                                            | Nachweis                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Admin-Panel hat „Links öffnen in: eingebauter Browser / System-Browser“, Default eingebaut; Wert überlebt Reload und Server-Neustart                                 | Vitest für Settings-Schema/Default + `curl` GET/PUT `/api/settings` vor und nach Server-Neustart                                                                                                                                                                                     |
| AC-2 | Agents-Ansicht, Einstellung eingebaut: Cmd/Ctrl-Klick auf http(s)-Link im Agent-Terminal öffnet Split-Pane rechts (Verhalten aus #118 bleibt)                        | bestehende `utils/agentWorkspace.test.ts` grün + Playwright-Lauf mit Screenshot                                                                                                                                                                                                      |
| AC-3 | Einstellung System-Browser: derselbe Cmd/Ctrl-Klick öffnet extern, Workspace unverändert                                                                             | Unit-Test des Link-Handlers (Entscheidung intern/extern je Einstellung) + Playwright: neuer externer Tab/Popup, Panes unverändert                                                                                                                                                    |
| AC-4 | Außerhalb der Agents-Ansicht (Board, Überblick, Details-View-Terminal `XTerminal`) öffnet ein Link das Browser-Panel rechts in der Shell; Modus/Route bleiben gleich | Playwright je Quelle (Board-Issue-Link, Dashboard-„Open in Browser“, XTerminal-Cmd-Klick): Route unverändert, Panel sichtbar mit URL; Screenshots im PR                                                                                                                              |
| AC-5 | Desktop-App: Link aus dem eingebauten VS Code (code-server) öffnet im eingebauten Browser-Panel; Einstellung System-Browser → extern                                 | Unit-Test der Routing-Funktion in `electron/` (http(s) + Einstellung → intern/extern/blockiert) + manueller Electron-Check per Review-Anleitung. Nachweis Electron-Lauf: offen, falls sich keine zweite Electron-Instanz neben Hapes laufender starten lässt (dann mit Grund melden) |
| AC-6 | Nicht-http(s)-URLs und von `isValidExternalUrl` abgelehnte URLs öffnen nie im eingebauten Browser und verhalten sich wie vorher                                      | Unit-Tests mit `mailto:`, `file:///etc/passwd`, `javascript:alert(1)`, `vscode://…`                                                                                                                                                                                                  |
| AC-7 | Browser-Toolbar zeigt weiter „Extern öffnen“; Klick öffnet die aktuelle URL im System-Browser                                                                        | Playwright/Screenshot                                                                                                                                                                                                                                                                |
| AC-8 | Shell-Browser-Panel schließbar; native Electron-View liegt nach Schließen, Moduswechsel und Resize nicht über anderer UI                                             | Review-Anleitung + Screenshot nach Moduswechsel (Electron), Web-Modus per Playwright                                                                                                                                                                                                 |
| AC-9 | Build, Typecheck, Tests grün                                                                                                                                         | `bun run build`, `bunx tsc --noEmit`, `bun run test:run` Ausgabe im PR                                                                                                                                                                                                               |

Stopp-Regel: weiterarbeiten, außer die native BrowserView lässt sich nicht sauber im Shell-Panel einbetten (dann Befund melden, nicht umbauen). Rückmeldung: PR mit `## Review-Anleitung`, `## Nachweise` je AC, getroffene Annahmen.

## Ambition

- Altitude: keine; das ist schon die Shell-weite Lösung.
- Depth: Inventar aller Link-Quellen per `git grep -nE "window\.open|target=\"_blank\"|openExternal"` vorher/nachher im PR; Ziel: keine Stelle umgeht die zentrale Entscheidung (Ausnahmen begründet).
- Crew: tut, was ein Sicherheitsprüfer tut: prüft, dass Seiten im eingebauten Browser (BrowserView/iframe) keinen Zugriff auf `electronAPI`/Preload bekommen und keine Navigation `javascript:`/`file:` durchkommt.

## Prüfung

langlebig · unabhängig · tägliche Arbeitsumgebung, und der Diff ändert, wie URLs aus Terminal-Ausgabe und fremden Seiten (Netz-Eingabe) in einer Electron-View geöffnet werden.

## First on approval

Worktree von origin/main, Link-Quellen inventarisieren und die Routing-Entscheidung (URL + Einstellung → eingebaut/extern/blockiert) als pure Funktion test-first anlegen.

## Annahmen

- Klick ohne Modifier im Terminal öffnet nichts mehr (übliches Terminal-Verhalten, verhindert Öffnen beim Markieren); bisher öffnete er extern. (vorgeschlagen)
- Es gibt keinen Einmal-Override „diesen Link extern“ per Modifier; extern geht über die Einstellung oder „Extern öffnen“ in der Toolbar. (vorgeschlagen)
- Shell-Panel: ein einziges Browser-Panel, ein neuer Link ersetzt die URL darin (keine Browser-Tabs). (vorgeschlagen)
- Shell-Panel bleibt pro Kontext offen wie andere UI-State (Route je Kontext, #97), URL wird über Reload gemerkt. (vorgeschlagen)
- In der Agents-Ansicht gehen auch App-UI-Links (PR-Links in PeekPanel/SessionLinks) ins Shell-Panel, nicht als Pane, weil sie keinem Terminal-Pane zugeordnet sind. (vorgeschlagen)
- localhost-URLs zählen als http(s) und öffnen intern. (vorgeschlagen)
