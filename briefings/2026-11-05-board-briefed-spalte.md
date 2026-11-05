# Briefing: Orkumo zeigt den neuen mw-Ablauf (Spalte Briefed, mw:update, mw:followup, ohne to Deploy)

## The Job

mw 7.9.0 bildet Hapes Ablauf neu ab (Skizze `~/Pictures/Martini_Git-Workflow.png`, Plugin-Briefing `briefings/2026-11-05-board-briefed-spalte.md` in `hpmartini/example-workflow-plugin`). Orkumo übernimmt dieselben Namen:

| Spalte | Workflow-Stufe in Orkumo | Wartet auf | Aktion im Dialog |
|---|---|---|---|
| Todo, mit `start`-Marker | Briefing & Vertrag | Agent | – |
| **Briefed** (neu) | Wartet auf GO | Hape | **Umsetzen** (`mw:build` + `mw board go`), **Überarbeiten** (`mw:update` + Kommentar + `mw board go`) |
| In Progress | Umsetzung | Agent | – |
| to Review | Review | Hape | **Nacharbeiten** (`mw:followup` + Kommentar + `mw board go`) |
| Done | Fertig | – | – |

- **`utils/workflowStage.js`.**
  - Neue Konstanten `UPDATE_LABEL = 'mw:update'` und `FOLLOWUP_LABEL = 'mw:followup'`.
  - `deriveWorkflowState` richtet sich nach diesen Spalten. Der `to deploy`-Zweig und der Text „Wartet auf Deploy" fallen weg.
  - Ein gesetztes `mw:update` oder `mw:followup` zeigt den Zustand „Rückmeldung übergeben, wartet auf den Poll".
- **Dialog.**
  - `FlowControls` bekommt die zwei neuen Knöpfe, nach dem Muster von Umsetzen.
  - Erst wird der Kommentar gepostet, dann das Label gesetzt, dann `startNow(url)` aufgerufen. So holt der Poll die Rückmeldung sofort ab.
  - Ein Label, das im Repo fehlt, deaktiviert den Knopf wie heute.
- **Board.** Die Spalten kommen schon dynamisch aus MACC (`columnTint`). Zu prüfen ist, dass die Spalte Briefed ohne Code-Sonderfall erscheint und `to Deploy` nirgends fest verdrahtet bleibt. Das gilt für `briefings/mockups/` nicht.

## Why

Hape soll auf einen Blick sehen, wo er lesen, freigeben oder nachfassen muss. Bisher lagen Interview, Briefing und Umsetzung alle in In Progress. Orkumo und mw vergleichen dieselben Strings. Weicht ein Name ab, zeigt Orkumo still die falsche Stufe.

## Guardrails

- Betroffen sind:
  - `utils/workflowStage.js`
  - `components/BoardView/FlowControls.tsx` und `GoButton.tsx`
  - `server/services/workflowGo.js` (serverseitige Prüfung, falls eine neue Route nötig ist)
  - `services/boardApi.ts`
  - Tests: `test/workflowStage.test.js`, `test/WorkflowCard.test.tsx`, `test/board.test.ts`
- Die Namen stehen exakt wie in der Tabelle: `Briefed`, `mw:update`, `mw:followup`.
- An der Vertrauensgrenze bleibt es bei `ISSUE_URL_RE` und zod. Ein Kommentartext geht nur über die vorhandene Kommentar-API, nie in eine Shell.
- Für alte Issues gilt: Ein `briefed`-Marker in In Progress ohne `goal` danach zeigt weiter „Wartet auf GO". So stimmt die Anzeige auch, solange der Poll noch nicht migriert hat.
- Nutze die Kommentar- und Label-Funktionen, die es schon gibt. Baue keinen zweiten Weg.
- Teilaufgaben darfst du nach eigenem Ermessen an Codex abgeben (Skill `mw:delegate`). Diff und Tests prüfst du selbst.
- Keine neuen Dependencies. Shell aus dem Worktree mit repo-relativen Pfaden, ohne `cd` und ohne Heredocs.

## Done means

| ID | Bedingung | Nachweis |
|----|-----------|----------|
| AC-1 | `deriveWorkflowState` liefert für jede Zeile der Tabelle die genannte Stufe und `waitingOn`, dazu den Altfall (briefed in In Progress) | Unit-Tests je Zeile |
| AC-2 | Im Code steht `to Deploy` bzw. `to deploy` nicht mehr, ausgenommen `briefings/` und `landing/` | `git grep`-Ausgabe im PR |
| AC-3 | „Überarbeiten" in Briefed postet den Kommentar, setzt `mw:update` und ruft `startNow` auf, in dieser Reihenfolge. Ohne Text bleibt der Knopf gesperrt | Komponententest mit gemockter API |
| AC-4 | „Nacharbeiten" in to Review macht dasselbe mit `mw:followup` | Komponententest |
| AC-5 | Die Board-Ansicht zeigt eine Spalte Briefed aus den MACC-Optionen, ohne Sonderfall | Test mit Fixture-Optionen und ein Screenshot unter `## Screenshots` |
| AC-6 | `bun test` grün, Typecheck und Lint grün | Ausgabe im PR |

Weiterarbeiten, außer bei fehlenden GitHub-Rechten. Der PR geht gegen `main` und enthält `## Review-Anleitung`, `## Nachweise` (eine Zeile je AC) und `## Screenshots`. Nicht mergen.

## Prüfung

langlebig · selbst. Es entsteht keine neue Vertrauensgrenze, nur zwei Knöpfe auf vorhandenen APIs.

## First on approval

Die Tabelle als Tests für `deriveWorkflowState` schreiben und rot sehen.

## Annahmen

- Die Knöpfe heißen „Überarbeiten" und „Nacharbeiten".
- Ein Knopf postet den Kommentar selbst. Hape schreibt ihn also im Dialog und nicht vorher auf GitHub.
