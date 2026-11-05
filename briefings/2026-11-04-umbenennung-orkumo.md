# Briefing: Umbenennung DevOrbit / DevHub → Orkumo

Quelle: GitHub-Issue https://github.com/hpmartini/DevHub/issues/196 (Autor hpmartini). Wortlaut als Daten: Titel „Umbenennung in OrkUmo“, Text „Neuer Name: Orkumo — Für Repo, Projekt, lokales Verzeichnis, Landingpage (GitHub-Pages)“.

## The Job

Jedem Menschen, der das Produkt sieht, öffnet, verlinkt oder klont, einen einzigen Namen zeigen: **Orkumo**. Heute koexistieren zwei Altnamen, **DevOrbit** (Produkt, UI, Code, Electron, Docker) und **DevHub** (GitHub-Repo, Landingpage, einige Docker-/Env-Namen). Umbenennen: GitHub-Repo zu `hpmartini/Orkumo`; App-Name in UI, Fenstertitel, `index.html`, Electron-`productName`, `package.json`-Namen, README/Docs/CLAUDE.md/AGENTS.md und Repo-Links; Landingpage auf GitHub Pages unter `https://hpmartini.github.io/Orkumo/`. Das lokale Verzeichnis `~/PROJECTS/DevOrbitDashboard` wandert per mitgeliefertem Skript nach `~/PROJECTS/Orkumo`, das Hape nach dem Merge ausführt. Lokale Daten, Desktop-Installationen und Board-Abläufe überstehen den Wechsel ohne Verlust.

## Why

DevOrbit ist Hapes Arbeitsumgebung für agentische Entwicklung (docs/VISION.md). Mit einem einheitlichen Namen kann Hape das Produkt zeigen, verlinken und weiterentwickeln, ohne dass alte Namen in UI, Repo-URL oder Landingpage auftauchen, und ohne dass gespeicherte Einstellungen, Datenbanken oder `mw board`-Läufe (finden den Klon über die Remote-URL) brechen.

## Guardrails

- Persistierte und technische Bezeichner bleiben unverändert, weil eine Umbenennung Nutzerzustand verliert oder bestehende Setups bricht: localStorage-Keys (`devOrbit*`, `devorbit-*`), Env-Variablen (`DEVORBIT_*`, `DEVHUB_*`), Datenpfade (`devorbit-data`, `devorbit-rate-limits.json`), DB-/User-/Volume-/Netzwerk-/Container-Namen in Docker und `docker/init-db.sql`, Electron-`appId`. Interne Code-Bezeichner (z. B. `public/devorbit-vite-plugin.js`, `DEVORBIT_LOGGER__`) dürfen bleiben. Neue Env-Variablen-Namen sind nicht Teil des Auftrags.
- Electron-`userData` hängt auf macOS am App-Namen; nach dem neuen `productName` muss die App dieselben Daten finden (alten Pfad weiter nutzen oder einmalig migrieren), weil sonst alle Desktop-Daten scheinbar weg sind.
- Reihenfolge: erst PR offen, dann `gh repo rename Orkumo`. GitHub leitet Repo-, Git-, Issue- und Release-URLs um; die alte Pages-URL `hpmartini.github.io/DevHub/` nicht (wird 404, akzeptiert).
- Landingpage liegt auf Branch `gh-pages` (legacy build, Root `/`, gebaute Assets mit Pfadpräfix `DevHub/`). Name, Texte, Asset-Pfade und Release-Links umstellen; Build-Quelle suchen und dort ändern, falls vorhanden, sonst die gebauten Dateien.
- Release/Update auf das neue Repo zeigen lassen: `electron-builder.json` (publish), `.github/workflows/release.yml`, Links in `electron/main.js`, `docker/docker-compose.release.yml`-Image-Referenzen (Image-Namen nur ändern, wenn das Release-Workflow sie mitbaut).
- Lokales Verzeichnis: die laufende Session sitzt darin, darum kein Verschieben im Lauf. `scripts/rename-local-dir.sh` (`set -euo pipefail`, idempotent, `--dry-run`): bricht ab, wenn Prozesse mit cwd im Ordner laufen; verschiebt den Ordner; setzt `origin` auf `hpmartini/Orkumo`; `git worktree repair`; verschiebt `~/.claude/projects/-Users-example-PROJECTS-DevOrbitDashboard` auf `-Users-example-PROJECTS-Orkumo`; passt den Eintrag `devorbitdashboard` in `~/PROJECTS/Maple/config/projekt-repos.json` an. `~/.claude.json` nicht anfassen (Claude legt Einträge neu an).
- Nicht anfassen: `briefings/` (historische Dokumente), `graphify-out/`, bestehende `CHANGELOG.md`-Einträge, `dist*`-Artefakte.

