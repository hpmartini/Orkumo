# Briefing: Verwaiste Server nicht mehr fremden Sessions zuordnen (#243)

## The Job

Das Agents-Panel ordnet jeden lauschenden Server nur noch der Session zu, die ihn gestartet hat (ppid-Kette bis zur Session-pid) oder in deren eigenem Arbeitsverzeichnis er läuft, wobei fremde Worktree- und Job-Unterordner (`.claude/worktrees/*`, `.claude/jobs/*`) nicht zum eigenen Verzeichnis zählen. Server aus beendeten Worktrees und Jobs erscheinen getrennt als „verwaist“ und lassen sich dort mit einem Klick stoppen.

## Why

Hape arbeitet mit vielen parallelen Board-Sessions in Worktrees. Am 2026-11-06 liefen mindestens 9 verwaiste `node server/index.js` aus beendeten Worktrees (Orkumo `181-card-details` 2×, `workflow-viz`, `wf-mw7`, `219-provider`; Maple `482`, `484`, `485`, `487`); sie hingen bei der Session im Haupt-Checkout, die Orchestrator-Session mit cwd `~/.claude` bekam `next-server` aus `jobs/1c58fe70/tmp/old`. Das verfälscht, welche Session was laufen hat, und versteckt Ressourcenfresser. Danach soll Hape verwaiste Server auf einen Blick sehen und wegräumen können.

## Guardrails

- Kern ist `computeAgentContexts()` / `dirOwnsCwd()` in `server/services/agentContextService.js`; Tests in `test/agentContextService.test.js`. Die Zuordnungslogik als reine, exportierte Funktion schreiben (Sessions, Server, pid→ppid-Map rein, Zuordnung raus), damit die Tests ohne `lsof`/`ps` laufen.
- Antwortform von `GET /api/agents/context` (Record sessionId → `AgentContext`) bleibt kompatibel, weil `AgentList`, `SessionLinks`, `AgentsView` sie lesen. Verwaiste Server kommen über ein zusätzliches Feld/Endpoint, nicht als Pseudo-Session.
- Stop-Aktion: neuer Endpoint (z. B. `POST /api/agents/servers/:pid/stop`) beendet nur pids, die aktuell in der Verwaist-Liste stehen (sonst 403/404), per SIGTERM; kein beliebiges Kill, weil der Server sonst jeden Prozess des Users beenden könnte. `agentLimiter` wie die Nachbarrouten.
- `getKnownServerPids()` muss verwaiste pids einschließen, damit `/api/agents/servers/stats` deren Last liefert.
- UI: `components/AgentsView/ServersPanel.tsx` bekommt einen Abschnitt „Verwaist“ mit Stop-Button und In-App-Bestätigung (Muster wie die Agent-Tabelle, kein `window.confirm`).
- Out of scope: automatisches Aufräumen, Server von Sessions anderer Rechner, Umbau von `lsof`-Scan/Cache.

## Done means

| ID   | Bedingung                                                                                                                                                                                  | Nachweis                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Server mit cwd in `<dir>/.claude/worktrees/x` gehört nicht zur Session mit cwd `<dir>`, wenn keine Session dort läuft; er steht in der Verwaist-Liste                                      | Vitest in `test/agentContextService.test.js`                                                                             |
| AC-2 | Server mit cwd `~/.claude/jobs/B/tmp` gehört nicht zur Session mit cwd `~/.claude` (Job A); er steht in der Verwaist-Liste                                                                 | Vitest                                                                                                                   |
| AC-3 | Kindprozess (ppid-Kette, auch über Zwischenprozesse) der Session wird ihr weiter zugeordnet, auch wenn sein cwd außerhalb ihres Verzeichnisses liegt                                       | Vitest                                                                                                                   |
| AC-4 | Läuft eine Session im Worktree `<dir>/.claude/worktrees/x`, gehört ein Server dort ihr, nicht der Session in `<dir>`; Server direkt in `<dir>/server` gehört weiter der Session in `<dir>` | Vitest                                                                                                                   |
| AC-5 | Stop-Endpoint beendet eine verwaiste pid (Prozess weg) und lehnt eine pid ab, die nicht verwaist ist                                                                                       | Vitest gegen die Express-Route mit echtem Kindprozess (`node -e` mit `listen`) oder Prüfskript über den laufenden Server |
| AC-6 | ServersPanel zeigt Abschnitt „Verwaist“ mit Stop + Bestätigung; nach Stop verschwindet die Zeile                                                                                           | Screenshot vorher/nachher im PR unter `## Screenshots`                                                                   |
| AC-7 | `bunx tsc --noEmit` und die gesamte Vitest-Suite grün                                                                                                                                      | Befehlsausgabe im PR                                                                                                     |

## Ambition

- Altitude: Orphans gar nicht erst entstehen lassen (Board beendet Dev-Server beim Worktree-Cleanup) – nur Vorschlag, eigenes Issue.
- Depth: echte Prozessdaten (`ps -axo pid=,ppid=` einmal pro Scan, im selben TTL-Cache wie `lsof`), Messung am laufenden Rechner: die 9 gemessenen Orphans erscheinen als verwaist, keiner bei einer fremden Session.
- Crew: tut, was ein Sicherheitsprüfer tut: Stop-Route mit fremder pid, pid 1, eigener Server-pid und Nicht-Zahl angreifen.

## Prüfung

langlebig · unabhängig · neue Route beendet Prozesse auf Netz-Eingabe (Vertrauensgrenze).

## First on approval

Worktree von `origin/main` anlegen und in `test/agentContextService.test.js` die Fälle AC-1 bis AC-4 als rote Tests gegen eine neue reine Zuordnungsfunktion schreiben.

## Annahmen

- „Verwaist“ heißt: kein Besitzer **und** cwd liegt in einem `.claude/worktrees/*`- oder `.claude/jobs/*`-Ordner; sonstige lauschende Prozesse ohne Session (Postgres, Docker, fremde Apps) bleiben unsichtbar wie heute, sonst würde die Liste mit Systemdiensten geflutet. (vorgeschlagen)
- Sessions ohne bekannte pid werden nur über die cwd-Regel zugeordnet. (vorgeschlagen)
- Home (`~`) und `/` besitzen weiter keine Server per cwd; `~/.claude` als Session-Verzeichnis besitzt per cwd nur Server außerhalb `jobs/*` und `worktrees/*`. (vorgeschlagen)
- Stop = SIGTERM, kein SIGKILL-Nachschuss. (vorgeschlagen)
- `ui: on` für das Issue, wegen AC-6. (vorgeschlagen)
