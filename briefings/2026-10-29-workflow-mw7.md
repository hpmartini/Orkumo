# Briefing: Workflow-Ansicht auf mw 7 umstellen – Issue #136

## The Job

Die Ansicht **Workflows** (`/workflows`) und die mw-Steuerung im Board zeigen den Ablauf von mw 7 (Plugin `hpmartini/example-workflow-plugin`, 7.0.x, Handbuch `docs/mw-board.md` dort) so, wie er heute wirklich läuft. Jedes Issue steht auf der richtigen Station, nichts bietet mehr Schritte an, die es nicht mehr gibt.

- **Strecke Standard:** `mw:go` → Abgeholt (`start`) → Interview (Schleife Rückfrage `ask`/`need-input`) → Ziel-Vertrag → Wartet auf GO (`briefed`, Schleife Feedback-Kommentar `fed`/`resumed` → neues Briefing) → Umsetzung `/goal` (`goal`) → PR mit Nachweisen (to Review, `review`) → Merge → to Deploy/Done → Abschluss (`wrap` → `removed`).
- **Strecke Bild** (`mw:image`) bleibt.
- **Fehlerzustände** `invalid`, `noclone`, `fail`, `rmfail`, `resumefail` sind auf der Karte sichtbar, mit Grund.
- **Schalter** der Session (`dynamic`, `delegate`, `review`, Modell, Effort aus dem `start`-Marker bzw. Labels) erscheinen als Badges auf der Karte.
- **GO** heißt nur noch: Label `mw:build` nach dem letzten Briefing setzen.
- **Board-Steuerung** (`FlowControls`, `utils/issueControls.ts`): Modi nur noch Default und Image. Neu dazu Schalter `mw:delegate` und `mw:review` neben `mw:dynamic`.

## Why

