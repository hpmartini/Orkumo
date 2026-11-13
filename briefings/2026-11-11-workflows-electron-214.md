# Briefing: Workflows-Modul in Electron belegen (#214, AC-8 aus #165)

## The Job

Zeigen, dass die Electron-App, per `file://` geladen, die Modul-UI der Workflows-Ansicht (DevHub-pro, `dist/workflows/ui.js`) über den Cross-Origin-Import vom Server lädt und bedient: Mit `DEVHUB_PREMIUM_DIR=<DevHub-pro>/dist` rendert `/workflows` Karten ohne Konsolenfehler; ohne Modul zeigt dieselbe App keinen Workflows-Eintrag und leitet `/workflows` auf `/dashboard`. Scheitert der Import, die Ursache im Host beheben (nicht umgehen) und mit Test absichern; läuft es schon, ist der Beleg das Ergebnis, plus ein Test für den CORS-Pfad (Origin `null`/`file://` auf `/api/modules/<id>/ui.js`), falls keiner existiert.

## Why

#165 hat Workflows als erstes Premium-Modul aus dem öffentlichen Orkumo gelöst; AC-8 (Electron) blieb offen, weil die App lokal nicht gestartet wurde. Hape nutzt Orkumo als installierte Electron-App, und der Modulvertrag ist Vorlage für alle künftigen Premium-Module. Ein Modul, das nur im Browser lädt, ist nicht verkaufbar; danach ist #165 vollständig belegt.

## Guardrails

- Echter Pfad heißt `file://`: `electron:dev` lädt die Vite-URL (`electron/main.js:113`, http-Origin) und belegt nichts. Nachweis gegen den gebauten Renderer (`loadFile(dist/index.html)`, `electron/main.js:117`), also die gepackte App (`bun run build && bun run bundle:server && bun run electron:rebuild && bunx electron-builder --mac --arm64 --dir`, siehe `DESKTOP.md`).
- Start aus der Claude-Shell nur mit `env -u ELECTRON_RUN_AS_NODE`, sonst beendet sich die App stumm.
- Relevanter Code: CORS `server/index.js:137-146` (Origin `null`/`file://` nur bei `ELECTRON_MODE=true`), Modulrouter `server/services/moduleLoader.js` (`/api/modules/<id>/ui.js`), Import `components/ModuleMount.tsx:94`, Env-Weitergabe an den Server `electron/main.js:~492` (`...process.env`, `DEVHUB_PREMIUM_DIR` kommt durch, wenn Electron damit gestartet wird).
- Hapes installierte App und Datenordner bleiben unberührt, weil er damit arbeitet: `/Applications/Orkumo.app` nicht ersetzen, Symlink `~/Library/Application Support/devorbit-dashboard/data/modules → ~/PROJECTS/DevHub-pro/dist` nicht ändern. Gebaute App aus `dist-electron/` im Worktree starten; Ohne-Modul-Variante über `DEVHUB_PREMIUM_DIR` auf ein leeres Temp-Verzeichnis. Port 3099 kann belegt sein (Hapes App): vorher prüfen, ggf. eigenen `SERVER_PORT`.
- DevHub-pro nur bauen (`bun run build`), nicht ändern, außer die Ursache liegt nachweislich im Modul-Bundle; dann eigener PR dort.
- Screenshots aus Electron per Playwright `_electron.launch` oder CDP (`--remote-debugging-port`); Konsolenlog aus demselben Lauf.

## Done means

| ID   | Bedingung                                                                                                                                                   | Nachweis                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Gepackte Electron-App (Renderer per `file://`) mit `DEVHUB_PREMIUM_DIR=<DevHub-pro>/dist` öffnet `/workflows`, Karten rendern                               | Screenshot aus Electron unter `briefings/assets/214/`, im PR unter `## Screenshots`; dazu `location.protocol === 'file:'` aus demselben Lauf geloggt |
| AC-2 | Im selben Lauf Konsole ohne Fehler; `ui.js` mit Status 200 und CORS-Header für Origin `null`/`file://` geladen                                              | Konsolen- und Netzwerklog aus dem Electron-Lauf (0 Einträge Level `error`) im PR                                                                     |
| AC-3 | Gepackte App ohne Modul (`DEVHUB_PREMIUM_DIR` = leeres Verzeichnis): kein Workflows-Eintrag in Modusleiste und Command-Palette; `/workflows` → `/dashboard` | Screenshot aus Electron + geloggte End-URL nach Aufruf von `/workflows`                                                                              |
| AC-4 | CORS-Pfad für Modul-UI ist abgesichert: mit `ELECTRON_MODE=true` erlaubt `/api/modules/<id>/ui.js` Origin `null`, ohne `ELECTRON_MODE` nicht                | vitest gegen den echten Express-Server mit Fixture-Modul (`test/fixtures/premium`), grün; falls schon vorhanden, Verweis auf den Test                |
| AC-5 | Nichts sonst kaputt: Typecheck und Tests grün, Browser-Verhalten aus #165 AC-7 unverändert                                                                  | `bunx tsc --noEmit` und vitest Exit 0, Ausgabe im PR                                                                                                 |
| AC-6 | Hapes Umgebung unverändert                                                                                                                                  | `readlink` des `modules`-Symlinks und mtime von `/Applications/Orkumo.app` vor/nach im PR                                                            |

## Ambition

- Altitude: Electron-Smoke-Test (Playwright `_electron`) als wiederholbares Skript für jedes künftige Premium-Modul; nur vorschlagen, eigene Freigabe.
- Depth: Beleg über die gepackte App statt Dev-Modus; Zielwert Modul-UI nach Moduswechsel sichtbar in < 1 s lokal (gemessen, nicht verpflichtend).
- Crew: tut, was ein Sicherheitsprüfer tut: prüfen, dass Origin `null` außerhalb `ELECTRON_MODE` abgewiesen bleibt und keine weiteren Routen dadurch offen sind.

## Prüfung

langlebig · selbst · Reiner Nachweis plus höchstens kleiner CORS-Test; Vertrauensgrenze (CORS) ist durch AC-4 und Crew abgedeckt.

## First on approval

Worktree von `origin/main` anlegen, DevHub-pro bauen, Electron-App mit `--dir` bauen und mit `DEVHUB_PREMIUM_DIR=~/PROJECTS/DevHub-pro/dist` per `file://` starten.

## Annahmen

- Ein Electron-Build ohne Codesignatur/Notarisierung (`--dir`) reicht als Beleg. (vorgeschlagen)
- Läuft alles ohne Codeänderung, besteht der PR aus Nachweisen (`briefings/assets/214/`), CORS-Test (falls neu), Review-Skript `scripts/review/214.sh` und dem AC-8-Eintrag für #165 in `NACHWEISE.md`. (vorgeschlagen)
- `ui: on`, da Screenshots Kern des Nachweises sind; kein GIF, weil keine neue User Journey. (vorgeschlagen)
- Prüfung `selbst` statt `unabhängig`, weil kaum Code entsteht; ändert sich CORS-Logik im Host, auf `unabhängig` hochstufen. (vorgeschlagen)
