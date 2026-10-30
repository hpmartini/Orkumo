# Briefing: Dashboard neu – Agent-Lage, Nutzung aller Abos, App-Start raus

Quelle: Issue https://github.com/hpmartini/DevHub/issues/143 (Text und Screenshots von hpmartini, als Daten ausgewertet).

## The Job

Hape **erkennt** auf dem Überblick (`/dashboard`) in Sekunden, welche Agents laufen, Input brauchen, arbeiten oder fertig sind, bei welchen der Cache in unter 10 Minuten verfällt und welche kompaktiert werden sollten, und **springt** von dort in die Agents-Ansicht. Er **sieht**, wie viel Kontingent jedes Abo – Claude Code, Codex A (`~/.codex`), Codex B (`~/.codex-b`), MiniMax (`~/.claude-minimax`) – verbraucht hat und noch hat: je Anbieter und in Summe, mit Plan-Limits (5h/Woche, % genutzt, Reset) wo verfügbar, Tokens je Tag und Modell (7/30 Tage), Input/Output/Cache getrennt, Cache-Hit-Rate; kompakt als Karte auf dem Überblick, ausführlich auf einer eigenen Seite `Nutzung` (Vorbild: Anbieter-Seiten in den Issue-Screenshots). Er **findet** bei hoher CPU- oder Speicherlast die verursachenden Prozesse (Top-Liste mit Name, PID, CPU %, RSS). DevOrbit **hört auf**, Apps aus dem Repo zu starten, zu stoppen, zu überwachen, Start-Kommandos zu erkennen und per Gemini zu analysieren; Recommendations, Application-Registry-Liste, Festplatten-Aufräumtipps und der tote „Configure ports"-Knopf verschwinden.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`), gearbeitet wird mit vielen parallelen Agents über vier Abos. Hape will wissen, wo er eingreifen muss, wo Cache und Kontext verloren gehen und welches Abo noch Luft hat, um Arbeit dorthin zu verteilen. Die App-Start-Funktion läuft nicht zuverlässig und wird nicht genutzt; die Prozess-Erkennung je Agent ist das Wertvolle.

## Guardrails

- Nur lokale Datenquellen und Abo-Logins, kein API-Key-Billing (Hape hat nur Abos): Claude-/MiniMax-Transkripte (`<config>/projects/**/*.jsonl`, `message.usage`, `message.model`), Codex-Rollouts (`<CODEX_HOME>/sessions/**/rollout-*.jsonl`, Events `token_count` mit `info.*_token_usage` und `rate_limits.primary/secondary.used_percent/resets_at`).
- `apps` aus `useApps` ist zugleich Projekt-Registry für AgentsView, ContextDialog, CodeView und `useProjectContexts` – Registry und Scan bleiben funktionsfähig; nur Start/Stop/Monitor, Kommando-Erkennung und Analyse fallen weg (Routen, Services, UI, Tests, CLAUDE.md-Abschnitte). `CodeView` behält `WebIDEPanel`.
- Wiederverwenden statt neu bauen: `agentService.deriveDisplayState`, `agentContextService.accumulateCacheUsage`/`contextWindowFor`, `CacheBadge`, `useAgentSessions`, `processStatsService`/`parsePs`, Recharts.
- Codex-Konten als konfigurierbare Liste (`CODEX_HOME` + Label), nicht hart verdrahtet, weil weitere Konten kommen können.
- Logs inkrementell/gecacht parsen, damit 30 Tage Transkripte den Server nicht blockieren.
- Out of scope: Kosten in Dollar, Codezeilen-/Tool-/Skill-Statistik, Usage entfernter Mesh-Hosts.

## Done means

