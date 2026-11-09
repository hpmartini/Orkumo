# Briefing: Agents-Panel Highlights korrigieren (#210)

## The Job
Die Agent-Cards in der Rail (`components/AgentsView/AgentList.tsx`) zeigen drei Zustände in drei klar unterscheidbaren Stufen:

1. **Offen** (die Session, die gerade im Workspace angezeigt wird, `isActive` = `activeSessionId === session.id`): stärkstes Highlight.
2. **Nur attached** (in einem Tab offen, aber nicht angezeigt, `isOpen && !isActive`): mittelstarkes Highlight. Heute praktisch unsichtbar, nur das kleine Terminal-Icon.
3. **Nur angeklickt** (per Mausklick ausgewählt, weder offen noch attached): kein Highlight, sieht aus wie eine normale Card.

Screenshot aus dem Issue (Daten, Ist-Zustand): `briefings/assets/210/image-1.png`. Dort tragen die offene Card oben und die nur angeklickte Card unten beide einen hellen Rahmen, die attached Card `mail-view-gmail-parity` gar keinen; genau diese Gewichtung kehrt sich um.

## Why
Hape arbeitet mit vielen parallelen Agents und muss mit einem Blick sehen, welcher gerade vorne liegt und welche schon in Tabs hängen. Der Klick-Rahmen konkurriert heute mit dem Offen-Rahmen und lenkt ab; der Auswahlzustand ist für ihn kein relevanter Status.

## Guardrails
- Scope: Session-Cards in `AgentList.tsx` (Klassen um Zeile 910-925: `isActive`-Outline, `selectedClass(railFocused)`, `isPeeking`-/`cacheWarning`-Ring). Gruppen-Header, Branch-Zeilen und `RemoteAgents.tsx` nutzen `selectedClass` ebenfalls; die bleiben unverändert, weil das Issue nur Agent-Cards nennt.
- Die Unterscheidung Klick vs. Tastatur existiert schon (`clickedId`, `selectedBy: 'click' | 'keyboard'`, #181); darauf aufbauen statt neuem State.
- Farben aus den vorhandenen Tokens (`sel`, `cursor` in `index.html`, Tailwind-Blau wie bisher), keine neuen Tokens nötig.
- Peek-Ring und Cache-Warnung (`ring-amber-400/70`) bleiben erkennbar und dürfen nicht mit der Attached-Stufe verwechselbar sein.
- `aria-selected`/`aria-current` bleiben semantisch korrekt; nur die Optik ändert sich.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Offene Card (im Workspace angezeigt, `activeSessionId`) trägt die stärkste Highlight-Stufe | Test in `test/AgentList.test.tsx`, gerendert über `AgentList` mit `activeSessionId` |
| AC-2 | Nur attached Card (`openIds` enthält sie, nicht aktiv) trägt eine mittlere Stufe, sichtbar schwächer als AC-1 und ungleich Peek-/Cache-Ring | Test wie AC-1 mit `openIds`; Klassen unterscheiden sich von AC-1, Peek und Cache-Warnung |
| AC-3 | Per Mausklick ausgewählte Card, weder offen noch attached, trägt keine Highlight-Klassen (kein `bg-sel`, kein `ring-cursor`, kein Outline), bei fokussierter und unfokussierter Rail | Test: `click` auf die Card, dann Klassen prüfen, beide Fokuszustände |
| AC-4 | Per Tastatur (Pfeiltaste) bewegte Auswahl zeigt einen sichtbaren Fokus-Indikator | Test: Pfeiltaste in der Rail, Klasse auf der Zielcard |
| AC-5 | Offene bzw. attached Card, die zusätzlich angeklickt ist, zeigt ihre Stufe unverändert | Test: Klick auf offene und attached Card, Klassen gleich AC-1 bzw. AC-2 |
| AC-6 | Gruppen-Header, Branch-Zeilen und `RemoteAgents` behalten `selectedClass` unverändert; bestehende Tests grün | `bunx vitest run` komplett grün, `bunx tsc --noEmit` ohne neue Fehler |
| AC-7 | In der laufenden App sind offene, attached und angeklickte Card nebeneinander als drei Stufen erkennbar | Screenshot der Rail im PR unter `## Screenshots` |

Stopp-Regel: durcharbeiten; nur stoppen, wenn die Klick/Tastatur-Unterscheidung aus #181 nicht trägt und neuer State nötig wäre. Rückmeldung: kurzer Bericht mit Screenshot und Annahmen.

## Ambition
- Altitude: keine
- Depth: Kontrast der drei Stufen gegen den Card-Hintergrund `bg-gray-850` prüfen; Rahmen der offenen Card ≥ 3:1 (WCAG 1.4.11 Nicht-Text-Kontrast), attached sichtbar, aber schwächer
- Crew: tut, was eine Accessibility-Prüferin tut: Tastaturnavigation durch die Rail ohne Maus, Fokus jederzeit sichtbar

## Prüfung
wegwerf · selbst · reine CSS-Klassen-Logik einer Komponente, kein Vertrauensgrenzen-Code, leicht rückbaubar.

## First on approval
In `AgentList.tsx` die Klassenlogik der Session-Card (um `isActive ? 'outline …'` / `selectedClass`) lesen und einen fehlschlagenden Test für "angeklickte Card ohne Highlight" schreiben.

## Annahmen
- Eine per **Tastatur** bewegte Auswahl behält einen dezenten Fokus-Indikator (dünner `ring-cursor`), weil sonst die Tastaturnavigation blind wird (Barrierefreiheit). Nur die Klick-Auswahl entfällt optisch. (vorgeschlagen)
- Ist eine Card offen oder attached und zugleich angeklickt, zeigt sie die Stufe offen bzw. attached, die Auswahl fügt nichts hinzu. (vorgeschlagen)
- Die Abstufung erfolgt über Rahmenstärke plus Hintergrund (offen: kräftiger Outline + getönter Hintergrund wie heute; attached: dünner, gedämpfter Rahmen oder Linksbalken); die genaue Ausprägung entscheidet die Umsetzung, Hauptsache drei Stufen sind ohne Hinsehen auf Icons unterscheidbar. (vorgeschlagen)
- Screenshot genügt, kein GIF, weil keine neue User Journey; `ui: on` vorgeschlagen (vorgeschlagen)
