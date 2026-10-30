# Briefing: Agent-Cards – Herkunft filtern, Issue-/PR-Pills, Details überlagern, Felder einstellbar

Quelle: Issue https://github.com/hpmartini/DevHub/issues/159 (Diktat von Hape, Screenshot im Issue).

## The Job

Hape erkennt im Agent-Panel (`/agents`, Rail links) auf einen Blick, welche Agents er selbst gestartet hat und welche der mw-Board-Workflow aus einem GitHub-Issue erzeugt hat, und blendet eine der beiden Sorten per Filter aus. Workflow-Agents tragen keinen technischen Präfix mehr im Namen: aus `MACC DevHub#159 Darstellung Project-/Agent-Panel` wird der Titel `Darstellung Project-/Agent-Panel`, die Issue-Nummer `#159` steht als Pill links unter dem Status-Glyph (dort, wo heute der Ausklapp-Pfeil sitzt), darunter die PR-Pill, sobald es zum Issue einen PR gibt. Der Projektname erscheint als Pill nur in den Gruppierungen Status, Directory und None (und in Favoriten), weil die Project-Gruppierung ihn schon im Gruppenkopf zeigt. Lokal gestartete Agents behalten ihre Detailzeile mit allen verknüpften Issues und PRs. Aufklappende Details überlagern die Cards darunter, statt sie zu verschieben. In den Agent-Settings legt Hape fest, welche Detail-Elemente in welchem Feld der Card stehen.

## Why

DevOrbit ist Hapes ADE (siehe `docs/VISION.md`); das Agent-Panel ist die Leitstelle für Dutzende parallele Agents (Screenshot: 72). Seit mw board Issues automatisch abholt, beginnen die meisten Namen mit `MACC DevHub#…`, die Titel werden abgeschnitten und das Panel ist schwer zu scannen. Ziel dahinter: schneller entscheiden, welchem Agent Hape sich als Nächstes widmet, und das Panel springt beim Hovern nicht mehr.

## Guardrails

- Betroffen: `components/AgentsView/AgentList.tsx` (Card-Rendering), `SessionLinks.tsx` (Pills), `AgentSettingsPanel.tsx`, `AgentsView.tsx` (Filter-State, Board-Daten), `utils/agentSessions.ts` (Quick-Filter, `cardDetailsVisible`), `server/schemas/` (`agentViewSettingsSchema`), `types.ts`. Folge den bestehenden Mustern: Quick-Filter-Chips (`QUICK_FILTERS`, `applyQuickFilters`), `IssuePill` mit `onOpenIssue` (öffnet das Issue-Modal, soll so bleiben), Settings über `AgentViewSettings`.
- Erkennung „vom Workflow erzeugt“: Namenspräfix aus mw board (`MACC <repo>#<nr> `, definiert in `example-workflow-plugin/plugins/mw/core/mw/board.py:103`) oder Link `via: 'mw-board'` aus `deriveAgentLinks` (`utils/board.ts`). Das mw-Plugin selbst bleibt unverändert, weil andere Werkzeuge den Präfix lesen (`board.py:115` zählt laufende Sessions darüber).
- Der Sessionname wird nur in der Anzeige gekürzt, nie umbenannt: `claude agents`, Suche und mw board arbeiten mit dem echten Namen. Suche findet weiter auch `#159` und `MACC`.
- Bestehende Settings-Werte (`cardDetails`, `cardDensity`, `grouping`) müssen ohne Migration weiter gelten; neue Felder sind optional mit Default = heutiges Layout plus die neuen Pills.
- Overlay muss Tastaturnavigation, Fokus-Ring und `prefers-reduced-motion` respektieren und darf nicht über den Rail-Rand oder die Bottom-Leiste („Remote-Agents“) hinaus abgeschnitten werden.
- Out of scope: Änderungen an Board-View, Workflow-View, mw-Plugin, Agent-Namensvergabe; neue Datenquellen außer den vorhandenen Board-Daten.
- Höchstens 3 Subagenten.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                                                                           | Nachweis                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Herkunftsfilter: zwei Chips „Lokal“ und „Workflow“ in der Quick-Filter-Leiste mit Zählern; keiner oder beide aktiv = alle, einer aktiv = nur diese Sorte; kombiniert mit Status- und Attribut-Chips nach bestehender Logik.                                                         | Unit-Test in `test/agentSessions.test.ts` für `matchesQuickFilter`/`applyQuickFilters` mit Workflow- (Präfix und mw-board-Link) und lokalen Sessions; `bun run test:run` grün.              |
| AC-2 | Workflow-Agents zeigen den Titel ohne `MACC <repo>#<nr> `; ohne Präfix bleibt der Name unverändert; Tooltip/`title` zeigt den vollen Namen.                                                                                                                                         | Unit-Test für eine reine Funktion (z. B. `parseWorkflowName`) inkl. Randfälle (kein Titel nach Präfix, Repo mit Bindestrich, fremder Präfix).                                               |
| AC-3 | Issue-Pill `#<nr>` steht links unter dem Status-Glyph statt des Ausklapp-Pfeils; Klick öffnet wie heute das Issue-Modal. Gibt es einen PR zum Issue, steht die PR-Pill darunter (Farbe nach PR-Status wie `prLabel`).                                                               | Komponententest (Testing Library) rendert eine Workflow-Session mit Board-Link und PR: Pill-Reihenfolge und Klick-Callback geprüft; plus Screenshot im PR.                                  |
| AC-4 | Projektname als Pill nur in Gruppierung Status, Directory, None und in Favoriten; in Project-Gruppierung nicht.                                                                                                                                                                     | Komponententest über die vier Gruppierungen.                                                                                                                                                |
| AC-5 | Lokale Agents zeigen beim Hovern/Aufklappen weiterhin alle verknüpften Issues und PRs (`SessionLinks`).                                                                                                                                                                             | Bestehende Tests bleiben grün; ein Test für lokale Session mit 2 Issues und 2 PRs.                                                                                                          |
| AC-6 | Aufgeklappte Details überlagern die folgenden Cards: Position der nächsten Card ändert sich beim Hover nicht.                                                                                                                                                                       | Playwright-Messung im laufenden Dev-Server: `getBoundingClientRect().top` der Folge-Card vor und nach Hover identisch (Differenz 0 px); Screenshot im PR.                                   |
| AC-7 | Settings: pro Detail-Element (mind. Repo/Branch, Git-Status, Cache/Kontext, Status-Text, Issue-Pill, PR-Pill, Projekt-Pill, Server, Sub-Agents) wählbar, in welchem Feld es erscheint (z. B. Zeile 2, Zeile 3, linke Spalte, Details, aus); Wahl wirkt sofort und übersteht Reload. | Schema-Test in `test/agentCardSettings.test.ts` (gültig/ungültig, alte Settings ohne neues Feld gültig); Komponententest: Element in „aus“ verschwindet, in anderem Feld erscheint es dort. |
| AC-8 | Nichts sonst kaputt.                                                                                                                                                                                                                                                                | `bun run test:run`, `bun run lint`, `bunx tsc --noEmit`, `bun run build` grün; Ausgabe im PR.                                                                                               |

