# Briefing: Agents-Liste – alle Gruppen ein-/ausklappen (DevHub#49)

## The Job

Hape klappt in der linken Agents-Leiste mit einem Klick alle Gruppen ein und mit einem zweiten alle wieder aus, per Maus und per Tastatur. Stand: Die zwei Buttons existieren schon auf `main` (Commit bf8bbe5): `RailNav` in `components/AgentsView/ProjectsRail.tsx` (Icons `ChevronsDownUp`/`ChevronsUpDown`, `title`- und `aria-label`-Tooltip, Fokusring, bei aktivem Quick-Filter deaktiviert), verdrahtet in `components/AgentsView/AgentsView.tsx` (~Z. 1655, `rail.collapseAll`/`rail.expandAll` aus `hooks/useRailPreferences.ts`, Unit-Tests in `test/railPreferences.test.ts`). Offen sind zwei Lücken: Es gibt keinen Test, der die Buttons selbst prüft, und keinen Tastaturweg außer Tab-Fokus. Der Job: beide Lücken schließen und das Verhalten in der echten App belegen.

## Why

Sub-Issue von #45 (Agents-Leiste Runde 5: Liste verhält sich wie ein Datei-Baum). Bei vielen Projekten und Worktrees ist die Leiste lang; Hape will schnell auf Überblick (alles zu) und zurück (alles auf), ohne jede Gruppe einzeln zu klicken.

## Guardrails

- Bestehende Buttons, ihre Position in der Kopfzeile und die Logik in `useRailPreferences.ts` bleiben; nur ergänzen, nicht umbauen, weil Feature und Tests schon laufen.
- Tastaturweg über die vorhandene Command Palette (`cmd(...)`-Liste in `AgentsView.tsx`, Gruppe `Rail`, neben `group.*`/`sort.*`), kein neuer globaler Shortcut, weil Einzeltasten in der Leiste schon belegt sind (`ShortcutsHelp.tsx`).
- Branch `macc/45`, PR #138 ergänzen (eigene `Closes`-Zeile für #49), kein Merge.
- Tests mit `NODE_ENV=test`, sonst scheitern viele Tests ohne `act` (bekannt aus PR #138).

## Done means

| ID   | Bedingung                                                                                                              | Nachweis                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Listenkopfzeile zeigt zwei Buttons „Collapse all groups“ / „Expand all groups“ mit Tooltip (`title`)                   | Komponententest auf `RailNav`: beide per `getByRole('button', {name})` gefunden, `title` gesetzt                            |
| AC-2 | Klick auf Collapse ruft das Einklappen aller Gruppen inkl. Favorites, Expand klappt alle auf                           | Komponententest: Handler je Klick aufgerufen; bestehender Hook-Test `collapseAll`/`expandAll` grün                          |
| AC-3 | Beide Buttons per Tab erreichbar und per Enter/Space auslösbar; bei aktivem Filter deaktiviert mit erklärendem Tooltip | Komponententest (`userEvent.tab` + `keyboard('{Enter}')`, `disabled`-Fall)                                                  |
| AC-4 | Command Palette bietet „Collapse all groups“ und „Expand all groups“ und führt sie aus                                 | Test oder Playwright-Lauf: Palette öffnen, Befehl wählen, Gruppen zu/auf                                                    |
| AC-5 | In der echten App klappen die Buttons alle Gruppen zu und wieder auf                                                   | Playwright gegen `bun run dev` auf `/agents`: Zahl der `aria-expanded="true"`-Gruppenköpfe vor/nach Klick, Screenshot im PR |
| AC-6 | Keine Regression                                                                                                       | `NODE_ENV=test bunx vitest run` grün, `bun run build` grün                                                                  |

## Ambition

- Altitude: keine; Teil des Baum-Verhaltens aus #45.
- Depth: übersprungen: einfache Aufgabe.
- Crew: tut, was eine A11y-Prüferin tut: Tab-Reihenfolge und Screenreader-Namen der zwei Buttons prüfen.

## Prüfung

wegwerf · selbst · kleine UI-Ergänzung ohne Vertrauensgrenze, Logik schon getestet.

## First on approval

Worktree auf `macc/45` anlegen und den Komponententest für `RailNav` schreiben (AC-1 bis AC-3).

## Annahmen

- „Tastaturzugriff“ heißt: Buttons per Tab fokussier- und per Enter/Space auslösbar plus Palette-Befehle; kein eigener Hotkey (vorgeschlagen).
- „Listenkopfzeile“ ist die `RailNav`-Zeile mit dem Gruppierungs-Umschalter, wo die Buttons schon sitzen (vorgeschlagen).
- Collapse schließt die Favorites-Gruppe mit ein, wie aktuell implementiert (vorgeschlagen).
- Bei aktivem Quick-Filter bleiben die Buttons deaktiviert, weil der Filter alle Gruppen offen hält (vorgeschlagen).
