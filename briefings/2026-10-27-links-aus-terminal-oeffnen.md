# Briefing: Links aus dem Terminal im eingebauten Browser öffnen (#118)

## The Job

Cmd-Click (macOS) bzw. Ctrl-Click (sonst) auf einen Link in einem Agent-Terminal öffnet die URL im eingebauten Browser, und zwar als neues Split-Panel rechts neben dem Pane, aus dem geklickt wurde. Das Browser-Pane ist ein normales Pane im Agent-Workspace: fokussierbar, schließbar, per Drag verschiebbar, maximierbar, und es überlebt Reload wie die Session-Panes. Ein zweiter Cmd-Click aus demselben Tab lädt die neue URL in das vorhandene Browser-Pane, statt ein weiteres aufzumachen.

## Why

DevOrbit ist Hapes ADE (siehe `docs/VISION.md`): Kontext soll im Fenster bleiben. Agents geben Dev-Server-URLs, PR-Links und Doku-Links aus; heute landen die über `WebLinksAddon` (Default-Handler `window.open`) im externen Browser und reißen Hape aus dem Workspace. Ziel dahinter: Agent-Ausgabe und Ergebnis (laufende App, PR) nebeneinander prüfen.

## Guardrails

- Ort: `components/AgentsView/AgentTerminal.tsx` (Link-Handler von `WebLinksAddon` mit Modifier-Check), `utils/agentWorkspace.ts` (Pane-Modell), `components/AgentsView/AgentWorkspace.tsx` + `hooks/useAgentWorkspace.ts` (Rendering/Aktionen). Pane-Logik bleibt pur und unit-getestet in `utils/agentWorkspace.test.ts`, weil das Modul so gebaut ist.
- Panes sind heute Session-IDs. Browser-Pane als unterscheidbare Pane-ID (z.B. Präfix `browser:`), die `pruneMissing` und `migrateWorkspace` nicht als verwaiste Session wegräumen und `tabTitle` sinnvoll benennt. Session-only-Annahmen in `AgentWorkspace.tsx` (Peek, Attach, Drag) prüfen.
- Browser-Inhalt: vorhandene Komponenten wiederverwenden (`components/CodingView/BrowserPreviewPanel.tsx` wählt Electron-`ElectronBrowserView` vs. iframe). Electron-BrowserView ist ein natives Overlay: Bounds bei Split-Resize, Tab-Wechsel und Drag-Overlay müssen stimmen, sonst liegt der Browser über anderen Panes.
- Nur `http(s)`-URLs intern öffnen; alles andere wie bisher.
- Annahme: Klick ohne Modifier bleibt wie heute (extern). Nur Cmd/Ctrl-Click ändert sich.
- Annahme: Scope nur Agents-View-Terminals. `components/XTerminal.tsx` (Details/Coding-View) bleibt unverändert; das wäre ein eigenes Issue.
- Annahme: iframe-Fallback im reinen Web-Modus reicht; Seiten mit `X-Frame-Options` zeigen dort den vorhandenen Fehler-/„extern öffnen"-Weg.
- Annahme: Browser-Pane aus Tab A wird wiederverwendet, wenn Tab A schon eines hat; sonst neu rechts neben dem klickenden Pane (`splitInto` mit Zone `right`).

## Done means

- Unit-Tests für das Pane-Modell (öffnen rechts, wiederverwenden, nicht geprunt, Migration) grün; `bun run test:run` und `bun run build` grün.
- Im laufenden App (Electron, `bun run dev`) belegt: Cmd-Click auf `http://localhost:…` in einem Agent-Terminal öffnet Split rechts mit der Seite; Resize/Tab-Wechsel verschiebt den Browser korrekt; Close entfernt ihn. Screenshot im PR.
- Unverändert: Session-Panes, Drag/Split, Plain-Click-Verhalten, XTerminal.
- Stopp nur, wenn Electron-BrowserView sich nicht sauber in Split-Panes einbetten lässt; dann mit Befund berichten statt umzubauen.
- Rückmeldung: PR mit `## Review-Anleitung`, kurzer Bericht, getroffene Annahmen.

## First on approval

`utils/agentWorkspace.ts` um Browser-Panes erweitern, test-first in `utils/agentWorkspace.test.ts`.
