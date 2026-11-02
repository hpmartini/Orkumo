# Briefing: Agents-Liste – Klick, Ordnen, Favoriten, Ein-/Ausklappen in Project, Status und Directory

Issue: https://github.com/hpmartini/DevHub/issues/50 (Teil von #45)

## The Job

Hape in der linken Agents-Leiste (`/agents`) in allen drei Gruppierungen **Project**, **Status** (`grouping: 'state'`) und **Directory** dasselbe Baum-Verhalten geben: Gruppen per Einzelklick auf- und zuklappen, Gruppen per Drag & Drop, Menü („Move up/down") und Tastatur ordnen, Gruppen und Agents als Favorit markieren, alle Gruppen per Header-Buttons und Command Palette ein- und ausklappen. Eingeklappte Gruppen und manuelle Reihenfolge je Modus getrennt merken und nach einem Reload wiederherstellen. Für jeden der drei Modi mit Tests belegen.

## Why

#46–#49 sind gebaut und gemergt, getestet aber im Wesentlichen nur in Project (`test/RailNav.test.tsx` rendert nur `grouping="project"`). Hape wechselt im Alltag zwischen den Modi, z. B. Status, um wartende Agents zu sehen; die Leiste soll sich dort wie in Project verhalten. Ziel dahinter (#45, Säule „Agents und Mesh", Epic #60, `docs/VISION.md`): ein einheitliches Baum-Verhalten, auf das sich alle weiteren Leisten-Features verlassen können.

## Guardrails

- Stand Branch `macc/45` (Commit `04378e1`): Infrastruktur ist modusneutral – `hooks/useRailPreferences.ts` speichert `collapsed` und `order` unter `modes[groupBy]` (localStorage `devOrbitAgentRail.v1`); `components/AgentsView/AgentList.tsx` (Klick, Drag, Menü, Stern) und `AgentsView.tsx` (`collapseAllGroups`, `handleReorder`, Palette `groups.*`) prüfen den Modus nicht. Aufgabe: Verhalten belegen und gefundene Lücken schließen, nicht neu bauen, weil das Gerüst schon trägt.
- Lücken-Kandidaten, gezielt prüfen: Status-Gruppe „Completed" mit „… N more" (`hidden`) beim Ein-/Ausklappen und Ordnen; leere Status-Gruppen (in Status nicht ausgeblendet, `flattenGroups(hideEmpty)` nur Project/Directory) beim Ordnen, in `groupNeighbour` und `collapseAll`; leere Gruppe `interactive` wird herausgefiltert.
- Modus `none` (flache Liste, Gruppe `all`) bleibt außen vor, weil er keine Gruppen hat.
- `macc/45` liegt hinter `origin/main` (u. a. `eb2c0ae`, `334b8d4`): zuerst `origin/main` hineinmergen, Konflikte zugunsten von main lösen, außer sie betreffen #49, weil main neuere Fixes trägt.
- Speicherformat und -key bleiben, kein Migrationscode, weil gespeicherte Prefs von Hape erhalten bleiben müssen.
- Testmuster: `test/railPreferences.test.ts`, `test/RailNav.test.tsx` (Vitest + Testing Library).

## Done means

| ID   | Bedingung                                                                                                                                                          | Nachweis                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Einzelklick auf einen Gruppenkopf klappt die Gruppe in Project, Status und Directory auf/zu                                                                        | Komponententest parametrisiert über die drei Modi                                                                                       |
| AC-2 | Gruppen lassen sich in allen drei Modi per Drag & Drop, Menü „Move up/down" und Tastatur umordnen; leere Status-Gruppen und „Completed … N more" brechen das nicht | Hook-/Komponententest je Modus inkl. leerer Gruppe                                                                                      |
| AC-3 | Gruppe und Agent lassen sich in allen drei Modi als Favorit markieren; Favoriten-Gruppen stehen oben, Favoriten-Agents im Abschnitt „Favorites"                    | Test je Modus                                                                                                                           |
| AC-4 | „Alle ein-/ausklappen" (Header-Buttons und Palette `groups.collapse`/`groups.expand`) wirkt in allen drei Modi                                                     | `test/RailNav.test.tsx` parametrisiert über die drei Modi                                                                               |
| AC-5 | Eingeklappt-Zustand und Reihenfolge sind je Modus getrennt: Änderung in einem Modus lässt die anderen unverändert, alles bleibt nach Reload erhalten               | `test/railPreferences.test.ts`: Änderung in Modus A, Prefs von B/C gleich, neuer Hook (`load` aus localStorage) liefert denselben Stand |
| AC-6 | Bestehendes Verhalten bleibt: alle Tests grün, Build läuft                                                                                                         | Ausgabe `bun run test` und `bun run build` im PR                                                                                        |
| AC-7 | Im laufenden Dashboard funktionieren die vier Funktionen sichtbar in allen drei Modi                                                                               | Screenshot oder kurze Klick-Notiz je Modus im PR (Playwright oder manuell)                                                              |

Stopp nur, wenn eine Funktion in einem Modus fachlich keinen Sinn ergibt; dann Rückfrage statt Sonderlösung.

## Ambition

- Altitude: keine – der Auftrag ist schon die Verallgemeinerung von #46–#49.
- Depth: echte Modus-Matrix statt Einzeltests: ein `describe.each(['project','state','directory'])` über dieselben Fälle, damit ein künftiger Modus automatisch mitgeprüft wird.
- Crew: tut, was ein Accessibility-Prüfer tut: Tastaturweg (Tab, Enter, Space, Reorder-Shortcuts) in allen drei Modi prüfen.

## Prüfung

langlebig · unabhängig · tägliches Arbeitswerkzeug mit persistentem Nutzerzustand, auf dem weitere Leisten-Features aufbauen.

## First on approval

Worktree auf `macc/45`, `origin/main` mergen, `test/RailNav.test.tsx` über `['project','state','directory']` parametrisieren und laufen lassen, um die echten Lücken zu sehen.

## Annahmen

- Favoriten-**Agents** gelten modusübergreifend (ein Agent ist Favorit, egal in welcher Ansicht); Favoriten-**Gruppen** sind faktisch je Modus getrennt, weil die Keys verschieden sind (`project:…`, `dir:…`, Status-Keys). „Zustand pro Modus" meint Einklappen und Reihenfolge. (vorgeschlagen)
- Status-Gruppen dürfen wie andere Gruppen geordnet und favorisiert werden, keine feste Status-Reihenfolge. (vorgeschlagen)
- Briefing liegt wie die Geschwister-Briefings untracked unter `briefings/` im Haupt-Checkout; Code-Arbeit erst nach `mw:build` im Worktree. (vorgeschlagen)
