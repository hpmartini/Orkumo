# Briefing: Bearbeitung eines Issues direkt triggern (DevHub #145)

## The Job

Hape startet die nächste mw-Phase eines Issues mit einem Klick dort, wo er das Issue gerade sieht (Workflow-View-Karte und -Details, Board-Sidebar `BoardItemPanel`, später das Issue-Modal aus #104), statt bis zu 15 min auf den mw-board-Poll (launchd `StartInterval` 900 s) zu warten. Der Button „Jetzt starten“ erscheint, sobald das Issue auf den Poll wartet: freigegeben (`mw:go`, noch keine Session) oder GO für die Umsetzung gegeben (`mw:build` nach Briefing). Der bestehende GO-Button „GO: Umsetzung“ setzt `mw:build` und stößt den Poll im selben Zug an.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`); Hape steuert die mw-Pipeline über Labels. Nach Freigabe oder GO steht die Arbeit heute bis zu 15 min still („startet beim nächsten Poll“). Ziel: Freigabe und Start in einem Moment, ohne Terminal und ohne GitHub.

## Guardrails

- Mechanik: `launchctl kickstart gui/<uid>/de.martini-labs.mw-board` ohne `-k`, weil `_pending()` in `example-workflow-plugin/plugins/mw/core/mw/board.py` darauf baut, dass launchd nie zwei Polls überlappt; `-k` würde einen laufenden Poll mitten im Session-Start töten, ein direktes `mw board poll` aus dem Server liefe parallel. mw selbst bleibt unverändert.
- `shortcut:`-Kommentar am Aufruf: läuft schon ein Poll, ist kickstart ein No-op und dieser Poll hat das Issue evtl. vor dem Label gelesen; der nächste Tick holt es.
- In das bestehende GO-Muster einhängen statt Parallelweg: neue Variante `{ kind: 'poll' }` von `WorkflowGo` in `utils/workflowStage.js` (`deriveWorkflowState` bietet sie bei `waitingOn: 'poll'`; `sameGo`), Schema und Handler `/api/workflows/go` in `server/index.js` (~Z. 3482; 409, wenn der frische Zustand das GO nicht anbietet), `services/boardApi.ts`, Label in `WorkflowCard.tsx`. `GoButton` teilen statt kopieren, auch in `BoardItemPanel.tsx` (bei „Agent starten“, ~Z. 347), damit #104 ihn mitbekommt.
- Host-Ausführung über `runOnHost` (`server/services/agentService.js`), weil der Server auch in Docker läuft (`docker-compose.yml`, `PTY_HOST_HTTP_URL`). `pty-host/index.js:27` erlaubt nur `claude`; `/exec` ist eine Vertrauensgrenze, also kein generisches `launchctl` freigeben. UID auf dem Host ermitteln, nicht im Container.
- Out of scope: mw-Änderungen, Issue-Modal #104 selbst, Rückfragen beantworten, Approve-Flows (orchestrate/pipeline).
- Arbeit im eigenen Worktree auf Feature-Branch, PR gegen `main`, kein Merge.

## Done means

| ID   | Bedingung                                                                                                                                                                                                               | Nachweis                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | `deriveWorkflowState` bietet `go: {kind:'poll'}` für (a) `mw:go` ohne Start-Marker und (b) Briefing + `mw:build`; in allen anderen Zuständen nicht. `sameGo` akzeptiert es nur, wenn angeboten.                         | Unit-Tests in `test/workflowStage.test.js`, grün                                                                                                                                                                           |
| AC-2 | `POST /api/workflows/go` mit `{kind:'poll'}` ruft `runOnHost` mit exakt `launchctl kickstart gui/<uid>/de.martini-labs.mw-board` (ohne `-k`); 409, wenn der frische Zustand das GO nicht anbietet; ungültiger Body 400. | Route-Test in `test/workflows.test.ts` mit gemocktem `runOnHost`, grün                                                                                                                                                     |
| AC-3 | GO `build` setzt `mw:build` und stößt danach den Poll an; scheitert kickstart, bleibt das Label gesetzt und die Antwort meldet den Fehler.                                                                              | Route-Test (Erfolg + kickstart-Fehler), grün                                                                                                                                                                               |
| AC-4 | pty-host `/exec` lässt `launchctl` nur mit genau den kickstart-Argumenten für `de.martini-labs.mw-board` zu; jede andere `launchctl`-Argumentliste wird abgelehnt.                                                      | Test gegen die Allowlist-Prüfung (z. B. herausgelöste Funktion), grün                                                                                                                                                      |
| AC-5 | „Jetzt starten“ erscheint in Workflow-Karte und Board-Sidebar bei `waitingOn: 'poll'`, nicht sonst; derselbe Button-Baustein.                                                                                           | Komponententest oder Playwright-Screenshot beider Stellen                                                                                                                                                                  |
| AC-6 | Live: Klick im laufenden DevHub löst einen Poll aus.                                                                                                                                                                    | neue Zeile in `~/.local/state/mw/board.log` mit Zeitstempel ≤ 10 s nach dem Klick (Zeilen im PR zitieren); Nachweis: offen, falls kein Issue im passenden Zustand verfügbar, dann per Klick auf ein Test-Issue mit `mw:go` |
| AC-7 | Bestehendes bleibt grün.                                                                                                                                                                                                | `bun run test`, `bun run build`, Lint: alle grün                                                                                                                                                                           |

## Ambition

- Altitude: Statt Poll-Kick könnte mw ein Webhook/Label-Event direkt auslösen (GitHub-Webhook → lokaler Endpunkt); nur Vorschlag, eigene Freigabe.
- Depth: Messgröße Latenz Klick → Session-Start; Ziel ≤ 10 s bis Poll-Beginn (statt Ø 7,5 min).
- Crew: tut, was ein Sicherheitsprüfer tut: die `/exec`-Erweiterung gegen Argument-Injection und andere launchd-Labels testen.

## Prüfung

langlebig · unabhängig · erweitert die Host-Exec-Vertrauensgrenze (`pty-host /exec`) und startet echte Agent-Sessions.

## First on approval

`/api/workflows/go` und `deriveWorkflowState` lesen und den Test für `{kind:'poll'}` in `test/workflowStage.test.js` rot schreiben.

## Annahmen

- Button für jedes MACC-Issue mit `waitingOn: 'poll'`; kein Einzel-Issue-Modus, weil der Poll alle wartenden Issues abarbeitet (vorgeschlagen)
- kickstart-Fehler (Job nicht installiert, kein macOS): `mw:build` bleibt gesetzt, UI zeigt Fehler, kein Rollback, weil der reguläre Poll es weiter abholt (vorgeschlagen)
- Docker-Modus: fester Zusatzeintrag in der pty-host-Allowlist nur für den einen kickstart-Aufruf (vorgeschlagen)
- Bestehender „GO: Umsetzung“-Button stößt nach dem Label-Setzen automatisch an, statt einen zweiten Klick zu verlangen (vorgeschlagen)
- Button-Text „Jetzt starten“, gleiche Zwei-Klick-Bestätigung wie `GoButton` (vorgeschlagen)
