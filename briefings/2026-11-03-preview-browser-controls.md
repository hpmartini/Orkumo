# Briefing: Preview-Browser – Vor/Zurück, Maustasten, Schließen-Icon, Reload nur im Browser

Quelle: Issue https://github.com/hpmartini/DevHub/issues/182 (Text von hpmartini, Screenshot zeigt die Electron-Variante mit Wrench-„DevTools“ und Pfeil-Icon rechts oben).

## The Job

Der eingebettete Preview-Browser in der Desktop-App (`components/CodingView/ElectronBrowserView.tsx`, native `BrowserView` aus `electron/main.js`) verhält sich wie ein normaler Browser:

- Zurück- und Vor-Button links neben Refresh in der URL-Leiste; deaktiviert, wenn es keine Historie in die Richtung gibt.
- Die Maus-Seitentasten (Zurück/Vor) navigieren im Preview, wenn der Zeiger darüber ist.
- Der Schließen-Button rechts oben neben „DevTools“ zeigt ein Schließen-Icon (`X`, wie in der iframe-Variante `BrowserPreviewPanel.tsx`), nicht `ExternalLink`.
- Cmd+R (macOS) bzw. Ctrl+R und F5 laden bei Fokus im Preview nur den Preview neu, nicht die ganze DevOrbit-App.
- Das URL-Feld zeigt nach Zurück/Vor und nach Link-Klicks im Preview die tatsächlich geladene URL.

## Why

Hape nutzt den Preview beim agentischen Entwickeln, um die laufende App zu prüfen. Heute fehlt Navigation, und ein reflexhaftes Cmd+R lädt das ganze Dashboard neu: Terminals, Agent-Panes und der Preview selbst werden zerstört (`did-start-navigation` in `main.js` räumt alle BrowserViews ab). Danach muss er den Arbeitskontext neu aufbauen. Ziel ist, dass der Preview sich wie Chrome bedient, ohne die Shell zu gefährden.

## Guardrails

- Dateien: `electron/main.js` (IPC-Handler, Menü-Accelerator, Events der View), `electron/preload.js`, `electron/electron.d.ts`, `ElectronBrowserView.tsx`, Tests unter `test/`. Neue IPC-Methoden folgen dem Muster der bestehenden `browser-view-*`-Handler (Rückgabe `{ success, error }`).
- Electron 39: `webContents.navigationHistory` (`canGoBack`, `goBack` …) ist verfügbar; die alten `webContents.goBack/canGoBack` sind deprecated, also nicht nutzen.
- Die View bleibt sandboxed ohne Node und ohne Preload (bewusste Sicherheitsentscheidung in `main.js`); eine Lösung für die Maus-Seitentasten darf das nicht aufweichen. `app-command` feuert nur unter Windows/Linux, macOS braucht einen anderen Weg.
- Cmd+R außerhalb des Previews lädt die App weiter neu wie bisher (Menü `File → Refresh` und `View → reload` behalten ihre Funktion), weil Hape das zum Neustart des Renderers nutzt.
- Reine Entscheidungslogik (z.B. „welches webContents bekommt den Reload“) in einen testbaren Helper legen, wie `electron/validation.js` es vormacht.
- Out of scope: iframe-Fallback `BrowserPreviewPanel.tsx` (Web-Modus), Tabs, History-Liste, Hard-Reload-Varianten, Swipe-Gesten.

## Done means

| ID   | Bedingung                                                                                                              | Nachweis                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Zurück- und Vor-Button stehen links neben Refresh, navigieren die View und sind disabled ohne Historie in die Richtung | Komponententest in `test/electronBrowserView.test.tsx` (Aufruf der neuen API, disabled-Zustand); Screenshot im PR                                       |
| AC-2 | URL-Feld zeigt nach Zurück/Vor und nach Link-Klick im Preview die geladene URL                                         | Komponententest: Navigations-Event aus dem Main-Prozess aktualisiert URL-Feld und Button-Zustand                                                        |
| AC-3 | Maus-Seitentasten (Zurück/Vor) über dem Preview navigieren die View                                                    | Unit-Test des Main-Helpers; GIF im PR aus `bun run electron:dev`. Nachweis offen, falls macOS die Tasten ohne View-Preload nicht liefert (Befund im PR) |
| AC-4 | Schließen-Button rechts oben zeigt `X` statt `ExternalLink`, Funktion unverändert                                      | Komponententest prüft Icon und `onHide`; Screenshot im PR                                                                                               |
| AC-5 | Cmd+R / Ctrl+R und F5 mit Fokus im Preview laden nur die View neu; Terminals und Panes bleiben                         | Unit-Test des Reload-Helpers (fokussiertes webContents → Ziel); GIF im PR: Terminal-Inhalt bleibt nach Cmd+R im Preview                                 |
| AC-6 | Cmd+R mit Fokus außerhalb des Previews lädt weiter die App; iframe-Variante unverändert                                | Unit-Test des Reload-Helpers (Fokus im Hauptfenster → App); bestehende Tests grün                                                                       |
| AC-7 | Gesamtstand sauber                                                                                                     | `bunx vitest run` grün, `bunx tsc --noEmit` ohne neue Fehler, Ausgabe im PR                                                                             |

Stopp nur, wenn AC-3 unter macOS ohne Preload in der View technisch nicht machbar ist: Rest fertigstellen, AC-3 mit Befund als offen melden. Rückmeldung: kurzer Bericht, was gebaut, was angenommen, was offen.

## Ambition

- Altitude: keine; kleiner Bedienfix.
- Depth: Electron-39-API `webContents.navigationHistory` und Events `did-navigate`/`did-navigate-in-page` statt eigener History-Logik; Chromes Verhalten bei Seitentasten und Reload als Referenz.
- Crew: tut, was ein Sicherheitsprüfer tut: bestätigt, dass die View weiter sandboxed ohne Node/Preload läuft und keine neue IPC-Methode beliebige Ziel-Views oder Protokolle annimmt.

## Prüfung

langlebig · unabhängig · Electron-Main-Prozess und IPC sind Kern der Desktop-App, Fehler beim Reload-Routing kosten Hapes Arbeitskontext.

## First on approval

In `electron/main.js` prüfen, welches `webContents` beim Menü-Accelerator Cmd+R fokussiert ist (`webContents.getFocusedWebContents()`), wenn der Fokus im BrowserView liegt, und darauf den Reload-Pfad aufbauen.

## Annahmen

- „dieselben Buttons per Maus“ meint die Seitentasten einer Maus (Button 4/5), nicht Trackpad-Gesten. (vorgeschlagen)
- „im Preview-Browser drücken“ heißt: Tastaturfokus liegt im Preview-Inhalt. Fokus im URL-Feld des Panes zählt nicht; dort lädt Cmd+R weiter die App. (vorgeschlagen)
- Schließen-Icon ist `X` aus lucide-react, gleiche Größe wie bisher (14). (vorgeschlagen)
- `ui: on` für den Build, weil sichtbare UI und eine Bedien-Journey geändert werden (vorgeschlagen)
