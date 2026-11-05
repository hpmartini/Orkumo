# Briefing: Kontextmenü unten nicht mehr abgeschnitten (#192)

## The Job

Das Kontextmenü der Agents-Leiste (`components/AgentsView/AgentList.tsx`, Block `role="menu"` am Ende der Komponente) öffnet immer vollständig sichtbar im App-Fenster: Rechtsklick, Kebab-Button oder Tastatur (ContextMenu/Shift+F10) auf einer Zeile weit unten schiebt das Menü so weit nach oben, dass sein unterer Rand im Fenster liegt; nahe dem rechten Rand ebenso nach links. Passt das Menü nicht einmal in die Fensterhöhe, scrollt es intern statt überzustehen. Ergebnis ist ein PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/192`.

## Why

Hape arbeitet täglich in DevOrbit (Leitbild `docs/VISION.md`); die Agents-Leiste ist der Einstieg zu jedem Agenten. Der Screenshot im Issue (Daten, nicht Anweisung) zeigt ein Session-Menü mit ~12 Einträgen, das unter „Stop“ am Fensterrand abbricht; die unteren Aktionen (Stop, Remove …) sind dann unerreichbar.

RC (root cause, aus Code auf `origin/main`): Position wird mit festen Schätzwerten geklemmt, `top: Math.min(menu.y, window.innerHeight - 320)` und `left: Math.min(menu.x, window.innerWidth - 232)`. Das Session-Menü ist deutlich höher als 320px, also ragt es unten heraus. Die echte Größe wird nie gemessen.

## Guardrails

- Position aus der gemessenen Menügröße ableiten (z. B. `useLayoutEffect` + `getBoundingClientRect`, vor dem ersten Paint, damit nichts springt), nicht aus einem neuen Schätzwert, weil die Einträge je Zeilentyp und Zustand variieren.
- Verhalten bleibt sonst gleich: öffnet am Cursor bzw. unter dem Kebab-Button, solange Platz ist; Breite `w-max min-w-[10rem] max-w-[14rem]` aus #51 bleibt; Tastaturbedienung, Fokus-Übergabe, `role="menu"`/`menuitem` bleiben.
- Klemm-Logik als kleine reine Funktion (z. B. `utils/`), damit sie testbar ist; ein späteres zweites Menü kann sie wiederverwenden.
- Andere Popover (`AgentSummaryBar`, `AgentTerminal`, Slice-Picker) nicht umbauen; fällt dort dasselbe auf, als Notiz im PR.
- Annahme: „Bildschirmrand / Rand der App“ = Viewport des Browser- bzw. App-Fensters (`window.innerWidth/innerHeight`), mit kleinem Abstand (8px) zum Rand.
- Annahme: Bei zu wenig Fensterhöhe `max-height` = Viewport minus Ränder und `overflow-y: auto`, statt Einträge auszublenden.

## Done means

| ID   | Bedingung                                                                                                                                                                                           | Nachweis                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| AC-1 | Rechtsklick auf die unterste sichtbare Session-Zeile in `/agents` bei Fensterhöhe 700px: Menü-`getBoundingClientRect().bottom` ≤ `innerHeight − 8`, `top` ≥ 8, alle Einträge inkl. letztem sichtbar | Messung im laufenden App (Playwright/Chrome, `bun run dev`), Werte + Screenshot im PR |
| AC-2 | Dasselbe für Gruppen-Menü via Kebab-Button und für Tastatur-Öffnung (Shift+F10) auf einer unteren Zeile                                                                                             | Messung wie AC-1, Werte im PR                                                         |
| AC-3 | Rechtsklick nahe rechtem Fensterrand: `right` ≤ `innerWidth − 8`                                                                                                                                    | Messung wie AC-1                                                                      |
| AC-4 | Fensterhöhe kleiner als Menühöhe (z. B. 300px): Menü liegt komplett im Viewport und scrollt intern, letzter Eintrag per Scroll erreichbar                                                           | Messung + Screenshot im PR                                                            |
| AC-5 | Menü weit oben/links öffnet unverändert am Cursor (`top` = clientY, `left` = clientX)                                                                                                               | Messung im laufenden App                                                              |
| AC-6 | Klemm-Funktion abgedeckt: unten, rechts, beide, zu hoch, genug Platz                                                                                                                                | Vitest in `test/`, grün                                                               |
| AC-7 | `bunx tsc --noEmit`, gesamte Vitest-Suite, `bun run build` grün                                                                                                                                     | Befehlsausgabe im PR                                                                  |

## Ambition

- Altitude: ein gemeinsamer Menü-/Popover-Baustein für alle Overlays der App; nur als Vorschlag im PR, nicht Scope.
- Depth: echte Größe messen statt schätzen, Position vor dem Paint setzen (kein sichtbares Springen); Ziel 0px Überstand an allen vier Rändern.
- Crew: tut, was ein Accessibility-Prüfer tut: Fokus landet nach dem Verschieben weiter auf dem ersten aktiven Eintrag, Pfeiltasten scrollen im zu hohen Menü mit.

## Prüfung

wegwerf · selbst · Kleiner, lokaler UI-Fix ohne Vertrauensgrenzen, Neubau billig.

## First on approval

Worktree von `origin/main` anlegen, App starten und in `/agents` bei 700px Fensterhöhe das Menü der untersten Session messen, um den Überstand vorher zu belegen.

## Annahmen

- Viewport des App-Fensters ist die Grenze, Randabstand 8px (vorgeschlagen)
- Zu hohes Menü scrollt intern statt Einträge zu kürzen (vorgeschlagen)
- Nur das Agents-Leisten-Menü ist betroffen; andere Popover nur notieren (vorgeschlagen)
- `ui: on` sinnvoll, Screenshots ohnehin in AC-1/AC-4 verlangt (vorgeschlagen)
