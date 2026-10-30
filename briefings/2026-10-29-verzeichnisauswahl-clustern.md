# Briefing: Verzeichnisauswahl für neue Agents geclustert und lesbar (Issue #158)

## The Job

Hape findet im `DirectoryPicker` des Agents-View (`/agents`, Ordner-Button im Composer/„New task“) das Zielverzeichnis für einen neuen Agent mit einem Blick: Der Picker gruppiert die Verzeichnisse nach übergeordnetem Verzeichnis (Überschrift = Elternpfad, Home als `~`), sortiert Gruppen und Einträge vorhersagbar, zeigt jeden Ordner genau einmal, auch wenn er über verschiedene Schreibweisen (`~/projects/X` vs. `~/PROJECTS/X`) aus mehreren Quellen kommt, und hält jeden Eintrag auf einer Zeile, mit sauber abgeschnittenem Text und vollem Pfad im Tooltip.

## Why

Hape startet aus DevOrbit laufend Agents in vielen Repos und Worktrees. Die heutige Liste (Screenshots im Issue) ist flach nach Name sortiert, mischt `~/PROJECTS`, `~/projects`, `~/WEBSITES`, Google-Drive-Ordner und Worktrees, zeigt Duplikate (ClipSync, DC-Example-Training-Courseware) und bricht lange Namen auf zwei Zeilen um, während der Pfad mittendrin abgeschnitten wird. Schnelles, sicheres Wählen des Verzeichnisses ist Voraussetzung, dass Agents im richtigen Repo landen.

## Guardrails

- Code: `DirectoryPicker` und `directoryChoices` in `components/AgentsView/AgentsView.tsx` (~Z. 438, ~Z. 2199). Gruppier-, Sortier- und Dedupe-Logik als reine Funktion in neuem `utils/directoryGroups.ts` mit Vitest-Test (Muster `utils/agentSessions.ts`), damit sie ohne Browser prüfbar ist.
- Bestehendes Verhalten bleibt: Suche über Name + Pfad, Enter wählt den ersten sichtbaren Treffer, Escape schließt nur den Picker, „Use path“-Feld, `z-[95]` (Fix aus #132). Leere Gruppen verschwinden beim Filtern.
- Vorhandene Tailwind-Klassen und Farben des Pickers, keine neue Abhängigkeit.
- Out of scope: Pfeiltasten-Navigation, einklappbare Gruppen, Favoriten im Picker; Änderungen am Server-Endpunkt `/api/agents/repos` nur, falls das Dedupe dort sauberer lösbar ist.

## Done means

| ID   | Bedingung                                                                                                                                                                | Nachweis                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| AC-1 | Verzeichnisse erscheinen gruppiert nach Elternverzeichnis mit Überschrift (Home als `~`); Worktrees unter `<repo>/.claude/worktrees/` stehen in der Gruppe ihres Repos   | Vitest für `utils/directoryGroups.ts` mit Fixture aus den Issue-Screenshots                                     |
| AC-2 | Reihenfolge: „~ (home)“ und das aktuell gewählte Verzeichnis oben, danach Gruppen und Einträge case-insensitiv alphabetisch                                              | Vitest                                                                                                          |
| AC-3 | Pfade, die sich nur in Groß-/Kleinschreibung unterscheiden, erscheinen einmal; Quell-Badges (`repo`, `app`, `session`, `configured`) des Eintrags werden zusammengeführt | Vitest                                                                                                          |
| AC-4 | Suche filtert über Name + Pfad, leere Gruppen fehlen; Enter und Klick setzen das Ziel wie bisher                                                                         | Vitest für Filter; Playwright: Suche `dev` + Enter setzt Ziel im Composer                                       |
| AC-5 | Jeder Eintrag ist einzeilig (kein Umbruch bei langen Namen/Pfaden), abgeschnittener Text endet mit `…`, `title` trägt den vollen Pfad                                    | Playwright-Screenshots ungefiltert und mit Suche `dev` im PR; Playwright-Check, dass jede Zeile gleich hoch ist |
| AC-6 | Keine Regression                                                                                                                                                         | `bun run test:run` und `bun run build` grün                                                                     |

## Ambition

- Altitude: Der Picker könnte die zuletzt genutzten Verzeichnisse als eigene Gruppe „Zuletzt“ oben zeigen; nur Vorschlag, eigene Freigabe nötig.
- Depth: echte Daten aus `/api/agents/repos` plus `apps`/`sessions` von Hapes Rechner als Fixture; Ziel: jedes Verzeichnis aus den Screenshots in ≤ 3 Tastendrücken per Suche erreichbar, null Duplikate.
- Crew: tut, was eine UX-Prüferin tut: Picker bei 1280 px und schmalem Fenster (≤ 600 px) gegenprüfen, Kontrast der Gruppenüberschriften lesbar halten.

## Prüfung

langlebig · unabhängig · Produktcode im täglich genutzten Agents-View, der auf `main` bleibt.

## First on approval

Worktree von `origin/main` anlegen und `utils/directoryGroups.ts` samt Test mit den Fällen aus den Issue-Screenshots als Fixture schreiben.

## Annahmen

- Gruppe = direktes Elternverzeichnis; Worktrees zählen zur Gruppe ihres Repos (vorgeschlagen)
- Dedupe case-insensitiv, weil der Server auf macOS (case-insensitives Dateisystem) läuft; behalten wird die Schreibweise, die real auf der Platte existiert, sonst die aus `repos` (vorgeschlagen)
- Zeile zeigt den Namen; der relative Pfadrest erscheint nur, wenn er vom Namen abweicht (z. B. `demonews-monorepo` → `DemoNews`), Badge rechts dezent (vorgeschlagen)
- „~ (home)“ und das aktuelle Verzeichnis stehen als eigene Gruppe ganz oben (vorgeschlagen)
