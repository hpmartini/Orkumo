# Briefing: „Umsetzen“ setzt mw:build nur und startet die Umsetzung sofort

## The Job

- **Button „Umsetzen“ im Issue-Dialog** (`components/BoardView/FlowControls.tsx`) toggelt heute `mw:build`.
  - Ist das Label gesetzt, entfernt ein Klick es wieder. Das ist bei DevHub#194 passiert: Label um 09:39:05Z gesetzt, um 09:39:22Z per Klick wieder weg.
  - Neu: „Umsetzen“ setzt `mw:build` nur, wenn es fehlt. Ist es schon gesetzt, entfernt der Klick es nie.
  - Der Button zeigt den gesetzten Zustand (`aria-pressed`) weiter an.
- **Der Klick startet die Umsetzung direkt.** „Umsetzen“ und „Jetzt starten“ laufen über denselben Weg:
  1. Label setzen, ohne Duplikat. `applyGo` in `server/services/workflowGo.js` hängt heute `BUILD_LABEL` blind an.
  2. `mw board go <issue-url> --json` aufrufen statt nur `launchctl kickstart` des Polls.
- **Rückmeldung im Dialog:**
  - „gestartet“, oder
  - „kein Platz frei (x/y), startet, sobald einer frei wird“, oder
  - den Grund aus `reason`.
  - Fehlt `mw board go` (altes mw), bleibt der Poll-Kick der Fallback, mit dem Hinweis „startet mit dem nächsten Poll“.

## Why

Hape klickt „Umsetzen“, damit gebaut wird, und erwartet sofortigen Start, sofern Kapazität frei ist. Der Toggle hat die Freigabe stattdessen still zurückgenommen, und der Poll-Kick ändert nichts, wenn der Poll gerade läuft.

Der mw-Teil (`mw board go`, Briefing `briefings/2026-11-04-board-go-sofortstart.md` in hpmartini/example-workflow-plugin) liefert den Sofortstart.

## Guardrails

- Betroffene Dateien:
  - `components/BoardView/FlowControls.tsx`, `utils/issueControls.ts` (`toggleLabel`).
  - `server/services/workflowGo.js`, die Route `/api/workflows/go` in `server/index.js`.
  - Tests in `test/IssueModal.test.tsx` und die Tests zu workflowGo und issueControls.
- Andere Schalter (Freigeben, Dynamic, delegate, review) bleiben Toggles. Nur `mw:build` wird zum reinen Setzen. Zurücknehmen geht weiter über das Label in GitHub.
- Der mw-Aufruf läuft über `execFile` mit fester Argumentliste. Die Issue-URL wird vorher gegen das bestehende Muster validiert. Grund: Die URL kommt aus dem Client (Vertrauensgrenze).
- Keine neuen Dependencies. Vorhandene Muster und Tokens verwenden.
- Basis `origin/main`. Der lokale `main` ist 27 Commits zurück und hat untracked Briefings. Diese nicht anfassen.
- Out of scope: Änderungen am mw-Plugin. Ein Button zum Zurücknehmen der Freigabe.

## Done means

| ID | Bedingung | Nachweis |
|----|-----------|----------|
| AC-1 | Klick auf „Umsetzen“ bei gesetztem `mw:build` lässt das Label stehen. Bei fehlendem Label setzt er es | Komponententest in `test/IssueModal.test.tsx`, beide Fälle |
| AC-2 | `applyGo` erzeugt nie ein doppeltes `mw:build` | Service-Test mit bereits gesetztem Label |
| AC-3 | Nach dem Setzen ruft der Server `mw board go <url> --json` auf. Ohne `mw board go` (Exit „unknown command“) fällt er auf den Poll-Kick zurück | Service-Test mit gemocktem `execFile` für start, kein Platz, Fallback |
| AC-4 | Der Dialog zeigt je nach Ergebnis „gestartet“, „kein Platz frei (x/y)“ oder den Fallback-Hinweis | Komponententest |
| AC-5 | Eine URL außerhalb von `https://github.com/<owner>/<repo>/issues/<n>` wird mit 4xx abgelehnt, ohne mw-Aufruf | Server-Test |
| AC-6 | Echter Pfad: Dev-Server, Issue-Dialog eines MACC-Issues mit gesetztem `mw:build`, zweimal „Umsetzen“ klicken, Label bleibt gesetzt | Playwright-GIF oder Screenshots vor und nach dem Klick, plus `gh issue view --json labels` |
| AC-7 | Keine Regression: `bun run test`, `bun run lint`, `bun run build` grün | Ausgabe im PR |

Weiterarbeiten, außer bei fehlenden GitHub-Rechten. PR gegen `main` mit `## Review-Anleitung` und `## Nachweise` (eine Zeile je AC). Nicht mergen.

## Prüfung

langlebig · selbst. Neuer Prozessaufruf aus Client-Eingabe, abgedeckt durch AC-5.

## First on approval

Den Komponententest für AC-1 schreiben (rot), dann den `toggle` für `BUILD_LABEL` durch ein reines Setzen ersetzen.

## Annahmen

- `mw board go` kommt aus dem mw-Briefing. Bis es released ist, greift der Fallback (vorgeschlagen).
- Bei vollem `max_parallel` bleibt das Label gesetzt und der Poll startet später. Der Dialog sagt das (vorgeschlagen).
- Workspace-Trust wird nicht automatisch gesetzt.
