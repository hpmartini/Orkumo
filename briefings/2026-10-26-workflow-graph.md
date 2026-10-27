# Briefing: Workflows als Graph (#87, Runde 2)

## The Job

Die Ansicht `/workflows` in DevOrbit zeigt die Martini Workflows (mw) als gerichteten Graphen statt als sechs Board-Spalten. Knoten sind die echten Stationen von mw, Kanten die Übergänge zwischen ihnen. Jeder Knoten trägt einen Zähler und eine aufklappbare Liste der Issues, die gerade dort stehen. Jeder Eintrag der Liste ist die vorhandene `WorkflowCard` mit Hover-Overlay, Details und GO. Ein Umschalter wechselt zwischen zwei Ansichten:

- **Gesamtgraph:** ein gemeinsamer Anfang, Abzweige pro Modus, ein gemeinsames Ende. Das ist die Standardansicht.
- **Einzelgraph:** genau ein Modus (Standard, Orchestrate, Pipeline, Bild).

Wechselt ein Issue den Knoten, läuft es sichtbar die Kante entlang.

## Why

Hape steuert mehrere parallele mw-Läufe über MACC. Die erste Version bildete nur die Board-Spalten ab und zeigte damit weder, wo ein Lauf intern steht (Plan, Gates, Review-Runde, Freigabe), noch dass sich die Modi unterscheiden. Hape soll auf einen Blick sehen:

- welcher Lauf an welcher Station hängt
- wo eine Schleife läuft
- wo seine Freigabe fehlt

Von dort springt er direkt zu Agent, Issue, PR oder Code.

## Guardrails

- **Stationen.** Die Knoten sind mw-Fakten. Die Zuordnung steht als Tabelle in `utils/workflowStage.js`.
  - **Anfang, für alle Modi gleich:** `mw:go` → Todo → Abgeholt (`start`-Marker).
  - **Standard:** Interview, mit einer Schleife über Rückfrage/`need-input`, dann `briefed`, dann GO (`mw:build`), dann Umsetzung (`/goal`). Ohne Trace lässt sich die Position innerhalb von `/goal` nicht bestimmen. Das Issue steht dann auf „Umsetzung“.
  - **Orchestrate:** Trace-Phasen `plan` → `build` → `gates` → `review` → `check`. Es gibt zwei Rückkanten: die Fix-Runde (höchstens 2) und die Goal-Schleife mit `--continue`.
  - **Pipeline:** Discovery → Briefing-Freigabe → `plan`/`short_plan` → `plan_approval` → `red_repro` → `build` → `gates` → `full_review` → `correction` → `document` → `gates` → `delta_review` → Draft-PR → PR-Freigabe. Knoten, die es im Typ des Laufs (feature, bug, hotfix, chore) nicht gibt, erscheinen gedimmt.
  - **Bild:** Abgeholt → Bilder erzeugen → PR.
  - **Ende, für alle Modi gleich:** PR → to Review → Merge → Wrap-up → to Deploy/Done → Session entfernt.
- **Wiederverwenden statt neu bauen.** Erhalten bleiben `WorkflowCard`, `WorkflowDetails`, die GO-Route samt 409-Prüfung, `workflowService` mit Runs, Docs und Screenshots sowie die Vertrauensregel für Marker (nur hpmartini). `deriveWorkflowState` liefert künftig zusätzlich die Knoten-ID.
- **Darstellung.** Die Knoten sind HTML, weil Klickflächen, aufklappbare Listen und Tastaturbedienung dort sicher funktionieren. Kanten, Partikelstrom und Kometen bei Knotenwechseln zeichnet three.js darunter, in 2D von links nach rechts mit einer Spur pro Modus. Reduced-Motion und der Fallback ohne WebGL bleiben.
- **Annahme:** Der Graph ersetzt die Spaltenansicht vollständig.
- **Annahme:** Rückkanten erscheinen als gebogene Kanten. Steht ein Issue in einer Schleife, zeigt sein Knoten die Runde („Review 2/2“).
- **Annahme:** Die Pipeline bekommt eine Spur mit gedimmten typfremden Knoten, nicht vier Spuren.
- **Annahme:** Der Bild-Modus kommt als kurzer vierter Ast dazu.
- **Nicht im Umfang:** neue Board-Logik in mw, Remote- und Mesh-Hosts, Bearbeiten von Issues aus dem Graphen. Für Fan-out höchstens 4 Subagenten.

## Done means

- Auf `http://localhost:3000/workflows` steht jedes mw-Issue von MACC auf dem richtigen Knoten. Geprüft wird mit Playwright bei 1600 px und 390 px Breite.
- Knotenlisten klappen auf.
- Der Umschalter wechselt zwischen Gesamt- und Einzelgraph.
- Ein Knotenwechsel animiert entlang der Kante. Beleg: Wegwerf-Issue mit Markern, wie in der Review-Anleitung von PR #101.
- Unit-Tests decken die Knotenzuordnung je Modus und je Pipeline-Typ ab.
- `bun run test`, `bun run lint`, `npx tsc --noEmit` und `bun run build` laufen grün.
- Die GO-Funktion verhält sich unverändert.
- PR #101 trägt einen aktualisierten Body mit `Closes` und `## Review-Anleitung`. Danach läuft `mw board done`.
- Weiterarbeiten, außer bei einer Station, die sich aus Markern, Labels oder Trace nicht ableiten lässt. Dann Rückfrage über `mw board ask`.
- Rückmeldung: kurzer Bericht, was gebaut und was angenommen wurde.

## First on approval

Im Worktree auf Branch `feat/87-workflow-visualization` die Knotentabelle in `utils/workflowStage.js` samt Tests anlegen.
