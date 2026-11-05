# Briefing: „Working“ zeigt nur Agents, die wirklich arbeiten (#194)

## The Job

DevOrbit zählt und markiert einen Background-Agent nur dann als „working“, wenn er gerade tatsächlich arbeitet (laufender Modell-Turn bzw. Tool-Aufruf). Agents mit noch aktivem `/goal`, aber ohne laufende Arbeit, Agents, die nur auf einen eigenen Hintergrund-Task (Shell, Monitor) warten, und Agents, deren Job-Datei längst `done` sagt, erscheinen nicht mehr als „working“: weder im Zähler der Kopfzeile (`AgentSummaryBar`), noch im Status-Filter/der Status-Gruppe, noch auf der Karte (Spinner-Icon), noch auf der Übersicht (`/dashboard`, `AgentOverview`).

## Why

Hape steuert viele parallele Agents (MACC-Board) über `/agents`. Ein Zähler „17 working“, obwohl nur 1–2 wirklich laufen, macht die Liste als Lagebild wertlos: er sieht nicht, wer fertig ist und wer seine Aufmerksamkeit braucht. Beispiel aus dem Issue: „Zwei Landingpages“ steht als arbeitend, das Goal ist noch aktiv, aber im Agent läuft keine Arbeit.

Befund (Stichprobe 2026-11-04 08:43 UTC, `claude agents --json --all` gegen `~/.claude/jobs/<id>/state.json`, 15 Sessions mit CLI-`state: working`):

| CLI `state` | `state.json` `state` | CLI `status` | `tempo` | Anzahl                                                                          |
| ----------- | -------------------- | ------------ | ------- | ------------------------------------------------------------------------------- |
| working     | working              | idle         | idle    | 9                                                                               |
| working     | running              | idle         | idle    | 2                                                                               |
| working     | done                 | busy         | active  | 1 (iOS App #120, letzte Transcript-Zeile 2026-11-03 04:05, `/goal clear`)       |
| working     | done                 | idle         | active  | 1 (glen #337, `/goal clear`)                                                  |
| working     | working              | busy         | idle    | 1 (Zwei Landingpages: `inFlight.tasks: 1`, `local_bash`, wartet auf Test-Suite) |
| working     | working              | busy         | active  | 1 (tatsächlich arbeitend)                                                       |

Heute gewinnt in `listSessions` (`server/services/agentService.js`) `entry.state || state.state`, und Client-Zählung/Filter/Gruppe (`summarizeSessions`, `stateGroupOf`, Quick-Filter in `utils/agentSessions.ts`) prüfen `session.state === 'working'`; `displayState` (`deriveDisplayState`) bildet `working` ebenfalls 1:1 ab. Weder CLI-`state` noch `status` allein sind verlässlich (iOS App: `busy`, aber seit 28 h keine Aktivität).

## Guardrails

- Eine einzige Ableitung „arbeitet gerade“ (serverseitig in `deriveDisplayState` bzw. einer reinen Funktion daneben), die Zähler, Filter, Gruppe, Karte und Übersicht gemeinsam nutzen, weil die Anzeige heute an vier Stellen unabhängig `state === 'working'` prüft. Signale: `state.json` (`state`, `tempo`, `inFlight`, `updatedAt`), CLI `status`, ggf. Transcript-mtime; welche Kombination, entscheidet die Umsetzung anhand der Tabelle oben.
- „Needs input“ (`blocked`), „failed“, „stopped“, Loops (`loop`) und interaktive Sessions verhalten sich wie heute, weil der Fehler nur „working“ betrifft.
- `claude`-CLI und Job-Dateien nur lesen, nie schreiben, weil sie dem Daemon gehören.
- Kein Polling-Intervall oder neuer Prozess-Scan nötig; vorhandene Daten aus `listSessions` reichen.
- Out of scope: Goal-Status als eigenes Feature, Umbau der Karten, Board/MACC-Logik.

## Done means

| ID   | Bedingung                                                                                                                                                                                                | Nachweis                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Jede Zeile der Befund-Tabelle wird korrekt klassifiziert: nur `working/working/busy/active` ergibt „working“; die anderen fünf Kombinationen ergeben nicht „working“                                     | Unit-Tests in `test/agentService.test.js` mit diesen sechs Kombinationen als Fixtures (`deriveDisplayState` bzw. die neue Funktion) |
| AC-2 | Ein Agent, der nur auf einen eigenen Hintergrund-Task wartet (`tempo: idle`, `inFlight.tasks > 0`), zählt nicht als „working“ und ist auf der Karte als wartend erkennbar                                | Unit-Test + Komponententest (`test/AgentList.test.tsx`)                                                                             |
| AC-3 | Kopfzeilen-Zähler, Status-Quick-Filter „Working“, Status-Gruppe und `/dashboard`-Übersicht liefern für dieselben Sessions dieselbe Working-Zahl                                                          | Tests in `test/agentSessions.test.ts`, `test/agentOverview.test.ts`, `test/AgentSummaryBar.test.tsx` mit gemeinsamer Fixture        |
| AC-4 | Echter Pfad: `GET /api/agents` gegen die lokalen Sessions liefert eine Working-Zahl, die mit einer unabhängigen Zählung übereinstimmt (Session mit `tempo: active` und Aktivität in den letzten Minuten) | Ausgabe von `curl` + kurzes Prüfskript im PR                                                                                        |
| AC-5 | Sichtprüfung `/agents`: Zähler „working“ und Spinner nur bei tatsächlich laufenden Agents                                                                                                                | Screenshot vorher/nachher im PR unter `## Screenshots`                                                                              |
| AC-6 | Suite und Build grün                                                                                                                                                                                     | `bun run test` (vitest) und `bun run build`, Ausgabe im PR                                                                          |

Stopp-Regel: durcharbeiten, bis alle ACs belegt sind; nur stoppen, wenn sich aus den vorhandenen Signalen keine Regel findet, die die Tabelle korrekt trennt (dann mit Befund berichten). Rückmeldung: PR mit `## Nachweise` je AC.

## Ambition

- Altitude: Statt „working“ ja/nein ein Zustand „wartet auf Hintergrund-Task“ bzw. „Goal aktiv, pausiert“ als eigene Anzeige; nur vorgeschlagen, nicht Scope.
- Depth: echte Daten aus `~/.claude/jobs` als Fixtures (anonymisiert), Ziel: 0 Fehlklassifikationen auf der aktuellen Session-Liste.
- Crew: keine.

## Prüfung

langlebig · selbst · Anzeige-Logik ohne Vertrauensgrenze, aber zentral für Hapes tägliche Steuerung.

## First on approval

Worktree von `origin/main` anlegen und die sechs Befund-Kombinationen als fehlschlagende Tests in `test/agentService.test.js` schreiben.

## Annahmen

- Ein Agent, der nur auf eigene Hintergrund-Shell/Monitor wartet, gilt als nicht „working“ (Hape: „offensichtlich ist der fertig“); er bekommt einen dezenten Hinweis statt Spinner (vorgeschlagen).
- Wo CLI und `state.json` widersprechen und `state.json` `done` sagt, gewinnt `state.json` für die Working-Frage (vorgeschlagen).
- `ui: on` nicht nötig; ein Screenshot vorher/nachher reicht (vorgeschlagen).