Stopp-Regel: weiterarbeiten, außer ein Kriterium ist ohne Entscheidung Hapes nicht erfüllbar; dann als offen mit Grund melden. Rückmeldung: PR mit `## Review-Anleitung` und `## Nachweise` (eine Zeile je AC).

## Ambition

- Altitude: Der Workflow könnte Sessions künftig mit sauberem Titel und Metadaten (Issue-URL) anlegen statt mit Präfix im Namen; das wäre eine Änderung am mw-Plugin und braucht eigene Freigabe.
- Depth: Arbeitet mit echten Daten aus `claude agents --json` und dem MACC-Board; Ziel: Card-Höhe im Ruhezustand nicht größer als heute, kein Layout-Shift beim Hover (0 px).
- Crew: tut, was ein Accessibility-Prüfer tut (Overlay per Tastatur erreichbar und schließbar, Pills mit Namen für Screenreader, Kontrast der Pills ≥ 4.5:1); tut, was ein UX-Designer tut (Settings-Feldzuordnung mit Vorschau statt reiner Dropdown-Liste prüfen).

## Prüfung

langlebig · selbst · Kernansicht der ADE mit Dauernutzung, aber reine UI ohne Vertrauensgrenze und ohne Nutzung durch andere Systeme.

## First on approval

Reine Funktionen für Workflow-Erkennung und Namenskürzung in `utils/agentSessions.ts` mit Tests anlegen (AC-1, AC-2), dann die Card umbauen.

## Annahmen

- „MAC“ im Diktat = Präfix `MACC`, „Purikfest“ = Pull Request, „PIL“ = Pill. (vorgeschlagen)
- Herkunftsfilter als zwei Chips im bestehenden Quick-Filter-Stil, untereinander ODER-verknüpft wie die Status-Chips. (vorgeschlagen)
- Workflow = Namenspräfix `MACC ` **oder** mw-board-Link; alles andere = lokal. (vorgeschlagen)
- Der Ausklapp-Pfeil entfällt bei allen Cards; Anheften der Details bleibt per Kontextmenü-Eintrag und Tastatur (bestehender Toggle `onToggleExpanded`). Bei lokalen Agents ohne Issue steht links nur der Glyph, bei lokalen mit PR die PR-Pill. (vorgeschlagen)
- Hat ein Workflow-Agent zusätzlich weitere Issues/PRs, zeigen die Details sie wie bei lokalen Agents. (vorgeschlagen)
- Overlay heißt: Details legen sich mit Schatten über die nächsten Cards (absolut positioniert, z-index), die Card selbst behält im Ruhezustand ihre Höhe; Scrollen der Liste bleibt möglich. (vorgeschlagen)
- Feld-Zuordnung in den Settings: feste Felder der Card (linke Spalte, Zeile 1 rechts, Zeile 2, Zeile 3, Details, aus), pro Element ein Feld; Default reproduziert das neue Standard-Layout. Freie Reihenfolge innerhalb eines Feldes ist nicht Teil des Auftrags. (vorgeschlagen)