Hape steuert seine Issues über mw board und nutzt `/workflows` als Leitstand (Leitbild `docs/VISION.md`: Kontext Issue ↔ Agent ↔ Worktree ↔ PR ↔ Code). mw 7.0.0 (28.10.2026) hat `mw orchestrate`, `mw run`/Pipeline und `mw approve` entfernt. Die Ansicht zeigt deshalb Strecken, die nie mehr laufen, und GO-Knöpfe, die ins Leere gehen. Die Labels `mw:orchestrate`/`mw:pipeline` aus dem Board lösen inzwischen einen Steuerungs-Fehler aus. Danach soll die Ansicht als Premium-Modul nach DevHub-pro wandern (#165). Ausgelagert wird dann diese mw-7-korrekte Fassung.

## Guardrails

- Betroffene Dateien: `utils/workflowStage.js`, `utils/workflowGraph.js`, `utils/workflows.ts`, `server/services/workflowService.js`, die `/api/workflows/*`-Routen in `server/index.js`, `components/WorkflowView/*`, `utils/issueControls.ts`, `components/BoardView/FlowControls.tsx`, `types.ts` sowie die Tests `test/workflow*.{js,ts}` und die Tests von issueControls/FlowControls.
- Stufen- und Graph-Ableitung bleiben reine, unit-getestete Funktionen, die Server und Client teilen (bestehendes Muster). Grund: GO-Validierung am Server.
- Lesen nur aus dem, was mw schreibt (Board-Spalte, Labels, `mw-board`-Marker vertrauenswürdiger Autoren über `parseMwMarkers`). Schreiben nur über `gh`/Label-Setzen wie bisher. Leitbild Prinzip 4: unmodifizierte CLIs, keine Plugin-Interna.
- Entfernt wird, was nur mw 6 brauchte: `mw approve`-Route und `approve`-GO, das Lesen von `.git/mw6/runs` (Trace, Approvals), die Journal-Zuordnung von Läufen, die Lanes orchestrate/pipeline und `PIPELINE_TYPES`. Grund: mw 7 schreibt keine Runs mehr. Toter Code würde beim Auslagern (#165) mitwandern.
- Out of scope: Auslagerung nach DevHub-pro und Erweiterung des Modulvertrags (#165), Graph-Layout und Szene (three.js) über neue Knoten hinaus, Änderungen am mw-Plugin, #134-UI-Wünsche (Grid, Projektfilter).
- Keine neuen Dependencies. Vorhandene Muster und Tokens wie in `components/WorkflowView/` verwenden.
- Annahme: Issues mit Markern `mode=orchestrate|pipeline` aus mw 6 landen auf der Standard-Strecke nach ihrer Spalte bzw. ihren Markern, ohne eigene Lane. (vorgeschlagen)
- Annahme: Die Phasen-/Trace-Anzeige in den Details entfällt ersatzlos, weil mw 7 keine Trace schreibt. Sessionzustand kommt weiter aus den Agent-Sessions. (vorgeschlagen)
- Annahme: Ein Parent mit Sub-Issues ist kein eigener Lauf. Er erscheint nicht als Karte, seine Sub-Issues schon (mw 7: `if i["subs"]: continue`). (vorgeschlagen)
- Annahme: Die Station „Abschluss“ (`wrap` bis `removed`) gehört zur Stufe Fertig, mit eigenem Knoten im Graphen. (vorgeschlagen)

## Done means

| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Die Stufen-Ableitung ordnet jedes Marker-/Label-/Spalten-Bild von mw 7 der richtigen Stufe und Station zu: start, ask+need-input, briefed ohne/mit `mw:build`, fed/resumed nach briefed (zurück auf Briefing), goal, review/to Review, Merge to Deploy/Done, wrap, removed, image | `bun run test test/workflowStage.test.js test/workflowGraph.test.js` grün, je Fall eine Fixture |
| AC-2 | Fehlermarker `invalid`, `noclone`, `fail`, `rmfail`, `resumefail` ergeben einen sichtbaren Fehlerzustand mit Grund. Nur Marker vertrauenswürdiger Autoren zählen | Unit-Test je Marker plus Test „fremder Autor wird ignoriert“ |
| AC-3 | Der Graph hat nur die Lanes Standard und Bild mit den Stationen aus The Job. Im Code und in der UI gibt es keine orchestrate-/pipeline-Knoten, `PIPELINE_TYPES` oder `mw approve` mehr | Graph-Unit-Test auf Knoten und Kanten. `grep -rnE "orchestrate\|pipeline\|mw6\|mw approve" utils components server types.ts` ohne Treffer außer der Legacy-Zuordnung aus den Annahmen |
| AC-4 | `POST /api/workflows/go` nimmt nur `{kind:'build'}` an, setzt `mw:build` nur, wenn der Zustand dieses GO anbietet, und lehnt alles andere mit 4xx ab | Server-Test (vitest/supertest oder Service-Test) für gültig, veraltet und `approve` |
| AC-5 | Karten zeigen die Schalter-Badges (dynamic, delegate, review, Modell, Effort), sofern gesetzt | Komponententest auf Badges und Playwright-Screenshot einer Karte |
| AC-6 | `FlowControls` bietet die Modi Default und Image sowie die Schalter dynamic, delegate und review. orchestrate/pipeline sind weg. Ein Modus-Wechsel entfernt alte `mw:orchestrate`/`mw:pipeline`-Labels | Unit-Test `issueControls` (setMode, toggle) plus Komponententest FlowControls |
| AC-7 | `/workflows` zeigt reale MACC-Issues (mind. #136 und ein Issue in to Review) auf der richtigen Station, ohne Konsolenfehler | Playwright gegen den laufenden Dev-Server: Screenshot des Graphen und einer aufgeklappten Karte |
| AC-8 | Keine Regression: Tests, Lint, Build grün; Board-, Agents- und Code-Modus laden | `bun run test`, `bun run lint`, `bun run build` mit Ausgabe. Playwright-Aufruf der drei Routen ohne Konsolenfehler |

Weiterarbeiten, außer bei fehlenden GitHub-Rechten. PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/136`, `## Review-Anleitung` und `## Nachweise` (eine Zeile je AC). Rückmeldung in kurzen Bullets: was gebaut, wo, welche Annahmen, was offen ist.

## Ambition

- Altitude: Die Ansicht liest den Ablauf aus einer Beschreibung, die mw selbst liefert (z. B. `mw board stations --json`), statt ihn nachzubauen. Dann bricht die nächste Major-Version die Ansicht nicht mehr. Nur ein Vorschlag, braucht eine Änderung am Plugin und eine eigene Freigabe.
- Depth: Als Rohdaten die echten Marker-Kommentare aktueller MACC-Issues (`gh issue view --json comments`) als Fixtures nehmen, keine erfundenen. Ziel: 100 % der offenen MACC-Issues landen auf einer Station, keines auf „unbekannt“.
- Crew: tut, was eine Prüferin für Zustandsautomaten tut: jede Kombination aus Spalte × letztem Marker × `need-input`/`mw:build` tabellarisch durchgehen und auf eindeutige Station prüfen.

## Prüfung

langlebig · selbst · Kernmodus ohne neue Vertrauensgrenze. Die GO-Validierung bleibt im bestehenden Muster, Regressionen deckt AC-8 ab.

## First on approval

`deriveWorkflowState` und die Graph-Stationen in `utils/workflowStage.js` / `utils/workflowGraph.js` auf die mw-7-Marker umstellen, mit Fixtures aus echten Issue-Kommentaren. Server, UI und Board-Steuerung bauen darauf auf.

## Annahmen

- #136 deckt nur die mw-7-Anpassung ab. Die Pro-Auslagerung und der Modulvertrag „Modul bringt eigenen Modus“ laufen in #165 (Hapes Antwort: Option 1).
- Legacy-Issues aus mw 6 kommen auf die Standard-Strecke. (vorgeschlagen)
- Trace-/Phasenanzeige entfällt. (vorgeschlagen)
- Parent-Issues mit Sub-Issues erscheinen nicht als Karte. (vorgeschlagen)
- Der Abschluss nach dem Merge ist ein Knoten innerhalb von Fertig. (vorgeschlagen)
