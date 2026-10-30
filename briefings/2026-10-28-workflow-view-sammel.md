# Briefing: Workflow-View vereinfachen – Sammel-Issue #134

## The Job

Im Modus **Workflows** (`/workflows`, `components/WorkflowView/`) ist die Arbeit mit den Issue-Karten im Stations-Popover (Klick auf eine Station wie „GO", „mw:go") schneller und übersichtlicher:

1. **Ganze Karte klickbar:** Klick irgendwo auf eine `WorkflowCard` klappt die Details auf/zu. Der separate „Details/Weniger"-Knopf entfällt oder bleibt nur als Chevron-Hinweis. Klicks auf GO-Knopf, Links und Buttons in den Details lösen kein Umschalten aus. Tastatur: Karte fokussierbar, Enter/Space toggeln, `aria-expanded` bleibt.
2. **Stats auch aufgeklappt:** Die Infos aus dem Hover-Overlay (Stufe + seit wann, Agent/Session-Zustand, Run + Schritte, Zugewiesen, Labels) stehen in der aufgeklappten Karte (`WorkflowDetails`) oben, weil das Overlay bei `expanded` ausgeblendet ist.
3. **Rückmeldung bei „Code":** Ab Klick zeigt der Code-Knopf einen Lade-Spinner (Knopf deaktiviert), bis navigiert wird; der Code-Modus zeigt bis zum fertigen Laden von VS Code (Web-IDE) einen sichtbaren Ladezustand statt leerer Fläche.
4. **Alle ein-/ausklappen:** Im Popover-Header (neben Titel und Zähler, vor dem ×) je ein Icon-Button „Alle ausklappen" und „Alle einklappen" für die Karten dieser Station.
5. **Grid statt Liste:** Die Karten im Popover stehen in einem responsiven Grid (mehrere Spalten, so breit wie der Platz hergibt; schmal = eine Spalte). Das Popover darf dafür breiter werden.
6. **Projektfilter:** Im Workflows-Header lässt sich auf ein oder mehrere Projekte (Repo) filtern; Auswahl aus den Repos der aktuellen Karten. Wirkt auf Graph-Zähler und Popover. Der vorhandene `?repo=`-URL-Parameter (`scopeWorkflowCards`) bleibt kompatibel.

## Why

Hape steuert seine Issues über mw board und nutzt `/workflows` als Leitstand (Leitbild `docs/VISION.md`: Kontext Issue ↔ Agent ↔ Worktree ↔ PR ↔ Code). Bei 10+ Issues pro Station ist die lange Einspalten-Liste mit Extra-Klicks zäh, und der Sprung in den Code fühlt sich ohne Rückmeldung kaputt an. Ziel: Station öffnen, alles auf einen Blick sehen, mit einem Klick tiefer oder in Code/Agent springen.

## Guardrails

- Nur `components/WorkflowView/*` und, für den IDE-Ladezustand, `components/CodingView/WebIDEPanel.tsx` bzw. `components/CodeView/` ändern; Server/Stufen-Ableitung bleiben unverändert, weil das reine UI-Wünsche sind.
- Vorhandene Muster nutzen: `motion`/`AnimatePresence` wie in `WorkflowCard`, Tailwind-Tokens (gray-750/850/950, `bg-sel`), `lucide-react`-Icons, Popover-Header-Stil wie bestehend. Keine neuen Dependencies.
- Hover-Overlay darf bleiben; Stats-Darstellung als eine gemeinsame Komponente für Overlay und Details statt Duplikat.
- Projektfilter wie die bestehenden Radiogroups im Header gestalten (oder kleines Dropdown bei vielen Repos); Auswahl im URL-Parameter oder `localStorage`, damit sie Reload übersteht.
- Out of scope: Stufenlogik, GO-Mechanik, Board-Modus, Graph-Layout.

## Done means

