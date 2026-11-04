# Briefing: Agents in `~/.claude` starten (Issue #190)

Issue: https://github.com/hpmartini/DevHub/issues/190

## The Job

Hape trägt im Admin-Panel unter „Project Directories“ `/Users/example/.claude` ein, der Server nimmt es an, und danach startet er dort Agents (Dispatch in `/agents`, Terminal in Code mode) wie in jedem anderen Projektordner. Heute lehnt `validatePath` in `server/services/configService.js` jeden versteckten Ordner im Home mit „Scanning hidden directories in home is not allowed“ ab (Screenshot im Issue). Das Problem ist diese pauschale Sperre; die vermutete Lösung ist eine gezielte Ausnahme für das Claude-Config-Verzeichnis, nicht das Abschaffen der Regel.

## Why

`~/.claude` ist ein Git-Repo mit Hapes globaler Konfiguration (CLAUDE.md, rules, settings, hooks). Hape will Konfigurationsarbeit dort genauso per DevOrbit-Agent erledigen wie Projektarbeit, statt dafür ein separates Terminal zu öffnen. Die Project Directories sind laut Admin-Panel die einzige Quelle für Scan, Kontextliste und erlaubte Dispatch-Orte (`agentService.getAllowedDirectories` / `assertAllowedPath`); ist der Ordner dort drin, funktioniert der Rest bereits.

## Guardrails

- Ausnahme nur für das Claude-Config-Verzeichnis: `$CLAUDE_CONFIG_DIR`, sonst `~/.claude` (dieselbe Auflösung wie `JOBS_DIR` in `server/services/scannerService.js`), samt Unterordnern. Andere versteckte Home-Ordner (`~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`, beliebige `~/.foo`) bleiben gesperrt, weil die Regel Secrets vor Scan und Agent-Zugriff schützt.
- `FORBIDDEN_PATHS`, Traversal-Check und Symlink-Prüfung bleiben unverändert; ein Symlink, der von einem erlaubten Ort nach `~/.ssh` zeigt, wird weiter abgewiesen.
- Scanner (`scanDirectoryRecursive`) nicht umbauen: `~/.claude` ist selbst ein Git-Repo und erscheint damit als Projekt; versteckte Kinder werden weiter übersprungen, `scanDepth` 2 hält `plugins/marketplaces/*` draußen.
- Out of scope: Ordner-Picker (Browse-Button) für versteckte Ordner, Admin-UI-Umbau, generelles Freischalten versteckter Ordner.
- Annahme: Eintrag bleibt manuell (Hape tippt den Pfad); kein automatischer Default-Eintrag.

## Done means

| ID   | Bedingung                                                                                                                                                                                                       | Nachweis                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | `POST` auf die echte Add-Directory-Route (`server/index.js`, die `addDirectory` ruft) mit `~/.claude` liefert 2xx, und der Pfad steht danach in `config.json` (Datenpfad aus `dataPath.js`, temporär umgelenkt) | Integrationstest gegen den laufenden Express-Server mit temporärem Datenverzeichnis und temporärem HOME, in dem `.claude` existiert; plus Test mit `CLAUDE_CONFIG_DIR` auf einen anderen Ordner |
| AC-2 | Dieselbe Route lehnt `~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg` und einen beliebigen `~/.foo` weiter ab (4xx, Fehlermeldung wie bisher); ein Symlink in einem erlaubten Ordner auf `~/.ssh` wird abgewiesen    | Integrationstest, gleiche Umgebung wie AC-1                                                                                                                                                     |
| AC-3 | Mit `~/.claude` in der Config akzeptiert `sanitizeDispatchOptions` bzw. die Dispatch-Route `cwd = ~/.claude` (kein 403 „outside the configured project directories“)                                            | Test über die echte Route `/api/agents/*` mit gemocktem `claude`-Aufruf (Fremd-CLI); der Mock prüft, dass `cwd` der reale Pfad `~/.claude` ist                                                  |
| AC-4 | Scan mit `~/.claude` als Directory listet `~/.claude` als Git-Projekt und keine Einträge unter `plugins/marketplaces/`                                                                                          | Test von `scanAllDirectories` auf temporärem Baum mit `.git` und `plugins/marketplaces/x/.git`                                                                                                  |
| AC-5 | Admin-Panel im Browser: `/Users/example/.claude` eintragen → erscheint in der Liste ohne Fehlerbanner                                                                                                              | Screenshot im PR unter `## Screenshots` (vorher Fehlerbanner aus dem Issue, nachher Liste)                                                                                                      |
| AC-6 | Bestehende Tests und Build grün                                                                                                                                                                                 | `bun run test` (bzw. `bunx vitest run`) und `bun run build`, Ausgabe im PR                                                                                                                      |

Stopp-Regel: weiterarbeiten, außer `claude --bg` lehnt `~/.claude` als Arbeitsordner selbst ab (Trust) – dann berichten statt umgehen. Rückmeldung: PR mit `## Nachweise` je AC.

## Ambition

- Altitude: `~/.claude` als fester, immer verfügbarer „Config“-Kontext in DevOrbit ohne manuellen Eintrag – nur Vorschlag, eigene Freigabe nötig.
- Depth: Allowlist statt Regex-Lockerung; Prüfung auf Real-Path-Ebene, damit Groß-/Kleinschreibung (macOS) und Symlinks nicht durchrutschen.
- Crew: tut, was ein Sicherheitsprüfer tut: jeden Pfad, der die Ausnahme trifft, gegen Traversal (`~/.claude/../.ssh`), Symlinks und Präfix-Tricks (`~/.claude-evil`) testen.

## Prüfung

langlebig · unabhängig · Änderung an einer Sicherheitsprüfung für Pfade (Vertrauensgrenze für Scan und Agent-Dispatch).

## First on approval

Worktree von `origin/main` anlegen und in `server/services/configService.js` die Hidden-Dir-Prüfung samt ihren Aufrufern und vorhandenen Server-Tests lesen.

## Annahmen

- Ausnahme gilt nur für `$CLAUDE_CONFIG_DIR` bzw. `~/.claude`, nicht für andere versteckte Home-Ordner (vorgeschlagen)
- `~/.claude-evil` u. ä. Präfix-Verwandte bleiben gesperrt (vorgeschlagen)
- Kein automatischer Default-Eintrag; Hape trägt den Pfad selbst ein (vorgeschlagen)
- `ui: off`, Screenshot in AC-5 reicht, weil sich nur das Verschwinden eines Fehlers zeigt (vorgeschlagen)
