# Briefing: Pfeiltasten nach Klick auf Gruppen-Chevron (#164)

## The Job

In der Agents-Leiste (`/agents`) bewegen Pfeil ↓/↑ die Auswahl auch dann, wenn der Fokus auf dem Chevron-Button eines Gruppenkopfs liegt (per Klick oder per Tab dorthin). Das gilt in allen drei Gruppierungsmodi (Project, Status, Directory). Ein Rendertest in `test/agentsViewRail.test.tsx` belegt das, er deckt auch den Tab-Weg ab.

## Why

Folge aus #50 / PR #161. Palette `groups.*` sowie Space/Enter/Shift+Pfeil je Modus sind seit `2dbd2c9` getestet. Offen sind laut Issue-Kommentar von hpmartini (Daten) zwei Dinge: der Tab-Weg mit Fokus auf dem Chevron und der Live-Befund „Pfeil ↓/↑ bewegt die Auswahl nach Klick auf den Chevron nicht“. Hape bedient die Leiste mit Maus und Tastatur gemischt. Ein Klick darf die Tastaturnavigation nicht abschalten.

## Guardrails

- Ursache laut Code-Lektüre: Der globale Keydown-Handler in `components/AgentsView/AgentsView.tsx` (ca. Z. 1383) kehrt bei `target.closest('button, a, [role="dialog"], …')` früh zurück, bevor `moveSelection` läuft. Der Chevron in `components/AgentsView/AgentList.tsx` (ca. Z. 632) ist ein `<button>`. Die Ursache vor dem Fix per Test bestätigen.
- Fix an der Wurzel, also an der Ausnahmeregel im Handler. Kein zweiter Keydown-Handler am Button. Space/Enter auf dem fokussierten Chevron bleiben der native Button-Klick, sonst klappt die Gruppe doppelt.
- Pfeiltasten in Tab-Leiste, Menüs (`role="menu"`, `onMenuKeyDown` in `AgentList.tsx`), Dialogen und Popovers behalten ihr eigenes Verhalten. Alt+Pfeil (Gruppe verschieben, Capture-Handler in `AgentList.tsx`) und Shift+Pfeil bleiben unverändert.
- Nach dem Pfeil muss sich die Auswahl sichtbar bewegen, und Space/Enter klappen danach den neu gewählten Kopf (siehe Annahmen).
- Test folgt dem Muster in `test/agentsViewRail.test.tsx` (Hooks gemockt, `describe.each` je Modus). Kein Playwright im Test.
- Out of scope: Umbau der Fokusführung, neue Shortcuts, `ProjectsRail.tsx`.

## Done means

| ID   | Bedingung                                                                                                                                                                 | Nachweis                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | In jedem Modus (Project, Status, Directory) bewegt `ArrowDown`/`ArrowUp` die Auswahl, nachdem ein Klick auf den Chevron eines Gruppenkopfs den Fokus dorthin gebracht hat | Neuer Test in `test/agentsViewRail.test.tsx` rendert das echte `AgentsView` und feuert die Keydown-Events auf den fokussierten Button. Er schlägt auf `origin/main` ohne den Fix fehl: im PR als Ausgabe von Stash bzw. Revert gezeigt |
| AC-2 | Tab-Weg je Modus: Tab bringt den Fokus auf den Chevron, Space und Enter klappen die Gruppe genau einmal (kein Doppel-Toggle), danach bewegt ↓ die Auswahl                 | Gleiche Testdatei, `describe.each` über die drei Modi. Echter Tab-Fokus per `@testing-library/user-event` oder per `.focus()` mit dokumentiertem Grund                                                                                 |
| AC-3 | Pfeiltasten in Menü (`role="menu"`), Tab-Leiste, Dialogen und Popovers behalten ihr Verhalten, ebenso Alt+Pfeil und Shift+Pfeil                                           | Bestehende Tests grün. Mindestens ein Test zeigt: Bei offenem Kontextmenü bewegt ↓ den Menüfokus, nicht die Leisten-Auswahl                                                                                                            |
| AC-4 | Die Codebasis bleibt sauber                                                                                                                                               | `bunx tsc --noEmit` und `bunx vitest run` (ganze Suite) grün, Ausgabe im PR                                                                                                                                                            |
| AC-5 | Ursache benannt                                                                                                                                                           | Ein Satz im PR, der auf die Codezeile verweist und durch AC-1 bestätigt ist                                                                                                                                                            |

Stopp nur, wenn die Ursache eine andere ist und der Fix die Fokusführung umbauen müsste. Dann berichten statt umbauen. Rückmeldung: Ursache, Diff-Umfang, Testausgabe.

## Ambition

- Altitude: keine. Ein generelles Roving-Tabindex-Modell für die Leiste wäre größer und bräuchte eine eigene Freigabe.
- Depth: echte Fokus- und Keyboard-Semantik prüfen (`user-event` statt nur `fireEvent`). Ziel: Jeder Tastenweg aus `ShortcutsHelp` in der Leiste funktioniert unabhängig davon, ob die Maus den Fokus gesetzt hat.
- Crew: tut, was eine Accessibility-Prüferin tut. Fokus bleibt nach Pfeil sichtbar (`focus-visible`), `aria-expanded` am Chevron stimmt nach dem Toggle.

## Prüfung

langlebig · unabhängig · Produktcode im zentralen Tastenhandler von `AgentsView`, den alle Modi nutzen.

## First on approval

Einen fehlschlagenden Test schreiben: Klick auf den Chevron der ersten Gruppe, dann `ArrowDown` auf dem fokussierten Button. Die Auswahl muss sich bewegen.

## Annahmen

- Die Ausnahme gilt für alle Buttons in `[data-focus-zone="rail"]`, auch für den Projekttitel-Button. Den Fokusort nach dem Pfeil wählt die Umsetzung (vorgeschlagen)
- Keine sichtbare UI-Änderung außer der funktionierenden Auswahl, deshalb `ui: off` und keine Screenshots nötig (vorgeschlagen)