| ID   | Bedingung                                                                                                                                                           | Nachweis                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AC-1 | Klick irgendwo auf eine Workflow-Karte klappt Details auf/zu; Enter/Space auf der fokussierten Karte ebenso, `aria-expanded` stimmt                                 | Komponententest (vitest + Testing Library) und Playwright-Screenshot vorher/nachher                            |
| AC-2 | Klick auf GO, Agent, Issue, Code oder Dokument-Link in der Karte toggelt nicht                                                                                      | Komponententest: Klick auf innere Buttons lässt `onToggle` unaufgerufen                                        |
| AC-3 | Aufgeklappte Karte zeigt oben Stufe + seit wann, Agent/Session-Zustand, Run + Schritte, Zugewiesen, Labels (eine gemeinsame Komponente mit dem Hover-Overlay)       | Komponententest auf die Felder + Playwright-Screenshot einer aufgeklappten Karte                               |
| AC-4 | Nach Klick auf „Code" zeigt der Knopf sofort einen Spinner und ist deaktiviert bis zur Navigation; der Code-Modus zeigt bis zum Laden von VS Code einen Ladezustand | Komponententest (Spinner während offenem Promise) + Playwright-Screenshot des Ladezustands                     |
| AC-5 | Popover-Header hat Buttons „Alle ausklappen" und „Alle einklappen", die genau die Karten dieser Station umschalten                                                  | Komponententest oder Playwright: nach Klick alle `aria-expanded=true` bzw. `false`                             |
| AC-6 | Karten im Popover stehen im responsiven Grid (≥2 Spalten bei ausreichender Breite, 1 Spalte schmal)                                                                 | Playwright-Screenshots bei 1600 px und 900 px Viewport-Breite                                                  |
| AC-7 | Projektfilter (Mehrfachauswahl, Repos der aktuellen Karten) im Workflows-Header filtert Graph-Zähler und Popover, übersteht Reload; `?repo=` funktioniert weiter    | Unit-Test der Filterfunktion + Playwright: Filter setzen, Reload, Zähler geändert                              |
| AC-8 | Keine Regression: Tests, Lint, Build grün; Board-, Agents-, Code-Modus laden                                                                                        | `bun run test`, `bun run lint`, `bun run build` Ausgabe; Playwright-Aufruf der drei Routen ohne Konsolenfehler |

Weiterarbeiten, außer bei fehlenden GitHub-Rechten. PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/134`, `## Review-Anleitung`, `## Nachweise` (eine Zeile je AC). Rückmeldung: kurze Bullets – was gebaut, wo, Annahmen, offene Punkte.

## Ambition

- Altitude: Statt Popover eine eigene Listen-/Grid-Ansicht aller Issues mit Stationsfilter (nur Vorschlag, eigene Freigabe nötig).
- Depth: Interaktion messen statt schätzen: Spinner erscheint < 100 ms nach Klick; Grid ohne horizontales Scrollen bis 900 px Breite.
- Crew: tut, was eine Accessibility-Prüferin tut: klickbare Karte ohne verschachtelte interaktive Rollen, Fokusreihenfolge und Tastaturbedienung prüfen.

## Prüfung

langlebig · selbst · Reine UI-Änderung ohne Vertrauensgrenzen in einem Kernmodus, Regressionen deckt AC-8 ab.

## First on approval

`WorkflowCard` auf Karten-Klick mit Ereignis-Ausnahme für innere Buttons umbauen und die Stats-Komponente herausziehen; Grid und Header-Buttons im Popover von `WorkflowView` bauen darauf auf.

## Annahmen

- „Header" in Punkt 4 = Kopf des Stations-Popovers (Screenshot zeigt „mw:go 10 ×"), nicht der Seiten-Header. (vorgeschlagen)
- „Stats" in Punkt 2 = Felder des Hover-Overlays. (vorgeschlagen)
- Spinner deckt beide Wartephasen ab (Ordner-Auflösung in `openCode` und Laden der Web-IDE im Code-Modus). (vorgeschlagen)
- Projektfilter ist Mehrfachauswahl; „alle" ist Standard. (vorgeschlagen)
