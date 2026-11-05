# Briefing: Kontext-Dialog – Größe ändern, Verzeichnisse ein-/ausklappen

Issue: https://github.com/hpmartini/DevHub/issues/187

## The Job

Hape im Dialog „Neuer Kontext“ / „Kontext bearbeiten“ (`components/ContextDialog.tsx`) die Fenstergröße selbst ziehen lassen, damit bei vielen Projekten mehr als die heutigen ~6 Zeilen sichtbar sind, und die Projektliste je Projektverzeichnis (`~/LABORATORY` usw.) ein- und ausklappen lassen, einzeln per Klick auf den Gruppenkopf und alle auf einmal per „Alle einklappen“ / „Alle ausklappen“. Die Projektliste wächst mit der Dialoghöhe mit, statt fest bei `max-h-72` zu bleiben.

## Why

Hape pflegt über diesen Dialog Kontexte (Projektgruppen für Board und Agents). Mit mehreren Projektverzeichnissen und vielen Projekten ist die Liste ein enges Scrollfenster in einem festen 560-px-Dialog (Screenshot im Issue: 6 Zeilen sichtbar, Rest gescrollt). Einklappen nicht benötigter Verzeichnisse und ein größeres Fenster machen das Auswählen schneller und übersichtlicher.

## Guardrails

- Änderung bleibt in `components/ContextDialog.tsx`; reine Zustandslogik (z. B. Größe begrenzen, Klappzustand) darf als kleine Funktion daneben liegen und wird getestet, weil der Dialog selbst bisher ohne Tests ist.
- Gruppierung kommt weiter aus `groupByRoot`/`projectRoot` (`utils/projectDirs`), weil die Projektverzeichnisse dort zentral definiert sind.
- Gruppenkopf-Buttons und Alle-Buttons folgen dem Muster aus `components/AgentsView/ProjectsRail.tsx` (Icons `ChevronsDownUp`/`ChevronsUpDown`, `aria-label`, `title`), damit die App einheitlich bleibt. Gruppenkopf wird ein echter `<button>` mit `aria-expanded`, weil er per Tastatur bedienbar sein muss.
- Fokus-Trap (`useDialogA11y`), Escape, Auswahl, Filter, „Alle Projekte“, Board-Filter und Speichern-Logik bleiben unverändert, weil sie funktionieren. Speichern muss auch Projekte in eingeklappten Gruppen behalten.
- Pfadkürzung (`HEADER_PATH_CHARS`/`ROW_PATH_CHARS`) darf bleiben; CSS-`truncate` fängt breitere oder schmalere Dialoge ab.
- localStorage-Zugriffe in try/catch, Dialog rendert ohne gespeicherte Werte korrekt.
- Out of scope: andere Dialoge, Verschieben des Dialogs (Drag an der Titelleiste), Filter-/Sortierlogik, Redesign.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                                                                                           | Nachweis                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Der Dialog lässt sich per Ziehen (Ecke unten rechts) in Breite und Höhe ändern, nach unten begrenzt auf eine Mindestgröße, bei der alle Felder bedienbar bleiben (ca. 420 × 400 px), nach oben auf den Viewport; die Projektliste nutzt die zusätzliche Höhe, Fußzeile mit Buttons bleibt sichtbar. | Playwright: Dialog vergrößern, `clientHeight` der Liste vorher/nachher gemessen (nachher größer), Fußzeile im Viewport; Screenshots klein/groß im PR unter `## Screenshots` |
| AC-2 | Die gewählte Dialoggröße bleibt nach Schließen und erneutem Öffnen (auch nach Reload) erhalten.                                                                                                                                                                                                     | Playwright: vergrößern, schließen, Reload, öffnen → gleiche Maße (±2 px), Ausgabe im PR                                                                                     |
| AC-3 | Klick oder Enter/Space auf einen Gruppenkopf klappt nur diese Gruppe ein/aus; Kopf zeigt Chevron, `aria-expanded` und im eingeklappten Zustand „ausgewählt/gesamt“ der Gruppe.                                                                                                                      | Komponententest (Vitest + Testing Library) für Toggle, `aria-expanded` und Zähler; GIF des Ablaufs im PR                                                                    |
| AC-4 | „Alle einklappen“ / „Alle ausklappen“ wirken auf alle Gruppen; ist ein Filtertext gesetzt, sind passende Treffer sichtbar, auch in eingeklappten Gruppen.                                                                                                                                           | Komponententest für beide Buttons und den Filterfall                                                                                                                        |
| AC-5 | Projekte in eingeklappten Gruppen bleiben ausgewählt und werden mitgespeichert; Auswahl, Filter, „Alle Projekte“, Escape und Fokus-Trap funktionieren wie vorher.                                                                                                                                   | Komponententest: Auswahl, Gruppe einklappen, Speichern → `onSave` enthält die IDs; bestehende Tests grün (`bun run test:run`)                                               |
| AC-6 | Build und Typen sind sauber.                                                                                                                                                                                                                                                                        | `bun run build` und `bunx tsc --noEmit` ohne Fehler, Ausgabe im PR                                                                                                          |

## Ambition

- Altitude: keine; der Dialog ist der richtige Ort.
- Depth: echte Projektliste aus dem eigenen Scan (mehrere Projektverzeichnisse, > 30 Projekte) als Testfall, Messung im Browser statt Augenmaß; Ziel: bei maximaler Höhe auf 1080p-Viewport ≥ 15 Projektzeilen sichtbar.
- Crew: tut, was eine Accessibility-Prüferin tut: Gruppenköpfe und Alle-Buttons nur mit Tastatur bedienen, `aria-expanded`/`aria-controls` prüfen.

## Prüfung

wegwerf · selbst · Lokale UI-Verbesserung in einem Dialog ohne Vertrauensgrenze, billig neu zu bauen.

## First on approval

Dialog im Browser mit echtem Projekt-Scan öffnen und den Ist-Zustand (feste Größe, Liste mit `max-h-72`) als Vorher-Screenshot festhalten.

## Annahmen

- „entern“ im Issue heißt „ändern“: Größe per Ziehen, nicht per Eingabefeld oder Größen-Presets. (vorgeschlagen)
- Resize über native CSS-Resize-Ecke oder eigenen Griff unten rechts; Dialog bleibt horizontal zentriert, kein Verschieben. (vorgeschlagen)
- Dialoggröße und Klappzustand je Verzeichnis werden in localStorage gemerkt; Standard beim ersten Öffnen: heutige Größe, alle Gruppen ausgeklappt. (vorgeschlagen)
- Alle-Buttons sitzen in der Zeile über der Liste neben dem Filterfeld bzw. rechts davon. (vorgeschlagen)
- Gruppe „Außerhalb der Projektverzeichnisse“ ist ebenfalls klappbar. (vorgeschlagen)
- `ui: on` vorgeschlagen, weil sichtbare UI und neue Interaktion (Screenshots + GIF im PR). (vorgeschlagen)
