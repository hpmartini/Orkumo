# Briefing: Kontext-Dialog – lange Pfade und Namen ohne Überlauf

Issue: https://github.com/hpmartini/DevHub/issues/156

## The Job

Hape Projekte im Dialog „Neuer Kontext“ / „Kontext bearbeiten“ (`components/ContextDialog.tsx`) schnell und eindeutig auswählen lassen, auch bei sehr langen Namen und Pfaden: alles bleibt innerhalb der 520 px Dialogbreite, jede Zeile zeigt Name und unterscheidbaren Pfad, nichts ragt über das Modal hinaus. Vorschlag zur Darstellung: Name oben, Pfad darunter klein und gedimmt, Home-Verzeichnis als `~`, Rest-Überlänge am Anfang gekürzt (`…/projects/DemoNews`), voller Pfad im `title`-Tooltip.

## Why

Hape legt über diesen Dialog Kontexte an (Projektgruppen für Board und Agents). Im Screenshot des Issues ragen Filterfeld und Projektliste bis zum Fensterrand, die Pfade liegen außerhalb des Modals über dem Hintergrund. Das wirkt kaputt und macht gleichnamige Projekte in verschiedenen Ordnern schwer unterscheidbar.

## Guardrails

- Ursache geprüft: `<fieldset>` hat im Browser `min-inline-size: min-content`; die `whitespace-nowrap`-Spans (`truncate`) erzwingen seine Breite, das `w-full`-Filterfeld wächst mit. Fix an der Ursache (z. B. `min-w-0` am Fieldset), nicht per `overflow-hidden` am Dialog, weil Inhalte sonst nur abgeschnitten statt sinnvoll gekürzt werden.
- Änderung bleibt in `components/ContextDialog.tsx`; Pfadkürzung entweder über bestehendes `shortenPath` (`utils/agentSessions.ts`) oder als kleine, getestete Funktion daneben, weil das Muster dort schon liegt.
- Home-Erkennung ohne neuen Server-Endpunkt (aus `/Users/<name>/` bzw. `/home/<name>/` ableiten), weil der Client kein `os.homedir()` hat.
- Fokus-Trap (`useDialogA11y`), Tastaturbedienung, Checkbox-Labels und Speichern-Logik bleiben unverändert, weil sie funktionieren.
- Out of scope: andere Dialoge, Redesign, Filter- und Sortierlogik.

## Done means

| ID   | Bedingung                                                                                                                                                                | Nachweis                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Mit einem Projekt, dessen Pfad > 80 Zeichen und Name > 50 Zeichen hat, sind Dialog, Filterfeld und Liste nicht breiter als der Dialog (kein horizontaler Überlauf).      | Browser-Messung (Playwright o. ä.): `scrollWidth <= clientWidth` für Dialog-Container und Liste, Filterfeld-Breite ≤ Dialog-Innenbreite; Ausgabe im PR |
| AC-2 | Jede Projektzeile zeigt Namen und einen gekürzten, unterscheidbaren Pfad (Home als `~`, Kürzung am Anfang, Ordnername sichtbar); voller Name und Pfad stehen im `title`. | Vorher/Nachher-Screenshot im PR + Unit-Test der Pfadkürzung (`~`-Ersetzung, Anfangskürzung, kurzer Pfad unverändert)                                   |
| AC-3 | Auswahl, Filtern, „Alle Projekte“, Speichern und Tastatur-Fokus funktionieren wie vorher.                                                                                | Bestehende Tests grün + kurzer manueller Durchlauf im Browser, im PR notiert                                                                           |
| AC-4 | Build und Typen sind sauber.                                                                                                                                             | `bun run build` und `bunx tsc --noEmit` ohne Fehler, Ausgabe im PR                                                                                     |

## Ambition

- Altitude: keine; der Dialog ist der richtige Ort.
- Depth: echte Projektliste aus dem eigenen Scan als Testdaten, Messung per Browser statt Augenmaß; Ziel null horizontaler Überlauf bei 520 px.
- Crew: tut, was eine UX-Prüferin tut: gleichnamige Projekte in verschiedenen Ordnern nebeneinander prüfen, ob sie unterscheidbar bleiben.

## Prüfung

wegwerf · selbst · Kosmetischer, lokal begrenzter UI-Fix ohne Vertrauensgrenze, billig neu zu bauen.

## First on approval

Dialog im Browser mit einem Projekt mit sehr langem Pfad öffnen und den Überlauf als Vorher-Screenshot festhalten.

## Annahmen

- Zweizeilige Zeile (Name/Pfad) statt Mittel-Ellipse in einer Zeile; Issue gibt nur „nichts abgeschnitten, übersichtlich“ vor. (vorgeschlagen)
- Filter sucht weiter nur im Namen, nicht im Pfad. (vorgeschlagen)
