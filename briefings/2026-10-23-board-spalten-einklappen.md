# Briefing: Board-Spalten per Klick auf den Namen ein- und ausklappen

## The Job

Im Board-Modus (`components/BoardView/`) lässt sich jede Statusspalte ein- und ausklappen, nicht mehr nur die Done-Spalte. Das tut ein Klick auf den Spaltenkopf mit dem Namen. Die kleinen Chevron-Buttons (`ChevronsRight` im offenen Done-Kopf, `ChevronsLeft` im eingeklappten Kopf) fallen weg. Eine eingeklappte Spalte ist ein schmaler Streifen (heute 44px). Er zeigt den Namen senkrecht und die Anzahl, und ein Klick darauf klappt die Spalte wieder auf. Der Streifen bleibt Drop-Ziel für Drag & Drop, so wie heute bei Done.

## Why

Hape plant im Board (GitHub-Projects-Spiegel, Default MACC) Issues über viele Spalten. Backlog allein hat rund 300 Items. Hape will Spalten, die gerade nicht zählen, aus dem Weg klappen, damit die relevanten Spalten Platz bekommen. Das kleine Eck-Symbol ist schwer zu treffen. Der Name ist das natürliche Klickziel, so wie es die Swimlane-Köpfe in `BoardGrid.tsx` schon vormachen (ganzer Kopf ist ein `button` mit `aria-expanded`).

## Guardrails

- Scope: `components/BoardView/BoardGrid.tsx` und `BoardView.tsx`, dazu passende Tests in `test/`. Backend, `utils/board.ts`-Logik und Karten bleiben unverändert, weil das reine UI-Verhalten ist.
- Folge dem Muster der Swimlane-Köpfe: ganzer Kopf als `button`, `aria-expanded`, `focus-visible`-Outline, Tastatur bedienbar. Spaltenfarbe (`columnTint`), Zähler und der Hinweis „· N Tage“ an Done bleiben, damit die Optik gleich bleibt.
- Der heutige Einzelzustand `doneOpen`/`onToggleDone` wird zu einer Menge eingeklappter Spalten-Keys (`col.key`). Grid-Breite (`gridTemplateColumns`, `minWidth`) und leere Drop-Zellen gelten für jede eingeklappte Spalte, nicht nur für Done.
- Done-Zeitfenster (`withinDoneWindow`) bleibt unverändert, weil Einklappen nur die Anzeige betrifft und nicht filtert.
- Annahme: Default wie heute. Done ist eingeklappt, alle anderen Spalten sind offen.
- Annahme: Der Klappzustand wird im `localStorage` gespeichert, eigener Key oder in `ViewPrefs` (`devOrbitBoardView`). Lesen und Schreiben stehen im `try/catch` wie in `loadView`. Unbekannte Keys, etwa nach Umbenennen einer Statusoption, werden ignoriert.
- Annahme: Der Kopf ist kein Drag-Griff. Spaltenreihenfolge und Drag von Spalten sind nicht Teil dieses Auftrags.
- Out of scope: Spalten ausblenden, umsortieren, Swimlane-Verhalten.

## Done means

- Jede Spalte klappt per Klick und per Enter/Space auf den Kopf ein und aus. Im Code gibt es keinen separaten Chevron-Button mehr für Spalten.
- Karten lassen sich auf eine eingeklappte Spalte ziehen, der Status wird gesetzt (`onMove`).
- Nach dem Neuladen ist derselbe Klappzustand wieder da.
- Check: `bun run test:run` grün (mindestens `test/board.test.ts`, `test/useBoard.test.tsx`) plus ein neuer Test für Klappen und Persistenz. `bun run build` läuft fehlerfrei. Dazu ein Screenshot vom Board mit zwei eingeklappten Spalten im PR.
- Rückmeldung: PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/73` und `## Review-Anleitung`, kurzer Bericht mit Änderungen und getroffenen Annahmen.

## First on approval

Worktree von `origin/main` anlegen und in `BoardGrid.tsx` `doneOpen`/`onToggleDone` durch eine Menge eingeklappter Spalten-Keys ersetzen.
