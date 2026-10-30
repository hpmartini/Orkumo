# Briefing: Review-Anleitungen als ausführbares Skript im PR (DevHub#155)

## The Job

Board-Sessions liefern mehrschrittige Review-Anleitungen nicht mehr als Textwand, sondern als ausführbares Skript im PR-Branch. Hape kopiert einen Befehl aus dem Haupt-Checkout, das Skript baut das Setup auf (Wegwerf-DB, Migration, Seed, Dev-Server), führt die Tests aus und nennt am Ende URL und Login für die Sichtprüfung. `mw board done` erzwingt das mechanisch, der Review-Kommentar im Issue zeigt den einen Befehl.

## Why

Hape reviewt viele PRs aus MACC-Sessions (Beispiel: DocBase#293, fünf Schritte mit Docker, Env-Variablen, Node-Version). Durchlesen und Zusammensetzen kostet Zeit und Fehlversuche. Ein Skript macht das Review zu einem Befehl plus Sichtprüfung und dient zugleich als reproduzierbares E2E-Setup.

## Guardrails

- Änderung liegt in `hpmartini/example-workflow-plugin`, nicht in DevHub: dort entsteht die Regel. Worktree dort anlegen (`.claude/worktrees/<name>` von `origin/main`), PR dort, Body mit `Closes https://github.com/hpmartini/DevHub/issues/155`.
- Betroffen in `plugins/mw/core/mw/board.py`: `prompt()` und `goal_prompt()` (Regel im Session-Prompt), `pr_errors()` (Gate, reine Worker-Prüfung ohne Modellurteil; braucht dafür die PR-Dateien, `cmd_done` holt sie mit `files` in `gh pr view --json`), `review_body()` (zeigt den Befehl, nicht die Textwand).
- Tests in `plugins/mw/tests/test_board.py` (Prompt-Substrings ~Z. 504, `pr_errors`-Fixtures ~Z. 153–162) anpassen statt aufweichen. Doku: `docs/mw-board.md` (PR-Regeln), `plugins/mw/skills/board/SKILL.md`, `README.md`.
- Release nach Repo-Konvention (`chore(release): mw 7.0.x`: Version in plugin.json, marketplace.json, CHANGELOG, test_release).
- Einstufige Anleitungen („öffne /x“) bleiben Text: der Auftrag gilt nur mehrschrittigen.
- Skripte enthalten keine echten Secrets; Wegwerf-Zugangsdaten wie im Beispiel sind ok.
- `.claude/worktrees/board-abschluss-187` gehört einer anderen Session: nicht anfassen.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                                                                                                           | Nachweis                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Session-Prompt (`prompt`, `goal_prompt`) verlangt bei mehrschrittiger Review-Anleitung ein Skript im PR-Branch mit Skript-Vertrag: `set -euo pipefail`, Wegwerf-Infrastruktur, Tests laufen, `trap`-Cleanup, druckt URL/Login für die Sichtprüfung; Anleitung nennt einen aus dem Haupt-Checkout kopierbaren Befehl | Unit-Test auf Prompt-Substrings                                                                                    |
| AC-2 | `pr_errors` lehnt eine `## Review-Anleitung` mit mehr als 3 nicht-leeren Zeilen ab, wenn sie keinen `*.sh`-Pfad nennt, der unter den geänderten Dateien des PRs liegt; mit Skript oder ≤3 Zeilen passt sie                                                                                                          | Unit-Tests; der DocBase#293-Block aus dem Issue ist Negativ-Fixture, dieselbe Anleitung als Skript Positiv-Fixture |
| AC-3 | `review_body` zeigt im Issue-Kommentar den Startbefehl samt Skriptpfad                                                                                                                                                                                                                                              | Unit-Test                                                                                                          |
| AC-4 | Gesamte Testsuite grün                                                                                                                                                                                                                                                                                              | `python3 -m pytest plugins/mw/tests` (oder Repo-Runner), Ausgabe im PR                                             |
| AC-5 | Doku und Release-Version aktualisiert                                                                                                                                                                                                                                                                               | Diff von `docs/mw-board.md`, SKILL.md, README, `test_release` grün                                                 |
| AC-6 | PR offen, GitHub verknüpft DevHub#155 als schließend (cross-repo)                                                                                                                                                                                                                                                   | `gh pr view <pr> --json closingIssuesReferences` enthält die Issue-URL; `mw board done` läuft durch                |

## Ambition

- Altitude: DevHub-Button „Review starten“ am PR-Kontext, der das Skript im Terminal-Modus ausführt; nur Vorschlag, eigene Freigabe.
- Depth: Skript-Muster als Vorlage im board-SKILL.md (ein kurzes Beispiel, abgeleitet vom DocBase-Fall), Ziel: Review-Setup mit 1 Befehl statt 5.
- Crew: tut, was ein Release-Engineer tut: neues Gate gegen PRs laufender Sessions durchspielen; die Fehlermeldung von `board done` nennt konkret, was fehlt (Skript, Pfad), damit eine Session sie ohne Rückfrage behebt.

## Prüfung

langlebig · selbst · Gate betrifft jede Board-Session, aber ohne Vertrauensgrenze; Unit-Tests decken es ab.

## First on approval

Worktree in `example-workflow-plugin` von `origin/main` anlegen und `pr_errors`-Tests mit dem DocBase-Fixture schreiben.

## Annahmen

- Ziel-Repo ist `example-workflow-plugin`, DevHub bleibt unverändert (vorgeschlagen).
- Skriptpfad `scripts/review/<issue-nr>.sh`, bleibt nach Merge im Repo als reproduzierbares Setup (vorgeschlagen).
- Schwelle „mehrschrittig“ = mehr als 3 nicht-leere Zeilen in `## Review-Anleitung` (vorgeschlagen).
- Startbefehl holt den Branch in einen eigenen Worktree und startet das Skript dort, damit Hapes Haupt-Checkout unberührt bleibt (vorgeschlagen).