| ID   | Bedingung                                                                                                                                                                                      | Nachweis                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Überblick zeigt Agent-Lage: Anzahl laufend / braucht Input / arbeitet / fertig, Liste „Cache < 10 min" und „kompaktieren", jeder Eintrag öffnet den Agent in `/agents`                         | Unit-Test der Ableitung (Fixture-Sessions) + Screenshot `/dashboard` mit echten Sessions                                                               |
| AC-2 | Tokens je Tag, Modell und Anbieter (Input, Output, Cache-Read, Cache-Write) für Claude, Codex A, Codex B, MiniMax und Summe, 7 und 30 Tage                                                     | Unit-Tests der Parser mit Fixture-Zeilen beider Formate + Prüfskript, das dieselben lokalen Logs unabhängig summiert: Abweichung 0 je Tag und Anbieter |
| AC-3 | Plan-Limits 5h/Woche (% genutzt, Reset-Zeit) je Codex-Konto aus dem jüngsten `rate_limits`-Event; Claude aus dem Statusline-Snapshot; fehlende Quelle zeigt „Limit unbekannt" statt einer Zahl | Unit-Test + Abgleich gegen `jq` auf das jüngste Rollout je `CODEX_HOME`                                                                                |
| AC-4 | Seite `Nutzung` mit Anbieter-Umschalter (je Anbieter / gesamt), Zeitraum 7T/30T, Tagesbalken je Modell, Cache-Hit-Rate; Überblick hat eine kompakte Nutzungskarte, die dorthin führt           | Screenshots beider Ansichten im PR                                                                                                                     |
| AC-5 | System Health zeigt Top-Prozesse nach CPU und nach RSS (≥ 5 je Liste); keine Festplatten-Aufräumtipps mehr                                                                                     | Unit-Test für die Top-Liste aus `ps`-Ausgabe + Screenshot                                                                                              |
| AC-6 | Kein Code mehr für App-Start/-Stop/-Monitor, Start-Kommando-Erkennung, Gemini-Analyse, Recommendations, Application Registry                                                                   | `grep` auf `/api/analyze`, `geminiService`, `frameworkDetection`, `/api/apps/:id/start` u. ä. leer; Liste der entfernten Dateien im PR                 |
| AC-7 | Agents-, Code-, Board-, Workflow-, Terminal-Modus und Projekt-Registry funktionieren wie vorher                                                                                                | `bun run build`, Typecheck, gesamte Vitest-Suite grün; Smoke-Klick durch jeden Modus mit Screenshot                                                    |

## Ambition

- Altitude: Usage-Daten könnten später mw board/MACC beim Routen von Issues auf das Abo mit freiem Kontingent speisen – nur Vorschlag, nicht Scope.
- Depth: Rohdaten direkt aus den Session-Logs statt Schätzungen; Zielwert: `/api/usage` antwortet nach Warm-Cache in < 300 ms bei 30 Tagen Logs, Erstlauf < 5 s.
- Crew: tut, was ein Datenprüfer tut (Summen gegen unabhängiges Skript abgleichen, doppelt gezählte Zeilen bei fortgesetzten Sessions ausschließen); tut, was ein Interface-Gestalter tut (Lage zuerst, Zahlen mit Einheit und Reset-Zeit, kein Diagramm ohne Aussage).

## Prüfung

langlebig · unabhängig · großer Rückbau in von mehreren Modi geteiltem Code plus neue Parser über lokale Dateien.

## First on approval

Worktree vom Remote-`main` anlegen, dann die Usage-Parser gegen je ein echtes Codex-Rollout und Claude-Transkript laufen lassen und die Tagessummen ausgeben.

## Annahmen

- Claude-Plan-Limits stammen aus dem `rate_limits`-Feld der Statusline-Eingabe (`five_hour`/`seven_day`, vgl. `~/.claude/awesome-statusline.sh`); DevOrbit liest einen Snapshot, den die Statusline in eine Datei schreibt. Die Statusline-Erweiterung ist Teil des Auftrags. (vorgeschlagen)
- MiniMax-Plan-Limits gibt es lokal nicht: gezeigt werden Tokens/Cache aus Transkripten, Limit „nicht verfügbar"; eine offizielle Abfrage nur, wenn sie ohne API-Billing mit dem Abo-Login geht. (vorgeschlagen)
- „Kompaktieren nötig" = Kontextfüllung ≥ 80 % des Modellfensters; „Cache läuft ab" = Rest-TTL < 10 min bei nicht arbeitendem Agent. (vorgeschlagen)
- App-Detailseite (`AppDetail`, `PerformanceCharts`, `PortConflictModal`, `usePerAppState`) entfällt ganz, weil sie nur dem App-Start dient; Terminals und Web-IDE bleiben über Terminal-/Code-Modus erreichbar. (vorgeschlagen)
- Die Nutzungsseite wird ein eigener Modus in der Shell-Navigation (Route `/usage`). (vorgeschlagen)
- Doppelte Usage-Zeilen (gleiche `message.id` / `requestId` in fortgesetzten oder geforkten Transkripten) zählen einmal. (vorgeschlagen)