## Done means

| ID   | Bedingung                                                                                    | Nachweis                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Keine sichtbare Altnamen-Fundstelle mehr im Repo; nur erlaubte technische Bezeichner bleiben | `git grep -n -i "devorbit\|devhub\|dev orbit" -- . ':!briefings' ':!graphify-out' ':!CHANGELOG.md'`; Ausgabe im PR als Restliste, jede Zeile einer Guardrail-Kategorie zugeordnet                                                    |
| AC-2 | Build, Lint, Tests grün                                                                      | `bun run build`, Lint- und Test-Skript aus `package.json`, Ausgabe im PR                                                                                                                                                             |
| AC-3 | Laufende App zeigt „Orkumo“ in Browser-Titel und App-Shell, nirgends „DevOrbit“/„DevHub“     | `bun run dev`, Playwright-Screenshots von `/dashboard`, `/agents`, `/code` im PR unter `## Screenshots` plus `document.title` und Volltextsuche im DOM                                                                               |
| AC-4 | Bestehende localStorage-Einstellungen bleiben nach dem Update wirksam                        | Test oder Playwright-Lauf: Key `devOrbit*` vor dem Update setzen, nach dem Update wirkt er                                                                                                                                           |
| AC-5 | Desktop-App findet nach Umbenennung dieselben `userData`-Daten                               | Test der Pfadauflösung in `electron/main.js` (alter Pfad wird genutzt oder migriert), plus `electron-builder --dir`-Build, Pfad im Log                                                                                               |
| AC-6 | Repo heißt `hpmartini/Orkumo`; alte URL leitet um                                            | `gh repo view hpmartini/Orkumo --json name`; `curl -sI https://github.com/hpmartini/DevHub` → 301 auf Orkumo                                                                                                                         |
| AC-7 | Landingpage unter neuer URL live, mit neuem Namen                                            | `curl -s https://hpmartini.github.io/Orkumo/` → HTTP 200, `<title>` enthält „Orkumo“, `grep -ci "devhub\|devorbit"` = 0; Screenshot im PR                                                                                            |
| AC-8 | Release-/Update-Konfiguration zeigt aufs neue Repo                                           | `grep` in `electron-builder.json`, `release.yml`, `electron/main.js` zeigt `Orkumo`, keine `DevHub`-Repo-URL                                                                                                                         |
| AC-9 | Verzeichnis-Skript arbeitet korrekt, ohne Hapes Ordner im Lauf zu bewegen                    | `scripts/rename-local-dir.sh --dry-run` gegen den echten Ordner (Ausgabe im PR) und echter Lauf gegen eine Wegwerf-Kopie (Klon mit Worktree + Fake-`~/.claude/projects`-Ordner via `HOME`-Override) inkl. `git worktree list` danach |

Stopp nur bei fehlenden Rechten für Repo-Rename oder Pages; dann berichten. Rückmeldung: PR mit Restliste und gesetzten Annahmen.

## Ambition

- Altitude: keine; reine Umbenennung.
- Depth: vollständiges Inventar über `git grep` plus Branch `gh-pages`, getrennt nach sichtbar vs. persistiert; Ziel: 0 sichtbare Altnamen, 0 verlorene Einstellungen.
- Crew: tut, was ein Release-Engineer tut: prüfen, dass Auto-Update bestehender Desktop-Installationen über die Repo-Umleitung weiter Releases findet.

## Prüfung

langlebig · unabhängig · Repo-Identität, Desktop-Datenpfade und Update-Kanal betreffen alle bestehenden Installationen.

## First on approval

Inventar der Fundstellen (`git grep` plus Branch `gh-pages`) in „sichtbar → umbenennen“ und „persistiert/technisch → bleibt“ einteilen.

## Annahmen

- Schreibweise **Orkumo** (Issue-Text), Slug `orkumo`; Titel-Schreibweise „OrkUmo“ gilt als Variante. (vorgeschlagen)
- Persistierte/technische Bezeichner (localStorage, Env, Datenpfade, Docker-DB/Volumes, `appId`) bleiben; Umbenennung wäre ein eigenes Issue mit Migration. (vorgeschlagen)
- Repo-Rename und Landingpage-Push macht die Umsetzung selbst, weil das Issue sie verlangt; alte Pages-URL wird 404. (vorgeschlagen)
- Lokales Verzeichnis per Skript nach dem Merge durch Hape, nicht im Lauf. (vorgeschlagen)
- Logo, Icon, Farben bleiben; nur Name. (vorgeschlagen)
- `ui: on`, weil sichtbare UI sich ändert. (vorgeschlagen)
