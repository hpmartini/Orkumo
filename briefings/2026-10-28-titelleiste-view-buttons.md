# Briefing: View-Buttons für Workflow, Board und VS Code in der Titelleiste

Quelle: https://github.com/hpmartini/DevHub/issues/144 (Autor hpmartini)

## The Job

Hape schaltet die drei Arbeitsmodi **Workflow** (`/workflows`), **Board** (`/board`) und **Code** (VS Code, `/code`) mit je einem Button rechts oben in der Titelleiste (`components/TitleBar.tsx`) an und aus, sieht am hervorgehobenen Button, welcher Modus offen ist, und kehrt per Klick auf den aktiven Button zu den Agent-Tabs (`/agents`) zurück. Das Öffnen eines Agents (Attach aus Rail/Liste, bestehender Weg `onOpenView` in `components/AgentsView/AgentsView.tsx`) schließt den Modus weiterhin, und danach ist kein Button mehr hervorgehoben.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`): Modi teilen eine Shell. Heute erreicht man Board und Code nur über Kontextmenüs, Command Palette oder Deep-Links, Workflows über ein kleines Icon im Rail; zurück geht es über den „Close“-Button im Agents-Header (Screenshot im Issue). Ziel ist ein Modus-Wechsel mit einem Klick und ein Blick auf den Zustand, wie die Activity-Bar in VS Code.

## Guardrails

- Die Route bleibt die einzige Quelle der Wahrheit für den aktiven Modus (`activeTab` in `App.tsx`), kein zweiter State, weil die Route je Kontext gespeichert wird (`ROUTE_KEY`, Commit 159425f).
- Buttons im Stil der bestehenden Pane-Controls (Terminal/Browser) in `TitleBar.tsx`: lucide-Icons (`Workflow`, `Kanban`, `Code2` o.ä.), aktiv `bg-gray-700 text-white`, `WebkitAppRegion: 'no-drag'`, `title` + `aria-label` + `aria-pressed`, `focus-visible`-Outline wie der Rocket-Button. Die freie Fläche der Titelleiste bleibt `drag`, damit das Electron-Fenster verschiebbar bleibt.
- Pane-Controls bleiben unverändert (nur im Coding-View sichtbar); die neuen Buttons stehen auf jeder Route.
- Nicht anfassen, weil andere Einstiege davon abhängen: `BoardView`, `WorkflowView`, `CodeView`, Kontextmenü-Einträge „Open in Code/Show on Board/Show Workflow“ samt Deep-Link-Parametern, Command-Palette-Einträge, Workflows-Icon im Rail.

## Done means

| ID   | Bedingung                                                                                                                                                         | Nachweis                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AC-1 | Titelleiste zeigt auf jeder Route rechts drei Buttons Workflows, Board, Code mit `aria-label`                                                                     | Vitest (RTL) rendert die Titelleiste bzw. App-Routing und findet die drei Buttons per Rolle/Label              |
| AC-2 | Klick auf inaktiven Button navigiert zu `/workflows`, `/board` bzw. `/code`                                                                                       | Vitest: Klick → Location-Pfad geprüft, je Button                                                               |
| AC-3 | Button der offenen View hat `aria-pressed="true"` und Highlight-Klasse, die anderen `false`; auf `/agents` und bei Deep-Link (`/board?repo=…`) stimmt der Zustand | Vitest über Routen inkl. Query                                                                                 |
| AC-4 | Klick auf aktiven Button navigiert zu `/agents`                                                                                                                   | Vitest                                                                                                         |
| AC-5 | Attach eines Agents aus einer offenen View führt zu `/agents`, danach kein Button aktiv                                                                           | Vitest (bestehender `onOpenView`-Pfad) oder Browser-Prüfung mit Screenshot, falls Attach im Test nicht mockbar |
| AC-6 | Bestehendes bleibt grün: Routing-Tests, Build, Lint                                                                                                               | `bun run test:run`, `bun run build`, `bun run lint` Ausgaben im PR                                             |
| AC-7 | Sichtbarer Zustand im laufenden UI                                                                                                                                | Screenshot der Titelleiste mit aktivem Board-Button (Dev-Server, Browser) im PR                                |

## Ambition

- Altitude: Die Titelleiste als Activity-Bar für alle Modi (auch Dashboard, Agents) wäre der größere Schritt; nur vorgeschlagen, nicht Scope.
- Depth: Tastatur zählt mit: Buttons per Tab erreichbar, `aria-pressed` für Screenreader; Shortcut-Hinweis im `title`, falls die Command Palette schon Shortcuts für die Modi kennt.
- Crew: tut, was ein Accessibility-Prüfer tut: Fokus-Reihenfolge und Kontrast des Highlights im dunklen Theme prüfen.

## Prüfung

langlebig · unabhängig · Titelleiste ist die zentrale Shell-Navigation aller Modi und wird dauerhaft gepflegt.

## First on approval

`components/TitleBar.tsx` und den `TitleBar`-Aufruf in `App.tsx` (um Zeile 390) lesen, dann den Test für AC-1 bis AC-4 schreiben, der heute rot ist.

## Annahmen

- Button öffnet die blanke Route (`/board`, `/workflows`, `/code`) ohne Query; die Views fallen auf ihre gemerkte Auswahl zurück. (vorgeschlagen)
- Der „Close“-Button im Agents-Header bleibt, weil er auch Dashboard und App-Details schließt, die keinen Titelleisten-Button bekommen. (vorgeschlagen)
- Wechsel zwischen zwei Modi (Board aktiv, Klick auf Code) öffnet direkt Code, ohne Umweg über `/agents`. (vorgeschlagen)
- Labels englisch wie die übrige UI: „Workflows“, „Board“, „Code (VS Code)“. (vorgeschlagen)
- Reihenfolge von links: Workflows, Board, Code; rechts neben den Pane-Controls. (vorgeschlagen)
